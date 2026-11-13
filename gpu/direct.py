"""Option 1: the language model writes the model as a small building program in stud coordinates;
this turns that program straight into a plate-layer grid and then into bricks. No drawing, no 3D model.

Program: {"size": {"w": 24, "d": 10}, "parts": [ {...}, ... ]}
Units: x, y, w, d in studs; z, h in plates (3 plates = 1 brick; 1 stud wide = 2.5 plates high).
Parts are applied in order, later parts overwrite earlier ones. Any part may have "cut": true
(removes instead of adds) and "mirror": true (also applied mirrored across the centre line y = d/2).
"""
import numpy as np
from shape3d import support, hollow, tile_plates

COLORS = [("white", 15, "#F4F4F4"), ("black", 0, "#1B2A34"), ("light_grey", 71, "#A0A5A9"), ("dark_grey", 72, "#6C6E68"),
          ("red", 4, "#C91A09"), ("dark_red", 320, "#720E0F"), ("orange", 25, "#FE8A18"), ("light_orange", 191, "#F8BB3D"),
          ("yellow", 14, "#F2CD37"), ("lime", 27, "#BBE90B"), ("bright_green", 10, "#4B9F4A"), ("green", 2, "#237841"),
          ("dark_green", 288, "#184632"), ("olive", 326, "#9B9A5A"), ("sand_green", 378, "#A0BCAC"), ("azure", 322, "#36AEBF"),
          ("medium_blue", 73, "#5A93DB"), ("blue", 1, "#0055BF"), ("dark_blue", 272, "#0A3463"), ("light_pink", 29, "#E4ADC8"),
          ("pink", 5, "#C870A0"), ("tan", 19, "#E4CD9E"), ("dark_tan", 28, "#958A73"), ("nougat", 92, "#D09168"),
          ("brown", 70, "#582A12"), ("dark_brown", 308, "#352100")]
PALETTE = [{"id": i, "hex": h} for _, i, h in COLORS]
NAME = {n: k for k, (n, _, _) in enumerate(COLORS)}
MAX = (48, 48, 120)  # studs, studs, plates


def _mask(p, X, Y, Z):
    """Boolean grid of one part. Cell (i, j, k) covers stud i..i+1, j..j+1 and plate k..k+1."""
    cx, cy, cz = np.meshgrid(np.arange(X) + 0.5, np.arange(Y) + 0.5, np.arange(Z) + 0.5, indexing="ij")
    op = p.get("op", "box")
    if op == "cylinder":
        ax = p.get("axis", "z")
        r = float(p["r"])
        if ax == "z":  # x, y = centre (studs); z = bottom (plates); h = height (plates)
            return ((cx - p["x"]) ** 2 + (cy - p["y"]) ** 2 <= r * r) & (cz >= p["z"]) & (cz <= p["z"] + p["h"])
        # lying cylinder (wheel, barrel): centre x|y in studs, centre height z in plates, len in studs
        zc = (cz - p["z"]) / 2.5  # plates -> studs so the circle is round
        if ax == "y":
            return ((cx - p["x"]) ** 2 + zc ** 2 <= r * r) & (cy >= p["y"]) & (cy <= p["y"] + p["len"])
        return ((cy - p["y"]) ** 2 + zc ** 2 <= r * r) & (cx >= p["x"]) & (cx <= p["x"] + p["len"])
    x, y, z, w, d, h = (float(p[k]) for k in "xyzwdh")
    box = (cx >= x) & (cx <= x + w) & (cy >= y) & (cy <= y + d) & (cz >= z) & (cz <= z + h)
    if op == "box":
        return box
    u, v, t = (cx - x) / max(w, 1e-6), (cy - y) / max(d, 1e-6), (cz - z) / max(h, 1e-6)
    if op == "roof":  # gable roof, ridge runs along "ridge" axis
        s = v if p.get("ridge", "x") == "x" else u
        return box & (t <= 1 - np.abs(2 * s - 1) + 0.5 / max(h, 1))
    if op == "pyramid":
        return box & (t <= 1 - np.maximum(np.abs(2 * u - 1), np.abs(2 * v - 1)) + 0.5 / max(h, 1))
    if op == "wedge":  # ramp; "high" is the side where it is full height
        s = {"+x": u, "-x": 1 - u, "+y": v, "-y": 1 - v}[p.get("high", "+x")]
        return box & (t <= s + 0.5 / max(h, 1))
    raise ValueError(f"unknown op {op}")


def program_to_grid(prog):
    parts = [dict(p) for p in prog["parts"] if isinstance(p, dict)]
    # overhangs may start below 0: shift everything so the grid starts at 0
    def lo(p, k):
        r = float(p.get("r", 0)) if p.get("op") == "cylinder" and p.get("axis", "z") != k else 0
        return float(p.get(k, 0)) - r
    sx = max(0, -int(np.floor(min(lo(p, "x") for p in parts))))
    sy = max(0, -int(np.floor(min(lo(p, "y") for p in parts))))
    for p in parts:
        p["x"] = float(p.get("x", 0)) + sx
        p["y"] = float(p.get("y", 0)) + sy
        p["z"] = max(0.0, float(p.get("z", 0))) if p.get("op") != "cylinder" or p.get("axis", "z") == "z" else float(p.get("z", 0))
    X = int(min(MAX[0], max(np.ceil(p.get("x", 0) + p.get("w", p.get("len", p.get("r", 0)))) for p in parts) + 2))
    Y = int(min(MAX[1], max(np.ceil(p.get("y", 0) + p.get("d", p.get("len", p.get("r", 0)))) for p in parts) + 2))
    Z = int(min(MAX[2], max(np.ceil(p.get("z", 0) + p.get("h", p.get("r", 0) * 2.5)) for p in parts) + 2))
    D = float(prog.get("size", {}).get("d", Y - 2 - 2 * sy)) + 2 * sy
    vox = np.zeros((X, Y, Z), bool)
    lab = np.zeros((X, Y, Z), int)
    for p in parts:
        todo = [p]
        if p.get("mirror"):
            q = dict(p)
            if p.get("op") == "cylinder" and p.get("axis", "z") != "y":
                q["y"] = D - p["y"]
            elif p.get("op") == "cylinder":
                q["y"] = D - p["y"] - p["len"]
            else:
                q["y"] = D - p["y"] - p["d"]
                if p.get("op") == "wedge" and p.get("high", "+x")[1] == "y":
                    q["high"] = {"+y": "-y", "-y": "+y"}[p["high"]]
            todo.append(q)
        for q in todo:
            try:
                m = _mask(q, X, Y, Z)
            except (KeyError, ValueError, TypeError) as e:
                print("skipped part", q, e)
                continue
            if q.get("cut"):
                vox &= ~m
            else:
                vox |= m
                lab[m] = NAME.get(str(q.get("color", "light_grey")).lower().replace(" ", "_"), NAME["light_grey"])
    # trim empty space
    idx = np.argwhere(vox)
    lo, hi = idx.min(0), idx.max(0) + 1
    lo[2] = 0
    return vox[lo[0]:hi[0], lo[1]:hi[1], :hi[2]], lab[lo[0]:hi[0], lo[1]:hi[1], :hi[2]]


def program_to_bricks(prog, sizes=None, slopes=True, hollow_inside=True):
    vox, lab = program_to_grid(prog)
    vox, lab = support(vox, lab)
    if hollow_inside:
        vox = hollow(vox)
    return tile_plates(vox, lab, PALETTE, sizes, slopes)
