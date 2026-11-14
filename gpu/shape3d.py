"""Image → 3D shape (TripoSR, MIT licence) → voxels → Lego bricks.

The 3D model gives a density and colour field; we sample it on a grid, scale it to studs and
brick layers, and tile every layer with real bricks (biggest first, alternating direction and
bridging the seams of the layer below so the build holds together).
"""
import numpy as np

# brick sizes (short, long) that exist in the library, biggest first
# bricks and plates (short side, long side) that are easy to get, biggest first
SIZES = sorted([(2, 10), (2, 8), (2, 6), (2, 4), (2, 3), (2, 2), (1, 12), (1, 10), (1, 8), (1, 6), (1, 4),
                (1, 3), (1, 2), (1, 1)], key=lambda s: -s[0] * s[1])
PLATE_SIZES = sorted([(6, 8), (6, 6), (4, 8), (4, 6), (4, 4), (2, 10), (2, 8), (2, 6), (2, 4), (2, 3), (2, 2),
                      (1, 8), (1, 6), (1, 4), (1, 3), (1, 2), (1, 1)], key=lambda s: -s[0] * s[1])
# slopes: (depth, width) — depth runs down the slope. 45°: 2 deep; 33°: 3 deep
SLOPES = {"s33": [(3, 2), (3, 1)], "s45": [(2, 4), (2, 2), (2, 1)]}
# tiles (smooth plates) only go where nothing sits on top
TILE_SIZES = {(1, 1), (1, 2), (1, 3), (1, 4), (1, 6), (1, 8), (2, 2), (2, 4)}
DIRS = [(1, 0), (-1, 0), (0, 1), (0, -1)]  # index = slope direction (downhill)
LAYER = 1.2  # brick height in studs
PLATE = 0.4  # plate height in studs


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def nearest(rgb, pal_rgb):
    # weighted distance in sRGB, good enough to pick a Lego colour
    d = rgb[:, None, :] - pal_rgb[None, :, :]
    w = np.array([2.0, 4.0, 3.0], dtype=np.float32)
    return np.argmin((d * d * w).sum(-1), axis=1)


def sample_grid(model, scene_code, res=96, threshold=25.0, device="cuda"):
    """Returns occupancy [res,res,res] (bool) and colour [res,res,res,3] (0..255) in TripoSR space (z up)."""
    import torch
    r = model.renderer.cfg.radius
    lin = torch.linspace(-r, r, res)
    x, y, z = torch.meshgrid(lin, lin, lin, indexing="ij")
    pts = torch.stack([x, y, z], -1).reshape(-1, 3).to(device)
    with torch.no_grad():
        out = model.renderer.query_triplane(model.decoder, pts, scene_code)
    dens = out["density_act"].reshape(res, res, res).float().cpu().numpy()
    col = out["color"].reshape(res, res, res, 3).float().clamp(0, 1).cpu().numpy() * 255
    return dens > threshold, col


