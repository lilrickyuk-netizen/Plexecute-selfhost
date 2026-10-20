"""Step 73: the plan can only change through approved server paths. Tries forbidden browser-role writes with the member's own token; all must be refused, so nothing changes. Run: python3 tests/e2e/plan_integrity.py"""
import json, os, sys, urllib.request
s = __import__("_member").session_file()
env = dict(l.split("=", 1) for l in open(".env").read().splitlines() if "=" in l)
URL = env["VITE_SUPABASE_URL"].strip('"'); KEY = env["VITE_SUPABASE_PUBLISHABLE_KEY"].strip('"')
H = {"apikey": KEY, "Authorization": "Bearer " + s["session"]["access_token"], "Content-Type": "application/json", "Prefer": "return=representation"}
def req(m, path, body=None):
    r = urllib.request.Request(URL + "/rest/v1/" + path, method=m, headers=H, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(r) as x: return x.status, json.loads(x.read() or b"[]")
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:120]
res = []
def check(n, ok, i=""): res.append(ok); print(("PASS " if ok else "FAIL ") + n, i)
st, rows = req("GET", "plan_blocks?select=id,status,starts_at&status=eq.planned&limit=1")
check("member can read own planned session", st == 200 and len(rows) == 1, str(st))
bid = rows[0]["id"] if rows else "00000000-0000-0000-0000-000000000000"
for name, body in [("mark done directly", {"status": "done"}), ("move time directly", {"starts_at": "2030-01-01T09:00:00Z"}), ("change source directly", {"source_type": "manual"})]:
    st, out = req("PATCH", f"plan_blocks?id=eq.{bid}", body)
    check(f"browser cannot {name}", st >= 400 or out == [], f"{st}")
st, out = req("DELETE", f"plan_blocks?id=eq.{bid}")
check("browser cannot delete a session", st >= 400 or out == [], str(st))
st, after = req("GET", f"plan_blocks?select=id,status,starts_at&id=eq.{bid}")
check("session unchanged afterwards", after == rows, "")
st, out = req("PATCH", "plan_versions?status=eq.proposed", {"status": "applied"})
check("browser cannot approve a proposal directly", st >= 400 or out == [], str(st))
st, out = req("POST", "user_roles", {"user_id": s["session"]["user"]["id"], "role": "moderator"})
check("browser cannot grant itself a role", st >= 400, str(st))
sys.exit(0 if all(res) else 1)
