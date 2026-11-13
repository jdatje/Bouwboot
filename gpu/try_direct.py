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

SPEC = open(os.path.join(os.path.dirname(__file__), "direct_prompt.txt")).read()



def ask(subject, variation=0):
    text = SPEC.replace("__STUDS__", str(STUDS)).replace("__PIECES__", os.environ.get("PIECES", "300")).replace("__COLORS__", ", ".join(n for n, _, _ in COLORS)) + f"\n\nDesign: {subject}" + (
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
