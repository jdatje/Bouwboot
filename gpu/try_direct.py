"""Test of option 1: Gemini (text only) writes a building program, direct.py turns it into bricks.
Usage: python gpu/try_direct.py            (needs GEMINI_API_KEY; SUBJECTS = JSON list; STUDS = 16/24/32)
       python gpu/try_direct.py prog.json  (render a hand-written program, no Gemini)"""
import json, os, sys, time, collections
import numpy as np, requests
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
sys.path.insert(0, os.path.dirname(__file__))
from direct import program_to_bricks, COLORS, PALETTE

STUDS = int(os.environ.get("STUDS", "24"))
MODEL = os.environ.get("GEMINI_TEXT_MODEL", "gemini-flash-latest")
HEX = {p["id"]: p["hex"] for p in PALETTE}

SPEC = """You design small LEGO models. You do NOT draw: you write the model as a list of simple solid parts
on a stud grid, and a program turns those into real bricks, plates and roof slopes.

COORDINATES
- x = length (left to right), y = depth (front to back), both in STUDS. z = height in PLATES, z=0 is the ground.
- 1 brick = 3 plates high. 1 stud wide = 2.5 plates high. So something 4 studs wide and equally tall is 10 plates high.
  A door is about 2 studs wide and 15 plates high; one storey of a building is 15-18 plates.
- The front of the model is the side y=0. The model must fit in about {studs} studs for its longest side.

PARTS (applied in order; a later part overwrites what is already there)
- {{"op":"box","x":0,"y":0,"z":0,"w":6,"d":4,"h":9,"color":"red"}}   w along x, d along y (studs), h in plates.
- {{"op":"roof", ... same fields ..., "ridge":"x"}}   gable roof (triangular prism); ridge runs along x or y.
- {{"op":"pyramid", ... same fields ...}}   four-sided point (tower tops, tree tops).
- {{"op":"wedge", ... same fields ..., "high":"+x"}}   ramp: full height at the "high" side (+x,-x,+y,-y), zero at the other.
  Use for bonnets, windscreens, ship bows, tails.
- {{"op":"cylinder","axis":"z","x":5,"y":5,"z":0,"r":2,"h":12,"color":"white"}}   standing cylinder: x,y = centre, z = bottom.
- {{"op":"cylinder","axis":"y","x":4,"y":0,"z":4,"r":1.6,"len":2,"color":"black"}}   lying cylinder (a WHEEL): x = centre,
  z = centre height in plates (for a wheel on the ground: z = r*2.5), y = where it starts, len = thickness in studs.
  axis "x" works the same with x and y swapped.
- Any part can have "cut": true -> it REMOVES material instead (window and door openings, garage doors, the inside
  of a boat, the space under an arch). No color needed.
- Any part can have "mirror": true -> it is also applied mirrored front-to-back (across y = size.d/2). Use it for
  wheels, side windows, wings, legs, so both sides match.

RULES
- Everything must rest on the ground or on another part. Nothing floats. Thin things need something under them.
- Nothing thinner than 1 stud. Masts, poles and legs are 1x1 or 2x2 studs. Sails, wings and walls are 1 stud thick.
- Buildings: make each block solid, then cut 1 stud inside the walls only if you want it open (garages, open doors).
  Windows are easiest as a 1-stud-deep box in another colour (white, medium_blue) set into the wall surface.
- Details in another colour (stripes, lights, windows, eyes) are thin boxes placed ON the surface, overwriting it.
- Use whole numbers for x, y, w, d (half studs only for cylinder centres). Prefer h that are multiples of 3.
- Make it recognisable: get the big shapes and proportions right first, then add 10-30 details. 25-70 parts in total.
- Colours (only these): {colors}.

Answer with JSON only:
{{"plan": "2-4 sentences: the main volumes, their sizes in studs/plates, and where the details go",
  "size": {{"w": <total length x>, "d": <total depth y>}},
  "parts": [ ... ]}}"""


