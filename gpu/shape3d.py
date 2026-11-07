"""Image → 3D shape (TripoSR, MIT licence) → voxels → Lego bricks.

The 3D model gives a density and colour field; we sample it on a grid, scale it to studs and
brick layers, and tile every layer with real bricks (biggest first, alternating direction and
bridging the seams of the layer below so the build holds together).
"""
import numpy as np

# brick sizes (short, long) that exist in the library, biggest first
SIZES = [(2, 6), (2, 4), (1, 8), (1, 6), (2, 2), (1, 4), (1, 2), (1, 1)]
LAYER = 1.2  # brick height in studs


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


def to_voxels(occ, col, max_studs=20, max_layers=18, max_voxels=2600):
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
        X, Y, Z = max(1, round(ex * s)), max(1, round(ey * s)), max(1, round(ez * s / LAYER))
        vox = np.zeros((X, Y, Z), bool)
        vcol = np.zeros((X, Y, Z, 3), np.float32)
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
                        c = col[xs[i]:max(xs[i + 1], xs[i] + 1), ys[j]:max(ys[j + 1], ys[j] + 1), zs[k]:max(zs[k + 1], zs[k] + 1)]
                        vcol[i, j, k] = c[cell].mean(0)
        if vox.sum() <= max_voxels or s < 0.2:
            return vox, vcol
        s *= 0.9


def surface_colors(vox, vcol):
    """Colour every voxel like the nearest surface voxel (the inside of the field is unreliable)."""
    X, Y, Z = vox.shape
    pad = np.pad(vox, 1)
    inner = pad[2:, 1:-1, 1:-1] & pad[:-2, 1:-1, 1:-1] & pad[1:-1, 2:, 1:-1] & pad[1:-1, :-2, 1:-1] & pad[1:-1, 1:-1, 2:] & pad[1:-1, 1:-1, :-2]
    surf = vox & ~inner
    sidx = np.argwhere(surf)
    out = vcol.copy()
    if len(sidx):
        for p in np.argwhere(vox & inner):
            d = ((sidx - p) ** 2).sum(1)
            q = sidx[np.argmin(d)]
            out[tuple(p)] = vcol[tuple(q)]
    return out


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


def brickify(vox, lab):
    """Tiles each layer with bricks of one colour. Returns list of (h, w, x, y, z, label)."""
    X, Y, Z = vox.shape
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
                for a, b in SIZES:
                    for (h, w) in {(a, b), (b, a)}:
                        if i + h > X or j + w > Y:
                            continue
                        reg = (slice(i, i + h), slice(j, j + w), k)
                        if not vox[reg].all() or (owner[reg] >= 0).any() or (lab[reg] != c).any():
                            continue
                        below = len(set(owner[i:i + h, j:j + w, k - 1].ravel()) - {-1}) if k > 0 else 0
                        long_x = h > w
                        score = h * w * 10 + below * 6 + (2 if long_x == prefer_x and h != w else 0)
                        if score > best_score:
                            best, best_score = (h, w), score
                h, w = best
                owner[i:i + h, j:j + w, k] = len(bricks)
                bricks.append((h, w, i, j, k, int(c)))
    return bricks, owner


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


def shape_to_bricks(occ, col, palette, max_studs=20):
    vox, vcol = to_voxels(occ, col, max_studs=max_studs)
    vcol = surface_colors(vox, vcol)
    pal_rgb = np.stack([hex_rgb(p["hex"]) for p in palette])
    lab = np.zeros(vox.shape, int)
    idx = np.argwhere(vox)
    lab[tuple(idx.T)] = nearest(vcol[tuple(idx.T)], pal_rgb)
    lab = smooth_labels(lab, vox)
    bricks, owner = brickify(vox, lab)
    bricks = keep_grounded(bricks, owner)
    bricks.sort(key=lambda b: (b[4], b[2], b[3]))
    return [{"h": h, "w": w, "x": x, "y": y, "z": z, "c": palette[l]["id"]} for h, w, x, y, z, l in bricks]
