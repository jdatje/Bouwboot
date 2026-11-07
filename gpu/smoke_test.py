"""Calls the deployed GPU service with a few captions and renders the results to PNGs."""
import hashlib, json, os, sys, time
import requests
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

url = sys.argv[1].rstrip("/")
key = hashlib.sha256(("bouwboot:" + os.environ["MODAL_TOKEN_SECRET"]).encode()).hexdigest()
H = {"Authorization": f"Bearer {key}"}
os.makedirs("out", exist_ok=True)

r = requests.get(url + "/health", headers=H, timeout=600)
print("health", r.status_code, r.text)
assert requests.get(url + "/health", timeout=60).status_code == 401, "auth not enforced"

captions = json.loads(os.environ.get("CAPTIONS") or "[]") or [
    "Table featuring a flat rectangular surface over four evenly spaced legs.",
    "A crocodile: long low flat body, four short stubby legs, a long tapering tail and a long flat snout.",
    "A dog standing on four legs with a rectangular body, a raised head and a short tail.",
    "A small house with four walls, a door opening and a pitched roof.",
]
for i, cap in enumerate(captions):
    t = time.time(); events = []; bricks = []
    with requests.post(url + "/generate", headers=H, json={"caption": cap, "seed": 7}, stream=True, timeout=900) as resp:
        for line in resp.iter_lines():
            if line.startswith(b"data: "):
                ev = json.loads(line[6:]); events.append(ev["type"])
                if ev["type"] == "done": bricks = ev["bricks"]
                if ev["type"] == "error": print("ERROR", ev)
    dt = time.time() - t
    print(f"[{i}] {cap!r}: {len(bricks)} bricks in {dt:.1f}s; events: brick={events.count('brick')} rollback={events.count('rollback')}")
    open(f"out/{i}.txt", "w").write(cap + "\n" + "\n".join(bricks))
    vox = np.zeros((20, 20, 20), bool); cols = np.empty(vox.shape, object)
    pal = ["#c91a09", "#0055bf", "#f2cd37", "#237841", "#fe8a18", "#a0a5a9"]
    import re
    for j, b in enumerate(bricks):
        h, w, x, y, z = map(int, re.findall(r"\d+", b))
        vox[x:x+h, y:y+w, z] = True; cols[x:x+h, y:y+w, z] = pal[j % len(pal)]
    fig = plt.figure(figsize=(10, 5))
    for k, (el, az) in enumerate([(25, -60), (25, 30)]):
        ax = fig.add_subplot(1, 2, k + 1, projection="3d")
        ax.voxels(vox, facecolors=cols, edgecolor="k", linewidth=0.2)
        ax.view_init(el, az); ax.set_box_aspect((1, 1, 1.2 * 0.5)); ax.set_axis_off()
    fig.suptitle(f"{cap[:70]} ({len(bricks)} bricks, {dt:.0f}s)", fontsize=8)
    fig.savefig(f"out/{i}.png", dpi=90); plt.close(fig)
