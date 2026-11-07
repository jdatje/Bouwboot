"""End-to-end check against the real services: design a few things, add a set, take screenshots."""
import json, os, sys, time, urllib.request
from playwright.sync_api import sync_playwright

base = "http://localhost:3000"
out = "e2e"
os.makedirs(out, exist_ok=True)
prompts = json.loads(os.environ.get("PROMPTS") or "[]") or ["krokodil"]
report = []

def api(path, body=None):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body else None,
                                 headers={"content-type": "application/json"}, method="POST" if body else "GET")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())

# warehouse: add a Lego City set via Rebrickable
try:
    r = api("/api/stock/sets", {"set_num": "60337"})
    report.append(f"set: {r}")
except Exception as e:
    report.append(f"set FAILED: {e}")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1366, "height": 860})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    engines = (os.environ.get("ENGINES") or "3d,brickgpt").split(",")
    runs = [(q, m) for q in prompts for m in engines]
    for i, (q, m) in enumerate(runs):
        t = time.time()
        pg.goto(base + "/bouwwerk/nieuw?q=" + urllib.request.quote(q) + f"&m={m}&t={i}")
        shots = 0
        while time.time() - t < 300:
            if pg.locator("text=Andere vorm").count() or pg.locator(".status.err").count():
                break
            if time.time() - t > 20 * (shots + 1) and shots < 4:
                pg.screenshot(path=f"{out}/{i}-live-{shots}.png"); shots += 1
            time.sleep(2)
        time.sleep(3)
        pg.screenshot(path=f"{out}/{i}-done.png")
        status = pg.locator(".status").inner_text() if pg.locator(".status").count() else "ok"
        title = pg.locator("h1").first.inner_text()
        have = pg.locator(".have").inner_text() if pg.locator(".have").count() else ""
        report.append(f"[{q} / {m}] {time.time() - t:.0f}s title={title!r} status={status!r} {have}")
        if i < 2 and pg.locator("text=Andere kleuren").count():
            pg.click("text=Andere kleuren"); time.sleep(12)
            pg.screenshot(path=f"{out}/{i}-recolor.png")
            pg.click("text=Begin met bouwen"); time.sleep(1.5)
            pg.screenshot(path=f"{out}/{i}-step1.png")
    # only-my-bricks design
    pg.goto(base + "/bouwwerk/nieuw?q=" + urllib.request.quote("een klein huisje") + "&mijn=1&m=3d&t=x")
    t = time.time()
    while time.time() - t < 300 and not (pg.locator("text=Andere vorm").count() or pg.locator(".status.err").count()):
        time.sleep(2)
    time.sleep(3)
    pg.screenshot(path=f"{out}/mine-done.png")
    report.append(f"[mijn] {time.time() - t:.0f}s " + (pg.locator(".have").inner_text() if pg.locator(".have").count() else pg.locator(".status").inner_text()))
    pg.goto(base + "/magazijn"); time.sleep(3); pg.screenshot(path=f"{out}/magazijn.png", full_page=True)

    # scanning: Gemini draws a photo of loose bricks, then we scan it through the page
    try:
        import base64, json as _j
        G = os.environ["GEMINI_API_KEY"]
        req = urllib.request.Request(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent",
            data=_j.dumps({"contents": [{"parts": [{"text": "A realistic top-down phone photo of about 15 loose LEGO bricks (2x4, 2x2, 1x2, 1x4 in red, blue, yellow, green, white) spread out on a white table, not touching each other, even daylight."}]}],
                           "generationConfig": {"responseModalities": ["IMAGE"]}}).encode(),
            headers={"content-type": "application/json", "x-goog-api-key": G})
        with urllib.request.urlopen(req, timeout=120) as r:
            parts = _j.loads(r.read())["candidates"][0]["content"]["parts"]
        data = next(p["inlineData"]["data"] for p in parts if "inlineData" in p)
        open(f"{out}/scan-input.jpg", "wb").write(base64.b64decode(data))
        pg.goto(base + "/magazijn/scan"); time.sleep(1)
        t = time.time()
        pg.set_input_files("input[type=file]", f"{out}/scan-input.jpg")
        while time.time() - t < 180 and not (pg.locator(".grid .item").count() or pg.locator(".err").count()):
            time.sleep(2)
        time.sleep(1)
        pg.screenshot(path=f"{out}/scan-review.png", full_page=True)
        n = pg.locator(".grid .item").count(); unsure = pg.locator(".grid .item.unsure").count()
        report.append(f"[scan] {time.time() - t:.0f}s {n} items, {unsure} unsure" + (" ERR " + pg.locator(".err").inner_text() if pg.locator(".err").count() else ""))
        if n:
            pg.click(".bottom button.primary"); time.sleep(3)
            report.append("[scan] after confirm: " + pg.locator("p.muted").first.inner_text())
    except Exception as e:
        report.append(f"[scan] FAILED {e}")
    report.append(f"page errors: {errs[:5]}")
    b.close()

open(f"{out}/report.txt", "w").write("\n".join(report))
print("\n".join(report))
