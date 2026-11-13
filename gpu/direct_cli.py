"""stdin: {"program": {...}, "sizes": [...]|null, "target": N|null} -> stdout: {"bricks": [...]}.
Used by the web server. With a target piece count, both a hollow and a solid version are made and
the one closest to the target wins (solid uses far more pieces, so it helps big builds reach their size)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from direct import program_to_bricks, parse_sizes

req = json.load(sys.stdin)
try:
    sizes = parse_sizes(req.get("sizes"))
    target = req.get("target")
    best = program_to_bricks(req["program"], sizes=sizes, hollow_inside=True)
    if target and len(best) < 0.7 * target:
        solid = program_to_bricks(req["program"], sizes=sizes, hollow_inside=False)
        if abs(len(solid) - target) < abs(len(best) - target):
            best = solid
    json.dump({"bricks": best}, sys.stdout)
except Exception as e:  # noqa
    json.dump({"error": str(e)}, sys.stdout)
