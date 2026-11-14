"""Option 1: the language model writes the model as a small building program in stud coordinates;
this turns that program straight into a plate-layer grid and then into bricks. No drawing, no 3D model.

Program: {"size": {"w": 24, "d": 10}, "parts": [ {...}, ... ]}
Units: x, y, w, d in studs; z, h in plates (3 plates = 1 brick; 1 stud wide = 2.5 plates high).
Parts are applied in order, later parts overwrite earlier ones. Any part may have "cut": true
(removes instead of adds) and "mirror": true (also applied mirrored across the centre line y = d/2).
"""
import json
import os
import numpy as np
from shape3d import support, hollow, tile_plates

# special pieces (wheels, windows, round pieces, arches, curved and inverted slopes): shared with the web app
_SPEC_FILE = next((f for f in (os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "src", "lib", "specials.json"),
                               os.path.join(os.path.dirname(os.path.abspath(__file__)), "specials.json")) if os.path.exists(f)), None)
SPECIALS = {k: v for k, v in json.load(open(_SPEC_FILE)).items() if not k.startswith("_")} if _SPEC_FILE else {}
SPECIAL_OPS = {"wheels", "window", "door", "arch", "cone", "dish", "curve"}
DIR = {"+x": 0, "-x": 1, "+y": 2, "-y": 3}

COLORS = [("white", 15, "#F4F4F4"), ("black", 0, "#1B2A34"), ("light_grey", 71, "#A0A5A9"), ("dark_grey", 72, "#6C6E68"),
          ("red", 4, "#C91A09"), ("dark_red", 320, "#720E0F"), ("orange", 25, "#FE8A18"), ("light_orange", 191, "#F8BB3D"),
          ("yellow", 14, "#F2CD37"), ("lime", 27, "#BBE90B"), ("bright_green", 10, "#4B9F4A"), ("green", 2, "#237841"),
          ("dark_green", 288, "#184632"), ("olive", 326, "#9B9A5A"), ("sand_green", 378, "#A0BCAC"), ("azure", 322, "#36AEBF"),
          ("medium_blue", 73, "#5A93DB"), ("blue", 1, "#0055BF"), ("dark_blue", 272, "#0A3463"), ("light_pink", 29, "#E4ADC8"),
          ("pink", 5, "#C870A0"), ("tan", 19, "#E4CD9E"), ("dark_tan", 28, "#958A73"), ("nougat", 92, "#D09168"),
          ("brown", 70, "#582A12"), ("dark_brown", 308, "#352100"),
          ("trans_clear", 47, "#FCFCFC"), ("trans_red", 36, "#D9261A"), ("trans_yellow", 46, "#F5CD2F"), ("trans_orange", 57, "#FF800D"),
          ("trans_light_blue", 41, "#AEEFEC"), ("trans_blue", 33, "#0020A0"), ("trans_green", 34, "#84B68D")]
PALETTE = [{"id": i, "hex": h} for _, i, h in COLORS]
NAME = {n: k for k, (n, _, _) in enumerate(COLORS)}
MAX = (64, 64, 160)  # studs, studs, plates


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


