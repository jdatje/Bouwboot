"""Image → 3D shape (TripoSR, MIT licence) → voxels → Lego bricks.

The 3D model gives a density and colour field; we sample it on a grid, scale it to studs and
brick layers, and tile every layer with real bricks (biggest first, alternating direction and
bridging the seams of the layer below so the build holds together).
"""
import numpy as np

# brick sizes (short, long) that exist in the library, biggest first
SIZES = [(2, 6), (2, 4), (1, 8), (1, 6), (2, 2), (1, 4), (1, 2), (1, 1)]
# plates (a third of a brick high) that are easy to get
PLATE_SIZES = [(2, 8), (2, 6), (2, 4), (1, 8), (1, 6), (2, 3), (2, 2), (1, 4), (1, 3), (1, 2), (1, 1)]
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


def to_voxels(occ, col, max_studs=20, max_layers=18, max_voxels=2600, layer=LAYER):
    """Scales the shape so it fits in max_studs x max_studs x max_layers and returns
    voxels [X, Y, Z] (bool) and their colours [X, Y, Z, 3]."""
    idx = np.argwhere(occ)
    if len(idx) == 0:
        raise ValueError("empty shape")
    lo, hi = idx.min(0), idx.max(0) + 1
    occ, col = occ[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]], col[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
    ex, ey, ez = occ.shape
    # studs per grid cell
    s = min(max_studs / max(ex, ey), max_layers * LAYER / ez)
    while True:
        X, Y, Z = max(1, round(ex * s)), max(1, round(ey * s)), max(1, round(ez * s / layer))
        vox = np.zeros((X, Y, Z), bool)
        vcol = np.full((X, Y, Z, 3), np.nan, np.float32)
        xs = np.linspace(0, ex, X + 1).astype(int)
        ys = np.linspace(0, ey, Y + 1).astype(int)
        zs = np.linspace(0, ez, Z + 1).astype(int)
        for i in range(X):
            for j in range(Y):
                for k in range(Z):
                    cell = occ[xs[i]:max(xs[i + 1], xs[i] + 1), ys[j]:max(ys[j + 1], ys[j] + 1), zs[k]:max(zs[k + 1], zs[k] + 1)]
                    f = cell.mean() if cell.size else 0
                    if f >= 0.3:
                        vox[i, j, k] = True
                        c = col[xs[i]:max(xs[i + 1], xs[i] + 1), ys[j]:max(ys[j + 1], ys[j] + 1), zs[k]:max(zs[k + 1], zs[k] + 1)][cell]
                        c = c[~np.isnan(c).any(-1)]
                        vcol[i, j, k] = c.mean(0) if len(c) else np.nan
        if vox.sum() * layer / LAYER <= max_voxels or s < 0.2:
            return vox, vcol
        s *= 0.9


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
    """Majority filter per layer so colours form patches instead of speckles."""
    X, Y, Z = lab.shape
    for _ in range(passes):
        new = lab.copy()
        for k in range(Z):
            for i in range(X):
                for j in range(Y):
                    if not vox[i, j, k]:
                        continue
                    nb = lab[max(0, i - 1):i + 2, max(0, j - 1):j + 2, k][vox[max(0, i - 1):i + 2, max(0, j - 1):j + 2, k]]
                    vals, counts = np.unique(nb, return_counts=True)
                    if counts.max() >= 5:
                        new[i, j, k] = vals[np.argmax(counts)]
        lab = new
    return lab


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
                h, w = best
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
            h, w = best
            taken[i:i + h, j:j + w] = True
            lab[i:i + h, j:j + w] = c
            out.append((h, w, i, j, k, height, int(c)))
    return out


def brickify_plates(vox, lab, sizes=None):
    """Plate-layer grid (3 layers per brick). Where a column is solid for a whole brick band
    (and one colour), use bricks; elsewhere plates. Returns pieces (h, w, x, y, z, height, label)
    with z and height in plate units, and an owner grid."""
    X, Y, Z = vox.shape
    lab = lab.copy()
    owner = -np.ones((X, Y, Z), int)
    pieces = []
    use_b = [s for s in SIZES if sizes is None or s in sizes] or [(1, 1)]
    use_p = [s for s in PLATE_SIZES if sizes is None or ("p", s) in sizes] if sizes is not None else PLATE_SIZES
    pen_p = None
    if not use_p:  # no plates owned: allow them, but only as a last resort
        use_p, pen_p = [(1, 1), (1, 2)], {(1, 1), (1, 2)}
    for band in range(0, Z, 3):
        prefer_x = (band // 3) % 2 == 0
        full = np.ones((X, Y), bool)
        for d in range(3):
            if band + d < Z:
                full &= vox[:, :, band + d]
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
                pieces.append((h, w, x, y, z, 3, c))
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
                pieces.append((h, w, x, y, z, 1, c))
    return pieces, owner


def keep_grounded_pieces(pieces, owner):
    n = len(pieces)
    parent = list(range(n + 1))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for bi, (h, w, x, y, z, ht, _) in enumerate(pieces):
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


def shape_to_bricks(occ, col, palette, max_studs=16, sizes=None, max_colors=5, plates=False):
    vox, vcol = to_voxels(occ, col, max_studs=max_studs, layer=PLATE if plates else LAYER)
    vcol = surface_colors(vox, vcol)
    pal_rgb = np.stack([hex_rgb(p["hex"]) for p in palette])
    pal_lab = to_lab(pal_rgb)
    lab = np.zeros(vox.shape, int)
    idx = np.argwhere(vox)
    cl, means = quantize(vcol[tuple(idx.T)], k=max_colors)
    # each main colour → closest Lego colour (in Lab, so it looks right to the eye)
    ml = to_lab(means)
    # the 3D model renders colours a bit dull and dark; nudge them back towards the drawing
    ml = ml * np.array([1.0, 1.15, 1.15]) + np.array([7.0, 0, 0])
    cl_to_pal = ((ml[:, None, :] - pal_lab[None]) ** 2).sum(-1).argmin(1)
    lab[tuple(idx.T)] = cl_to_pal[cl]
    lab = smooth_labels(lab, vox, passes=2)
    vox, lab = support(vox, lab)
    if plates:
        best = None
        for flip in (False, True):
            v = vox[::-1] if flip else vox
            l = lab[::-1] if flip else lab
            pieces, owner = brickify_plates(v, l, sizes)
            kept = keep_grounded_pieces(pieces, owner)
            if flip:
                X = vox.shape[0]
                kept = [(h, w, X - x - h, y, z, ht, c) for h, w, x, y, z, ht, c in kept]
            if best is None or len(kept) > len(best):
                best = kept
        best.sort(key=lambda b: (b[4], -b[5], b[2], b[3]))
        out = []
        for h, w, x, y, z, ht, l in best:
            d = {"h": h, "w": w, "x": x, "y": y, "z": round(z / 3, 4), "c": palette[l]["id"]}
            if ht == 1:
                d["p"] = 1
            out.append(d)
        return out
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
    return [{"h": h, "w": w, "x": x, "y": y, "z": z, "c": palette[l]["id"]} for h, w, x, y, z, l in bricks]
