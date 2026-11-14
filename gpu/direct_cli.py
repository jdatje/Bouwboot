"""stdin: {"program": {...}, "sizes": [...]|null, "target": N|null} -> stdout: {"bricks": [...]}.
Used by the web server. With a target piece count the design is scaled up until it comes close."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from direct import program_to_target, parse_sizes

req = json.load(sys.stdin)
try:
    bricks = program_to_target(req["program"], req.get("target"), sizes=parse_sizes(req.get("sizes")))
    json.dump({"bricks": bricks}, sys.stdout)
except Exception as e:  # noqa
    json.dump({"error": str(e)}, sys.stdout)
