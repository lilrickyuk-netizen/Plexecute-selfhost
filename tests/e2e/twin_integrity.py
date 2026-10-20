"""Step 77: Life Twin provenance: members add only facts they state themselves and correct by new version; source, value and confidence of history cannot be rewritten. Run: python3 tests/e2e/twin_integrity.py"""
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
st, _ = req("POST", "life_twin_facts", {"user_id": uid, "domain": "health", "fact_key": "resting_hr", "fact_value": 40, "source": "OBSERVED", "confidence": 1}); check("cannot add a fact pretending to come from a device", st >= 400, str(st))
_, rows = req("GET", f"life_twin_facts?select=id,fact_value,source,is_locked&user_id=eq.{uid}&valid_until=is.null&limit=1")
f = rows[0]
st, _ = req("PATCH", f"life_twin_facts?id=eq.{f['id']}", {"source": "OBSERVED"}); check("cannot change where a fact came from", st >= 400, str(st))
st, _ = req("PATCH", f"life_twin_facts?id=eq.{f['id']}", {"fact_value": "edited"}); check("cannot rewrite a fact's history", st >= 400, str(st))
st, _ = req("PATCH", f"life_twin_facts?id=eq.{f['id']}", {"is_locked": not f["is_locked"]}); req("PATCH", f"life_twin_facts?id=eq.{f['id']}", {"is_locked": f["is_locked"]})
check("can still lock and unlock a fact", st < 300, str(st))
_, after = req("GET", f"life_twin_facts?select=id,fact_value,source,is_locked&id=eq.{f['id']}"); check("fact unchanged afterwards", after == [f])
sys.exit(0 if all(res) else 1)