def _specials_of(p, D):
    """Program part -> special pieces [(id, x, y, z, h, w, ht, d)] in stud/plate cells (or [] if not special)."""
    op = p.get("op", "box")
    x, y, z = float(p.get("x", 0)), float(p.get("y", 0)), int(round(float(p.get("z", 0))))
    out = []
    def put(sid, h, w, d=0, xx=None, yy=None, zz=None):
        ht = SPECIALS[sid]["foot"][2]
        out.append((sid, int(round(x if xx is None else xx)), int(round(y if yy is None else yy)), z if zz is None else zz, h, w, ht, d))
    if op == "wheels":
        sid = "wheels_l" if str(p.get("size", "small")).startswith("l") else "wheels_s"
        if sid == "wheels_s" and D > 5.5:  # small wheels would vanish under a wide body
            sid = "wheels_l"
        h, w, _ = SPECIALS[sid]["foot"]
        yy = p["y"] if "y" in p and p.get("y") is not None and "y_given" in p else D / 2 - w / 2
        put(sid, h, w, 0, yy=yy, zz=int(round(float(p.get("z", 0)))))
    elif op in ("window", "door"):
        sid = "door" if op == "door" else {"2x2": "window_2x2", "2x3": "window_2x3", "4x3": "window_4x3"}.get(str(p.get("size", "2x2")), "window_2x2")
        ln = SPECIALS[sid]["foot"][0]
        if str(p.get("facing", "y")).endswith("x"):  # wall runs along y
            put(sid, 1, ln, 2)
        else:
            put(sid, ln, 1, 0)
    elif op == "arch":
        sid = "arch_6" if int(p.get("len", 4)) >= 6 else "arch_4"
        ln = SPECIALS[sid]["foot"][0]
        put(sid, ln, 1, 0) if str(p.get("along", "x")) == "x" else put(sid, 1, ln, 2)
    elif op == "cone":
        sid = "cone_2" if int(p.get("size", 1)) >= 2 else "cone_1"
        n = SPECIALS[sid]["foot"][0]
        put(sid, n, n)
    elif op == "dish":
        put("dish_2", 2, 2)
    elif op == "curve":
        sid = "curve_2" if int(p.get("w", 1)) >= 2 else "curve_1"
        wd = SPECIALS[sid]["foot"][1]
        d = DIR.get(str(p.get("down", "+x")), 0)
        put(sid, 2, wd, d) if d < 2 else put(sid, wd, 2, d)
    elif op == "cylinder" and p.get("axis", "z") == "z" and float(p.get("r", 9)) <= 1.1:
        # thin standing cylinder: a column of round bricks and plates
        n = 1 if float(p["r"]) <= 0.6 else 2
        x0, y0 = int(round(float(p["x"]) - n / 2)), int(round(float(p["y"]) - n / 2))
        hh, zz = int(round(float(p.get("h", 3)))), z
        while hh >= 3:
            put(f"round_{n}", n, n, 0, x0, y0, zz); zz += 3; hh -= 3
        while hh >= 1:
            put(f"round_p{n}", n, n, 0, x0, y0, zz); zz += 1; hh -= 1
    return out