def to_voxels(occ, col, max_studs=20, max_layers=18, max_voxels=2600, layer=LAYER, max_height=None):
    """Scales the shape so it fits in max_studs x max_studs (and max_height studs high) and returns
    voxels [X, Y, Z] (bool) and their colours [X, Y, Z, 3] (NaN where unknown).
    max_voxels counts in brick-sized cells."""
    idx = np.argwhere(occ)
    if len(idx) == 0:
        raise ValueError("empty shape")
    lo, hi = idx.min(0), idx.max(0) + 1
    occ, col = occ[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]], col[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
    ex, ey, ez = occ.shape
    max_h = max_height if max_height is not None else max_layers * LAYER
    s = min(max_studs / max(ex, ey), max_h / ez)
    fine = np.argwhere(occ)
    fcol = col[tuple(fine.T)]
    while True:
        X, Y, Z = max(1, round(ex * s)), max(1, round(ey * s)), max(1, round(ez * s / layer))
        cx = np.minimum(fine[:, 0] * X // ex, X - 1)
        cy = np.minimum(fine[:, 1] * Y // ey, Y - 1)
        cz = np.minimum(fine[:, 2] * Z // ez, Z - 1)
        cell = (cx * Y + cy) * Z + cz
        n = X * Y * Z
        filled = np.bincount(cell, minlength=n)
        # fine voxels per coarse cell (also counting empty ones) = cell volume
        vol = (np.bincount(np.minimum(np.arange(ex) * X // ex, X - 1), minlength=X)[:, None, None]
               * np.bincount(np.minimum(np.arange(ey) * Y // ey, Y - 1), minlength=Y)[None, :, None]
               * np.bincount(np.minimum(np.arange(ez) * Z // ez, Z - 1), minlength=Z)[None, None, :]).ravel()
        vox = (filled / np.maximum(vol, 1) >= 0.3).reshape(X, Y, Z)
        ok = ~np.isnan(fcol).any(1)
        csum = np.zeros((n, 3))
        for c in range(3):
            csum[:, c] = np.bincount(cell[ok], weights=fcol[ok, c], minlength=n)
        ccnt = np.bincount(cell[ok], minlength=n)
        vcol = np.where(ccnt[:, None] > 0, csum / np.maximum(ccnt, 1)[:, None], np.nan).reshape(X, Y, Z, 3).astype(np.float32)
        vcol[~vox] = np.nan
        if vox.sum() * layer / LAYER <= max_voxels or s < 0.2:
            return vox, vcol
        s *= 0.92


def surface_colors(vox, vcol):
    """Gives every voxel the colour of the nearest surface voxel that has a known colour
    (the inside of the shape and cells without colour information are unreliable)."""
    X, Y, Z = vox.shape
    pad = np.pad(vox, 1)
    inner = pad[2:, 1:-1, 1:-1] & pad[:-2, 1:-1, 1:-1] & pad[1:-1, 2:, 1:-1] & pad[1:-1, :-2, 1:-1] & pad[1:-1, 1:-1, 2:] & pad[1:-1, 1:-1, :-2]
    known = vox & ~np.isnan(vcol).any(-1)
    src = known & ~inner
    if not src.any():
        src = known
    out = vcol.copy()
    sidx = np.argwhere(src)
    if not len(sidx):
        out[vox] = 160.0
        return out
    for p in np.argwhere(vox & ~src):
        d = ((sidx - p) ** 2).sum(1)
        out[tuple(p)] = vcol[tuple(sidx[np.argmin(d)])]
    return out


def to_lab(rgb):
    """sRGB 0..255 → CIE Lab (D65)."""
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def quantize(colors, k=5, seed=0):
    """Groups voxel colours into at most k main colours (shading of one colour ends up together).
    Returns per-voxel cluster index and the cluster's mean RGB."""
    lab = to_lab(colors)
    feat = lab * np.array([0.35, 1.0, 1.0])  # lightness counts less: shadows are not a new colour
    rng = np.random.default_rng(seed)
    k = min(k, len(feat))
    centers = feat[rng.choice(len(feat), k, replace=False)]
    for _ in range(20):
        d = ((feat[:, None, :] - centers[None]) ** 2).sum(-1)
        lab_idx = d.argmin(1)
        new = np.stack([feat[lab_idx == j].mean(0) if (lab_idx == j).any() else centers[j] for j in range(k)])
        if np.allclose(new, centers):
            break
        centers = new
    means = np.stack([colors[lab_idx == j].mean(0) if (lab_idx == j).any() else np.zeros(3) for j in range(k)])
    return lab_idx, means


def smooth_labels(lab, vox, passes=1):
    """Majority filter per layer (3x3) so colours form patches instead of speckles."""
    for _ in range(passes):
        labels = np.unique(lab[vox])
        counts = []
        for l in labels:
            m = np.pad((lab == l) & vox, ((1, 1), (1, 1), (0, 0))).astype(np.int16)
            c = sum(m[1 + dx:m.shape[0] - 1 + dx, 1 + dy:m.shape[1] - 1 + dy] for dx in (-1, 0, 1) for dy in (-1, 0, 1))
            counts.append(c)
        counts = np.stack(counts)
        best = counts.argmax(0)
        strong = counts.max(0) >= 5
        new = lab.copy()
        upd = vox & strong
        new[upd] = labels[best[upd]]
        lab = new
    return lab


def erode(vox, r_xy, r_z):
    """Voxels that are at least r_xy cells (sideways) and r_z cells (up/down) inside the shape."""
    out = vox.copy()
    X, Y, Z = vox.shape
    pad = np.pad(vox, ((r_xy, r_xy), (r_xy, r_xy), (r_z, r_z)))
    for dx in range(-r_xy, r_xy + 1):
        for dy in range(-r_xy, r_xy + 1):
            out &= pad[r_xy + dx:r_xy + dx + X, r_xy + dy:r_xy + dy + Y, r_z:r_z + Z]
    for dz in range(-r_z, r_z + 1):
        out &= pad[r_xy:r_xy + X, r_xy:r_xy + Y, r_z + dz:r_z + dz + Z]
    return out


def hollow(vox, wall=2, layer=PLATE, pillar_every=6):
    """Empties the inside (like real Lego sculptures), keeping a shell of `wall` studs and
    2x2 pillars every few studs so roofs over the hollow stay supported."""
    rz = max(1, int(round(wall * 1.2 / layer)))  # same thickness up/down, in layers
    inside = erode(vox, wall, rz)
    X, Y, Z = vox.shape
    gx, gy = np.meshgrid(np.arange(X) % pillar_every < 2, np.arange(Y) % pillar_every < 2, indexing="ij")
    pillars = (gx & gy)[:, :, None]
    return vox & ~(inside & ~pillars)


def brickify(vox, lab, sizes=None):
    """Tiles each layer with bricks of one colour. Returns list of (h, w, x, y, z, label).
    `sizes` limits the brick sizes (1x1 is always kept as a last resort, but avoided)."""
    X, Y, Z = vox.shape
    lab = lab.copy()
    use = [s for s in SIZES if sizes is None or s in sizes]
    if (1, 1) not in use:
        use.append((1, 1))
    owner = -np.ones((X, Y, Z), int)
    bricks = []
    for k in range(Z):
        prefer_x = k % 2 == 0
        for i in range(X):
            for j in range(Y):
                if not vox[i, j, k] or owner[i, j, k] >= 0:
                    continue
                c = lab[i, j, k]
                best, best_score = None, -1e9
                for a, b in use:
                    for (h, w) in {(a, b), (b, a)}:
                        if i + h > X or j + w > Y:
                            continue
                        reg = (slice(i, i + h), slice(j, j + w), k)
                        if not vox[reg].all() or (owner[reg] >= 0).any():
                            continue
                        # a few cells of another colour may be swallowed by a big brick (fewer 1x1s)
                        wrong = int((lab[reg] != c).sum())
                        if wrong and (h * w < 4 or wrong > 0.25 * h * w):
                            continue
                        below = len(set(owner[i:i + h, j:j + w, k - 1].ravel()) - {-1}) if k > 0 else 0
                        long_x = h > w
                        score = h * w * 10 + below * 6 + (2 if long_x == prefer_x and h != w else 0) - wrong * 12
                        if sizes is not None and (a, b) not in sizes:
                            score -= 1000
                        if score > best_score:
                            best, best_score = (h, w), score
                h, w = best or (1, 1)
                owner[i:i + h, j:j + w, k] = len(bricks)
                lab[i:i + h, j:j + w, k] = c
                bricks.append((h, w, i, j, k, int(c)))
    return bricks, owner


def _tile_layer(region, lab, owner, k, below, use, idx0, height, prefer_x, sizes_penalty=None):
    """Tiles the cells in `region` (2D bool) on plate-layer k with pieces of the given sizes.
    Returns the new pieces as (h, w, x, y, z, height, label)."""
    X, Y = region.shape
    out = []
    taken = np.zeros_like(region)
    for i in range(X):
        for j in range(Y):
            if not region[i, j] or taken[i, j]:
                continue
            c = lab[i, j]
            best, best_score = None, -1e9
            for a, b in use:
                for (h, w) in {(a, b), (b, a)}:
                    if i + h > X or j + w > Y:
                        continue
                    reg = (slice(i, i + h), slice(j, j + w))
                    if not region[reg].all() or taken[reg].any():
                        continue
                    wrong = int((lab[reg] != c).sum())
                    if wrong and (h * w < 4 or wrong > 0.25 * h * w):
                        continue
                    nb = len(set(below[reg].ravel()) - {-1}) if below is not None else 0
                    score = h * w * 10 + nb * 6 + (2 if (h > w) == prefer_x and h != w else 0) - wrong * 12
                    if sizes_penalty and (a, b) in sizes_penalty:
                        score -= 1000
                    if score > best_score:
                        best, best_score = (h, w), score
            # nothing owned fits here: a 1x1 it is (ends up on the shopping list)
            h, w = best or (1, 1)
            taken[i:i + h, j:j + w] = True
            lab[i:i + h, j:j + w] = c
            out.append((h, w, i, j, k, height, int(c)))
    return out


def _allowed(kind, dims, sizes):
    if sizes is None:
        return True
    return (kind, tuple(sorted(dims))) in sizes


def place_slopes(vox, lab, owner, k, pieces, sizes, use_slopes, slope_sizes=None):
    """Finds staircase edges starting at plate layer k and covers them with slopes.
    Seen from the outside (c0) inwards, a 45° slope (2 deep) matches heights [1-2, 3] plates and a
    33° slope (3 deep) matches [1, 2, 3] plates, with nothing on top of the high row."""
    if not use_slopes:
        return
    X, Y, Z = vox.shape
    if k + 2 >= Z:
        return
    # height of the column from layer k up (0..3), only counting cells nobody owns yet
    col = vox[:, :, k:k + 3] & (owner[:, :, k:k + 3] < 0)
    hgt = np.where(~col[:, :, 0], 0, np.where(~col[:, :, 1], 1, np.where(~col[:, :, 2], 2, 3)))
    above = vox[:, :, k + 3] if k + 3 < Z else np.zeros((X, Y), bool)
    colour = lab[:, :, k]
    landing = vox[:, :, k - 1] if k > 0 else np.ones((X, Y), bool)
    # (kind, allowed heights per row from the outside in, fill): "fill" slopes sit in the air above
    # a lower step (steep stairs); the others trim a gentle staircase
    patterns = [("s33", [(1,), (2,), (3,)], False), ("s45", [(1, 2), (3,)], False), ("s45", [(0,), (3,)], True)]
    for kind, pat, fill in patterns:
        if fill and k == 0:
            continue
        depth = len(pat)
        for di, (dx, dy) in enumerate(DIRS):
            for d_, width in (slope_sizes or SLOPES)[kind]:
                if slope_sizes is None and not _allowed(kind, (d_, width), sizes):
                    continue
                starts = (hgt == 0) & landing & ~vox[:, :, k] if fill else (hgt >= 1) & (hgt <= 2)
                for ex, ey in np.argwhere(starts):
                    ok = True
                    cells = []
                    for j in range(width):
                        for r in range(depth):
                            px = ex - dx * r + (j if dx == 0 else 0)
                            py = ey - dy * r + (j if dy == 0 else 0)
                            if not (0 <= px < X and 0 <= py < Y) or hgt[px, py] not in pat[r] or above[px, py] and r == depth - 1:
                                ok = False
                                break
                            if fill and r == 0:  # air above the lower step: must rest on it, not be owned
                                if not landing[px, py] or vox[px, py, k] or (owner[px, py, k:k + 3] >= 0).any():
                                    ok = False
                                    break
                                cells.append((px, py))
                                continue
                            ref = colour[ex - dx, ey - dy] if fill else colour[ex, ey]
                            if colour[px, py] != ref:
                                ok = False
                                break
                            if r == 0:  # downhill of the slope: open, with something to land on
                                qx, qy = px + dx, py + dy
                                if not (0 <= qx < X and 0 <= qy < Y) or vox[qx, qy, k] or not landing[qx, qy]:
                                    ok = False
                                    break
                            cells.append((px, py))
                        if not ok:
                            break
                    if not ok:
                        continue
                    xs = [c[0] for c in cells]
                    ys = [c[1] for c in cells]
                    x0, y0 = min(xs), min(ys)
                    h, w = max(xs) - x0 + 1, max(ys) - y0 + 1
                    owner[x0:x0 + h, y0:y0 + w, k:k + 3] = len(pieces)
                    hgt[x0:x0 + h, y0:y0 + w] = -1
                    c = colour[ex - dx, ey - dy] if fill else colour[ex, ey]
                    pieces.append((h, w, x0, y0, k, 3, int(c), kind, di))


INV_SLOPES = {"s45": [(2, 2), (2, 1)], "s33": [(3, 2)]}
INV_NAME = {("s45", 2): "inv45_2", ("s45", 1): "inv45_1", ("s33", 2): "inv33_2"}


def brickify_plates(vox, lab, sizes=None, slopes=True, specials=(), inverted=None):
    """Plate-layer grid (3 layers per brick). Slopes go on stepped top edges; where a column is
    solid for a whole brick band (and one colour) bricks are used, elsewhere plates. Returns pieces
    (h, w, x, y, z, height, label, kind, dir) with z and height in plate units, and an owner grid."""
    X, Y, Z = vox.shape
    lab = lab.copy()
    owner = -np.ones((X, Y, Z), int)
    pieces = []
    use_b = [s for s in SIZES if sizes is None or s in sizes] or [(1, 1)]
    use_p = [s for s in PLATE_SIZES if sizes is None or ("p", s) in sizes] if sizes is not None else PLATE_SIZES
    pen_p = None
    if not use_p:  # no plates owned: allow them, but only as a last resort
        use_p, pen_p = [(1, 1), (1, 2)], {(1, 1), (1, 2)}
    # special pieces (wheels, windows, round pieces...) are placed by the designer: they go first
    for h, w, x, y, z, ht, c, kind, di in specials:
        if (owner[x:x + h, y:y + w, z:z + ht] >= 0).any():
            continue
        owner[x:x + h, y:y + w, z:z + ht] = len(pieces)
        pieces.append((h, w, x, y, z, ht, c, kind, di))
    # slopes next, at any plate height: they sit on the top edges where the shape steps down
    for k in range(1, Z - 2):
        place_slopes(vox, lab, owner, k, pieces, sizes, slopes)
    # inverted slopes under overhangs: the same staircases, upside down
    if slopes and inverted:
        n0 = len(pieces)
        vf, lf, of = vox[:, :, ::-1], lab[:, :, ::-1], owner[:, :, ::-1]
        for k in range(1, Z - 2):
            place_slopes(vf, lf, of, k, pieces, sizes, True, {kk: [s_ for s_ in v if INV_NAME[(kk, s_[1])] in inverted]
                                                               for kk, v in INV_SLOPES.items()})
        for i in range(n0, len(pieces)):
            h, w, x, y, z, ht, c, kind, di = pieces[i]
            width = h if di >= 2 else w
            pieces[i] = (h, w, x, y, Z - z - ht, ht, c, "x:" + INV_NAME[(kind, width)], di)
    for band in range(0, Z, 3):
        prefer_x = (band // 3) % 2 == 0
        full = np.ones((X, Y), bool)
        for d in range(3):
            if band + d < Z:
                full &= vox[:, :, band + d] & (owner[:, :, band + d] < 0)
                if d:
                    full &= lab[:, :, band + d] == lab[:, :, band]
            else:
                full &= False
        below = owner[:, :, band - 1] if band > 0 else None
        if full.any():
            lab2 = lab[:, :, band + 1].copy() if band + 1 < Z else lab[:, :, band].copy()
            new = _tile_layer(full, lab2, owner, band, below, use_b, len(pieces), 3, prefer_x)
            for h, w, x, y, z, ht, c in new:
                owner[x:x + h, y:y + w, z:z + 3] = len(pieces)
                lab[x:x + h, y:y + w, z:z + 3] = c
                pieces.append((h, w, x, y, z, 3, c, "", 0))
        for d in range(3):
            k = band + d
            if k >= Z:
                break
            rest = vox[:, :, k] & (owner[:, :, k] < 0)
            if not rest.any():
                continue
            below = owner[:, :, k - 1] if k > 0 else None
            l2 = lab[:, :, k].copy()
            new = _tile_layer(rest, l2, owner, k, below, use_p, len(pieces), 1, (k % 2 == 0) != prefer_x, pen_p)
            for h, w, x, y, z, ht, c in new:
                owner[x:x + h, y:y + w, z] = len(pieces)
                pieces.append((h, w, x, y, z, 1, c, "", 0))
    # plates with nothing on top become tiles (smooth), where that tile exists
    for i, (h, w, x, y, z, ht, c, kind, di) in enumerate(pieces):
        if ht != 1 or kind:
            continue
        dims = (min(h, w), max(h, w))
        if dims not in TILE_SIZES or not _allowed("t", dims, sizes):
            continue
        if z + 1 < Z and vox[x:x + h, y:y + w, z + 1].any():
            continue
        pieces[i] = (h, w, x, y, z, ht, c, "t", 0)
    return pieces, owner


def keep_grounded_pieces(pieces, owner):
    n = len(pieces)
    parent = list(range(n + 1))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for bi, p in enumerate(pieces):
        h, w, x, y, z = p[:5]
        if z == 0:
            parent[find(bi)] = find(n)
        else:
            for o in set(owner[x:x + h, y:y + w, z - 1].ravel()) - {-1}:
                parent[find(bi)] = find(int(o))
    g = find(n)
    return [b for bi, b in enumerate(pieces) if find(bi) == g]


def keep_grounded(bricks, owner):
    """Drops bricks that are not (through other bricks) connected to the ground."""
    n = len(bricks)
    parent = list(range(n + 1))  # n = ground

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for bi, (h, w, x, y, z, _) in enumerate(bricks):
        if z == 0:
            parent[find(bi)] = find(n)
        else:
            for o in set(owner[x:x + h, y:y + w, z - 1].ravel()) - {-1}:
                parent[find(bi)] = find(int(o))
    g = find(n)
    return [b for bi, b in enumerate(bricks) if find(bi) == g]


def components(vox):
    """6-connected components of the voxels. Returns label grid (-1 = empty) and sizes."""
    lab = -np.ones(vox.shape, int)
    sizes = []
    X, Y, Z = vox.shape
    for start in map(tuple, np.argwhere(vox)):
        if lab[start] >= 0:
            continue
        n = len(sizes)
        stack, cnt = [start], 0
        lab[start] = n
        while stack:
            x, y, z = stack.pop()
            cnt += 1
            for dx, dy, dz in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
                q = (x + dx, y + dy, z + dz)
                if 0 <= q[0] < X and 0 <= q[1] < Y and 0 <= q[2] < Z and vox[q] and lab[q] < 0:
                    lab[q] = n
                    stack.append(q)
        sizes.append(cnt)
    return lab, sizes


def support(vox, lab_colors):
    """Removes tiny loose bits and gives bigger floating parts pillars down to whatever is below."""
    comp, sizes = components(vox)
    total = vox.sum()
    for n, size in enumerate(sizes):
        cells = np.argwhere(comp == n)
        if cells[:, 2].min() == 0:
            continue
        if size < 0.02 * total:
            vox[tuple(cells.T)] = False
            continue
        for x, y, z in cells:
            if z > 0 and not vox[x, y, z - 1] and comp[x, y, z - 1] != n:
                zz = z - 1
                while zz >= 0 and not vox[x, y, zz]:
                    vox[x, y, zz] = True
                    lab_colors[x, y, zz] = lab_colors[x, y, z]
                    zz -= 1
    return vox, lab_colors


def tile_plates(vox, lab, palette, sizes=None, slopes=True, specials=(), inverted=None):
    """Plate-layer grid + palette labels -> bricks, plates, slopes and tiles (JSON-ready).
    specials: pre-placed pieces (h, w, x, y, z, height, label, "x:<id>", dir) in plate units.
    inverted: names of the inverted slopes that may be used under overhangs (None = none)."""
    best = None
    X = vox.shape[0]
    fl = {0: 1, 1: 0, 2: 2, 3: 3}
    flips = (False, True) if vox.sum() < 15000 else (False,)
    for flip in flips:
        v = vox[::-1] if flip else vox
        l = lab[::-1] if flip else lab
        sp = [(h, w, X - x - h, y, z, ht, c, k, fl[d]) for h, w, x, y, z, ht, c, k, d in specials] if flip else list(specials)
        pieces, owner = brickify_plates(v, l, sizes, slopes, sp, inverted)
        kept = keep_grounded_pieces(pieces, owner)
        if flip:
            kept = [(h, w, X - x - h, y, z, ht, c, k, fl[d] if k.startswith("s") or k.startswith("x:") else d)
                    for h, w, x, y, z, ht, c, k, d in kept]
        if best is None or len(kept) > len(best):
            best = kept
    best.sort(key=lambda b: (b[4], -b[5], b[2], b[3]))
    out = []
    for h, w, x, y, z, ht, l, kind, di in best:
        d = {"h": int(h), "w": int(w), "x": int(x), "y": int(y), "z": round(int(z) / 3, 4), "c": palette[int(l)]["id"]}
        if kind.startswith("x:"):
            d["s"] = kind[2:]
            d["d"] = int(di)
            out.append(d)
            continue
        if ht == 1:
            d["p"] = 1
        if kind:
            d["k"] = kind
        if kind.startswith("s"):
            d["d"] = int(di)
        out.append(d)
    return out


def shape_to_bricks(occ, col, palette, max_studs=16, sizes=None, max_colors=5, plates=False, brighten=7, saturate=1.15,
                    max_voxels=2600, hollow_inside=False, slopes=True, max_height=None):
    vox, vcol = to_voxels(occ, col, max_studs=max_studs, layer=PLATE if plates else LAYER,
                          max_voxels=max_voxels,
                          # bigger builds may also be taller (a tower should grow with the size choice)
                          max_height=max_height if max_height is not None else max(21.6, max_studs * 1.1))
    vcol = surface_colors(vox, vcol)
    pal_rgb = np.stack([hex_rgb(p["hex"]) for p in palette])
    pal_lab = to_lab(pal_rgb)
    lab = np.zeros(vox.shape, int)
    idx = np.argwhere(vox)
    cl, means = quantize(vcol[tuple(idx.T)], k=max_colors)
    # each main colour → closest Lego colour (in Lab, so it looks right to the eye)
    ml = to_lab(means)
    # the 3D model renders colours a bit dull and dark; nudge them back towards the drawing
    ml = ml * np.array([1.0, saturate, saturate]) + np.array([float(brighten), 0, 0])
    cl_to_pal = ((ml[:, None, :] - pal_lab[None]) ** 2).sum(-1).argmin(1)
    lab[tuple(idx.T)] = cl_to_pal[cl]
    lab = smooth_labels(lab, vox, passes=2)
    vox, lab = support(vox, lab)
    if plates:
        if hollow_inside:
            vox = hollow(vox)
        return tile_plates(vox, lab, palette, sizes, slopes)
    # tile a few ways and keep the one where the most bricks hold on to the ground
    best = None
    for flip in (False, True):
        v = vox[::-1] if flip else vox
        l = lab[::-1] if flip else lab
        for parity in (0, 1):
            vv = np.concatenate([np.zeros_like(v[:, :, :1]), v], 2) if parity else v
            ll = np.concatenate([np.zeros_like(l[:, :, :1]), l], 2) if parity else l
            bricks, owner = brickify(vv, ll, sizes)
            if parity:  # undo the dummy layer used to swap the preferred direction
                bricks = [(h, w, x, y, z - 1, c) for h, w, x, y, z, c in bricks]
                owner = owner[:, :, 1:]
            kept = keep_grounded(bricks, owner)
            if flip:
                X = vox.shape[0]
                kept = [(h, w, X - x - h, y, z, c) for h, w, x, y, z, c in kept]
            if best is None or len(kept) > len(best) or (len(kept) == len(best) and len(kept) < len(bricks)):
                best = kept
    bricks = best
    bricks.sort(key=lambda b: (b[4], b[2], b[3]))
    return [{"h": int(h), "w": int(w), "x": int(x), "y": int(y), "z": int(z), "c": palette[int(l)]["id"]} for h, w, x, y, z, l in bricks]
