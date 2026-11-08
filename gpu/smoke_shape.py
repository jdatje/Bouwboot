"""Gemini draws a toy, TripoSR makes it 3D, we turn it into bricks; renders the result."""
import base64, hashlib, json, os, sys, time, re
import requests
import io
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

url = sys.argv[1].rstrip("/")
key = hashlib.sha256(("bouwboot:" + os.environ["MODAL_TOKEN_SECRET"]).encode()).hexdigest()
H = {"Authorization": f"Bearer {key}"}
G = os.environ["GEMINI_API_KEY"]
os.makedirs("out", exist_ok=True)
PRE = os.environ.get("OUT_PREFIX", "")
PLATES = os.environ.get("PLATES") == "1"
PAL = [("#F4F4F4", 15), ("#1B2A34", 0), ("#A0A5A9", 71), ("#6C6E68", 72), ("#C91A09", 4), ("#720E0F", 320), ("#FE8A18", 25),
       ("#F8BB3D", 191), ("#F2CD37", 14), ("#BBE90B", 27), ("#4B9F4A", 10), ("#237841", 2), ("#184632", 288), ("#9B9A5A", 326),
       ("#A0BCAC", 378), ("#36AEBF", 322), ("#5A93DB", 73), ("#0055BF", 1), ("#0A3463", 272), ("#E4ADC8", 29), ("#C870A0", 5),
       ("#E4CD9E", 19), ("#958A73", 28), ("#D09168", 92), ("#582A12", 70), ("#352100", 308)]
palette = [{"id": i, "hex": h} for h, i in PAL]
hexof = {i: h for h, i in PAL}

def draw(subject):
    prompt = (f"A single {subject}, designed as a simple chunky toy, shown in full in a three-quarter view from slightly above, "
              "centered, on a plain pure white background, no shadow, no text, no stand, bright solid colours, simple shapes.")
    for model in ["gemini-3.1-flash-image", "gemini-2.5-flash-image"]:
        r = requests.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                          headers={"x-goog-api-key": G, "content-type": "application/json"},
                          json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseModalities": ["IMAGE"]}}, timeout=120)
        if r.ok:
            for p in r.json()["candidates"][0]["content"]["parts"]:
                if "inlineData" in p:
                    print("image by", model)
                    return p["inlineData"]["data"]
        print(model, r.status_code, r.text[:200])
    raise SystemExit("no image")

print(requests.get(url + "/health", headers=H, timeout=600).text)
subjects = json.loads(os.environ.get("SUBJECTS") or "[]")
# without SUBJECTS the saved drawings in gpu/fixtures are used (no Gemini cost)
fixtures = {} if subjects else {n: f"gpu/fixtures/{n}.png" for n in ["boat", "crocodile", "dog", "house"]}
subjects = subjects or list(fixtures)
for i, s in enumerate(subjects):
    img = base64.b64encode(open(fixtures[s], "rb").read()).decode() if s in fixtures else draw(s)
    open(f"out/{PRE}s{i}.png", "wb").write(base64.b64decode(img))
    t = time.time()
    r = requests.post(url + "/shape", headers=H, json={"image": img, "palette": palette, "plates": PLATES}, timeout=900)
    if not r.ok:
        print(s, "FAILED", r.status_code, r.text[:500]); continue
    j = r.json(); bricks = j["bricks"]
    print(f"[{s}] {len(bricks)} bricks, {time.time()-t:.1f}s, stats {j['stats']}", flush=True)
    # draw in plate units (3 per brick)
    def zr(b):
        z0 = int(round(b["z"] * 3)); return z0, z0 + (1 if b.get("p") else 3)
    X = max(b["x"] + b["h"] for b in bricks); Y = max(b["y"] + b["w"] for b in bricks); Z = max(zr(b)[1] for b in bricks)
    g = np.zeros((X, Y, Z), bool); c = np.empty(g.shape, object)
    for b in bricks:
        z0, z1 = zr(b)
        g[b["x"]:b["x"]+b["h"], b["y"]:b["y"]+b["w"], z0:z1] = True; c[b["x"]:b["x"]+b["h"], b["y"]:b["y"]+b["w"], z0:z1] = hexof[b["c"]]
    fig = plt.figure(figsize=(12, 4))
    from PIL import Image
    ax0 = fig.add_subplot(1, 3, 1); ax0.imshow(Image.open(f"out/{PRE}s{i}.png")); ax0.axis("off")
    for k, az in enumerate([-60, 30]):
        ax = fig.add_subplot(1, 3, k + 2, projection="3d")
        ax.voxels(g, facecolors=c, edgecolor="k", linewidth=0.15); ax.view_init(22, az)
        ax.set_box_aspect((X, Y, Z * 0.4)); ax.set_axis_off()
    fig.suptitle(f"{s}: {len(bricks)} pieces"); fig.savefig(f"out/{PRE}shape{i}.png", dpi=80); plt.close(fig)