def program_to_grid(prog, with_specials=False):
    parts = [dict(p) for p in prog["parts"] if isinstance(p, dict)]
    for p in parts:  # forms Gemini sometimes uses instead of the agreed ones
        op = str(p.get("op", "box")).lower()
        if op in ("cut", "hole", "remove", "subtract"):
            p["op"], p["cut"] = "box", True
        elif op in ("cube", "block", "brick", "cuboid", "rect"):
            p["op"] = "box"
        elif op in ("ramp", "slope"):
            p["op"] = "wedge"
    # overhangs may start below 0: shift everything so the grid starts at 0
    def lo(p, k):
        r = float(p.get("r", 0)) if p.get("op") == "cylinder" and p.get("axis", "z") != k else 0
        return float(p.get(k, 0)) - r
    sx = max(0, -int(np.floor(min(lo(p, "x") for p in parts))))
    sy = max(0, -int(np.floor(min(lo(p, "y") for p in parts))))
    for p in parts:
        if "y" in p:
            p["y_given"] = True
        p["x"] = float(p.get("x", 0)) + sx
        p["y"] = float(p.get("y", 0)) + sy
        p["z"] = max(0.0, float(p.get("z", 0))) if p.get("op") != "cylinder" or p.get("axis", "z") == "z" else float(p.get("z", 0))
    X = int(min(MAX[0], max(np.ceil(p.get("x", 0) + p.get("w", p.get("len", p.get("r", 0)))) for p in parts) + 2))
    Y = int(min(MAX[1], max(np.ceil(p.get("y", 0) + p.get("d", p.get("len", p.get("r", 0)))) for p in parts) + 2))
    Z = int(min(MAX[2], max(np.ceil(p.get("z", 0) + p.get("h", p.get("r", 0) * 2.5)) for p in parts) + 2))
    D = float(prog.get("size", {}).get("d", Y - 2 - 2 * sy)) + 2 * sy
    vox = np.zeros((X, Y, Z), bool)
    lab = np.zeros((X, Y, Z), int)
    specials = []  # (id, x, y, z, h, w, ht, d, colour label)
    for p in parts:
        todo = [p]
        if p.get("mirror"):
            q = dict(p)
            if p.get("op") in SPECIAL_OPS:
                pass  # placed mirrored below, once its footprint is known
            elif p.get("op") == "cylinder" and p.get("axis", "z") != "y":
                q["y"] = D - p["y"]
            elif p.get("op") == "cylinder":
                q["y"] = D - p["y"] - p["len"]
            else:
                q["y"] = D - p["y"] - p["d"]
                if p.get("op") == "wedge" and p.get("high", "+x")[1] == "y":
                    q["high"] = {"+y": "-y", "-y": "+y"}[p["high"]]
            todo.append(q)
        for q in todo:
            colour = NAME.get(str(q.get("color", "light_grey")).lower().replace(" ", "_"), NAME["light_grey"])
            sp = _specials_of(q, D) if SPECIALS and (q.get("op") in SPECIAL_OPS or q.get("op") == "cylinder") else []
            if sp:
                if q is not p and q.get("op") in ("curve",):  # mirrored curve faces the other way
                    sp = [(a, b, c, d_, e, f, g, {2: 3, 3: 2}.get(h_, h_)) for a, b, c, d_, e, f, g, h_ in sp]
                for t in sp:
                    sid, x0, y0, z0, h, w, ht, d = t
                    if q is not p and q.get("op") != "wheels":  # mirrored copy: y from the other side
                        y0 = int(round(D - (y0 - 0) - w)) if q.get("op") != "cylinder" else y0
                    x0, y0 = max(0, min(X - h, x0)), max(0, min(Y - w, y0))
                    if z0 + ht > Z:
                        continue
                    specials.append((sid, x0, y0, z0, h, w, ht, d, colour))
                    vox[x0:x0 + h, y0:y0 + w, z0:z0 + ht] = True
                    lab[x0:x0 + h, y0:y0 + w, z0:z0 + ht] = colour
                continue
            try:
                m = _mask(q, X, Y, Z)
            except (KeyError, ValueError, TypeError) as e:
                print("skipped part", q, e)
                continue
            if q.get("cut"):
                vox &= ~m
            else:
                vox |= m
                lab[m] = colour
    # a special piece wins over shape parts that came after it (a later box must not swallow a window)
    for sid, x0, y0, z0, h, w, ht, d, colour in specials:
        vox[x0:x0 + h, y0:y0 + w, z0:z0 + ht] = True
        lab[x0:x0 + h, y0:y0 + w, z0:z0 + ht] = colour
    # trim empty space
    idx = np.argwhere(vox)
    lo, hi = idx.min(0), idx.max(0) + 1
    lo[2] = 0
    # the site's camera looks at the high-y side: turn the model so its front (y=0) faces the viewer
    v = np.ascontiguousarray(vox[lo[0]:hi[0], lo[1]:hi[1], :hi[2]][::-1, ::-1])
    l = np.ascontiguousarray(lab[lo[0]:hi[0], lo[1]:hi[1], :hi[2]][::-1, ::-1])
    if not with_specials:
        return v, l
    Xt, Yt = v.shape[0], v.shape[1]
    turn = {0: 1, 1: 0, 2: 3, 3: 2}
    sp = [(sid, Xt - (x0 - lo[0]) - h, Yt - (y0 - lo[1]) - w, z0, h, w, ht, turn[d], c)
          for sid, x0, y0, z0, h, w, ht, d, c in specials]
    return v, l, sp


def _owned(sid, sizes):
    """May this special piece be used? (sizes None = everything; else all its parts must be in stock)."""
    if sizes is None:
        return True
    have = {s[1] for s in sizes if isinstance(s, tuple) and s[0] == "x"}
    return all(b["p"] in have for b in SPECIALS[sid]["buy"])


def program_to_bricks(prog, sizes=None, slopes=True, hollow_inside=True):
    vox, lab, specials = program_to_grid(prog, with_specials=True)
    vox, lab = support(vox, lab)
    if hollow_inside:
        vox = hollow(vox)
        for sid, x0, y0, z0, h, w, ht, d, c in specials:
            vox[x0:x0 + h, y0:y0 + w, z0:z0 + ht] = True
    # specials we can't use (not in stock) simply become ordinary bricks
    sp = [(h, w, x0, y0, z0, ht, c, "x:" + sid, d) for sid, x0, y0, z0, h, w, ht, d, c in specials if _owned(sid, sizes)]
    inverted = {n for n in ("inv45_1", "inv45_2", "inv33_2") if n in SPECIALS and _owned(n, sizes)}
    return tile_plates(vox, lab, PALETTE, sizes, slopes, sp, inverted)


def parse_sizes(items):
    """["2x4", "p1x2", "s452x2", "t1x2"] -> what the tiler expects; None = everything."""
    if not items:
        return None
    out = []
    for x in items:
        x = x.lower()
        if x.startswith("x"):  # special part number, e.g. "x4600"
            out.append(("x", x[1:]))
            continue
        kind = next((k for k in ("s45", "s33", "t", "p") if x.startswith(k)), "")
        dims = tuple(sorted(map(int, x[len(kind):].split("x"))))
        out.append((kind, dims) if kind else dims)
    return out


