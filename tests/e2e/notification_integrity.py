"""Step 79: notification delivery records are server-owned; members may only mark read and record a known response. Run: python3 tests/e2e/notification_integrity.py"""
import json, os, sys, urllib.request
s = __import__("_member").session_file(); uid = s["session"]["user"]["id"]
env = dict(l.split("=", 1) for l in open(".env").read().splitlines() if "=" in l)
URL = env["VITE_SUPABASE_URL"].strip('"'); KEY = env["VITE_SUPABASE_PUBLISHABLE_KEY"].strip('"')
H = {"apikey": KEY, "Authorization": "Bearer " + s["session"]["access_token"], "Content-Type": "application/json", "Prefer": "return=representation"}
def req(m, path, body=None):
    r = urllib.request.Request(URL + "/rest/v1/" + path, method=m, headers=H, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(r) as x: return x.status, json.loads(x.read() or b"[]")
    except urllib.error.HTTPError as e: return e.code, None
res = []
def check(n, ok, i=""): res.append(ok); print(("PASS " if ok else "FAIL ") + n, i)
_, rows = req("GET", f"notifications?select=*&user_id=eq.{uid}&limit=1")
if not rows: check("member has a notification to test", False); sys.exit(1)
n = rows[0]
for name, patch in {"wording": {"title": "edited"}, "delivery status": {"status": "failed" if n["status"] != "failed" else "sent"}, "retry count": {"attempts": (n["attempts"] or 0) + 5}, "send time": {"sent_at": "2020-01-01T00:00:00Z"}}.items():
    st, _ = req("PATCH", f"notifications?id=eq.{n['id']}", patch); check(f"cannot change a notification's {name}", st >= 400, str(st))
st, _ = req("PATCH", f"notifications?id=eq.{n['id']}", {"interaction": "hacked"}); check("cannot record an unknown response", st >= 400, str(st))
st, _ = req("PATCH", f"notifications?id=eq.{n['id']}", {"read_at": n["read_at"], "interaction": n["interaction"], "interaction_at": n["interaction_at"]}); check("can still mark read / respond", st < 300, str(st))
_, after = req("GET", f"notifications?select=*&id=eq.{n['id']}"); check("notification unchanged afterwards", after == [n])
sys.exit(0 if all(res) else 1)
