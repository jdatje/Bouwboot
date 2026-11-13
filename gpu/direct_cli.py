"""stdin: {"program": {...}, "sizes": [...]|null} -> stdout: {"bricks": [...]}. Used by the web server."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from direct import program_to_bricks, parse_sizes

req = json.load(sys.stdin)
try:
    bricks = program_to_bricks(req["program"], sizes=parse_sizes(req.get("sizes")))
    json.dump({"bricks": bricks}, sys.stdout)
except Exception as e:  # noqa
    json.dump({"error": str(e)}, sys.stdout)