def scale_program(prog, f):
    """The same design f times bigger. Shape parts grow; special pieces keep their real size but move
    with the design (wheels become the large ones on a scaled-up vehicle)."""
    if abs(f - 1) < 1e-3:
        return prog
    def span(a, n):  # scale a start and a length so neighbouring parts still meet
        a2 = round(a * f)
        return a2, max(1, round((a + n) * f) - a2)
    out = []
    for p in prog["parts"]:
        if not isinstance(p, dict):
            continue
        q = dict(p)
        op = q.get("op", "box")
        if op == "wheels" and f >= 1.8:
            # real LEGO wheels would look tiny on a model this much bigger: build them from bricks instead
            big = str(q.get("size", "small")).startswith("l")
            r = (1.25 if big else 0.9) * f
            cx = (float(q.get("x", 0)) + (1.5 if big else 1)) * f
            out.append({"op": "cylinder", "axis": "y", "x": round(cx * 2) / 2, "y": -0.5, "z": round(r * 2.5),
                        "r": round(r * 2) / 2, "len": max(1, round(0.6 * f)), "color": "black", "mirror": True})
            out.append({"op": "cylinder", "axis": "y", "x": round(cx * 2) / 2, "y": -0.5, "z": round(r * 2.5),
                        "r": max(0.5, round(r * 0.9)) / 2, "len": 1, "color": "light_grey", "mirror": True})
            continue
        if op == "window" and f >= 1.5:
            # one real window would be lost on a wall this much bigger: a block of real windows instead
            sid = {"2x2": "window_2x2", "2x3": "window_2x3", "4x3": "window_4x3"}.get(str(q.get("size", "2x2")), "window_2x2")
            ln, ht = SPECIALS[sid]["foot"][0], SPECIALS[sid]["foot"][2]
            along_y = str(q.get("facing", "y")).endswith("x")
            nx, nz = max(1, round(f)), max(1, round(f * 0.8))
            x0, y0, z0 = round(float(q.get("x", 0)) * f), round(float(q.get("y", 0)) * f), round(float(q.get("z", 0)) * f)
            for i in range(nx):
                for j in range(nz):
                    w = dict(q, z=z0 + j * ht)
                    w["x"], w["y"] = (x0, y0 + i * ln) if along_y else (x0 + i * ln, y0)
                    out.append(w)
            continue
        if op in SPECIAL_OPS:
            for k in ("x", "y"):
                if k in q:
                    q[k] = round(float(q[k]) * f)
            q["z"] = round(float(q.get("z", 0)) * f)
            if op == "wheels" and f >= 1.4:
                q["size"] = "large"
        elif op == "cylinder":
            for k in ("x", "y", "r", "len"):
                if k in q:
                    q[k] = round(float(q[k]) * f * 2) / 2
            q["z"] = round(float(q.get("z", 0)) * f)
            if "h" in q:
                q["h"] = max(1, round(float(q["h"]) * f))
        else:
            if "x" in q and "w" in q:
                q["x"], q["w"] = span(float(q["x"]), float(q["w"]))
            if "y" in q and "d" in q:
                q["y"], q["d"] = span(float(q["y"]), float(q["d"]))
            if "h" in q:
                q["z"], q["h"] = span(float(q.get("z", 0)), float(q["h"]))
        out.append(q)
    size = dict(prog.get("size") or {})
    for k in ("w", "d"):
        if k in size:
            size[k] = round(float(size[k]) * f)
    return {**prog, "size": size, "parts": out}


def program_to_target(prog, target, sizes=None, max_scale=3.5):
    """Bricks for the design, scaled up (never down) until the piece count is near the target."""
    def build(f, hollow_inside=True):
        return program_to_bricks(scale_program(prog, f), sizes=sizes, hollow_inside=hollow_inside)
    best = build(1.0)
    if not target or len(best) >= 0.75 * target:
        return best
    lo, hi = 1.0, max_scale
    top = build(hi)
    if len(top) < target:  # even the biggest version stays under: a solid one uses more pieces
        solid = build(hi, False)
        return solid if abs(len(solid) - target) < abs(len(top) - target) else top
    for _ in range(7):
        mid = (lo + hi) / 2
        b = build(mid)
        if abs(len(b) - target) < abs(len(best) - target):
            best = b
        if abs(len(b) - target) <= 0.12 * target:
            break
        if len(b) < target:
            lo = mid
        else:
            hi = mid
    return best