def ask(subject, variation=0):
    text = SPEC.format(studs=STUDS, colors=", ".join(n for n, _, _ in COLORS)) + f"\n\nDesign: {subject}" + (
        f"\n(Variation {variation}: make a clearly different design.)" if variation else "")
    for attempt in range(3):
        r = requests.post(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
                          headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
                          json={"contents": [{"role": "user", "parts": [{"text": text}]}],
                                "generationConfig": {"responseMimeType": "application/json", "temperature": 0.7}}, timeout=180)
        if r.status_code in (429, 500, 503):
            print("retry", r.status_code, r.text[:200], flush=True); time.sleep(20); continue
        r.raise_for_status()
        j = r.json()
        return json.loads(j["candidates"][0]["content"]["parts"][-1]["text"]), j.get("usageMetadata", {})
    raise RuntimeError("Gemini gave no answer")


def render(bricks, title, path):
    X = max(b["x"] + b["h"] for b in bricks); Y = max(b["y"] + b["w"] for b in bricks)
    Z = max(int(round(b["z"] * 3)) + (1 if b.get("p") or b.get("k") == "t" else 3) for b in bricks)
    fig = plt.figure(figsize=(13, 6.5))
    for n, az in enumerate((-60, 120)):
        g = np.zeros((X, Y, Z), bool); c = np.zeros((X, Y, Z, 3))
        for b in bricks:
            z0 = int(round(b["z"] * 3)); ht = 1 if b.get("p") or b.get("k") == "t" else 3
            rgb = [int(HEX[b["c"]][i:i + 2], 16) / 255 for i in (1, 3, 5)]
            g[b["x"]:b["x"] + b["h"], b["y"]:b["y"] + b["w"], z0:z0 + ht] = True
            c[b["x"]:b["x"] + b["h"], b["y"]:b["y"] + b["w"], z0:z0 + ht] = rgb
        ax = fig.add_subplot(1, 2, n + 1, projection="3d")
        ax.voxels(g, facecolors=c, edgecolor="k", linewidth=0.1); ax.view_init(24, az)
        ax.set_box_aspect((X, Y, Z * 0.4)); ax.set_axis_off()
    fig.suptitle(title); fig.tight_layout(); fig.savefig(path, dpi=80); plt.close(fig)


os.makedirs("out", exist_ok=True)
if len(sys.argv) > 1:
    jobs = [(os.path.basename(f).split(".")[0], json.load(open(f)), {}, 0) for f in sys.argv[1:]]
else:
    jobs = []
    for s in json.loads(os.environ.get("SUBJECTS") or '["fire station", "pirate ship"]'):
        t = time.time()
        try:
            prog, use = ask(s)
        except Exception as e:
            print(f"[{s}] FAILED {e}", flush=True); continue
        jobs.append((s, prog, use, time.time() - t))
for i, (s, prog, use, secs) in enumerate(jobs):
    json.dump(prog, open(f"out/direct{i}.json", "w"), indent=1)
    try:
        t = time.time(); bricks = program_to_bricks(prog)
        kinds = collections.Counter(b.get("k", "p" if b.get("p") else "b") for b in bricks)
        print(f"[{s}] {len(prog['parts'])} parts -> {len(bricks)} pieces {dict(kinds)}, gemini {secs:.1f}s, bricks {time.time()-t:.1f}s, "
              f"tokens {use.get('promptTokenCount')}/{use.get('candidatesTokenCount')}/{use.get('thoughtsTokenCount')}", flush=True)
        print("   plan:", str(prog.get("plan"))[:400], flush=True)
        render(bricks, f"{s}: {len(bricks)} pieces ({MODEL}, {STUDS} studs)", f"out/direct{i}.png")
    except Exception as e:
        import traceback; traceback.print_exc(); print(f"[{s}] FAILED in brick step: {e}", flush=True)
