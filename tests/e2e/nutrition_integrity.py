"""Step 75: the member's browser role cannot write food log nutrients directly; entries come only from the server calculation. Run: python3 tests/e2e/nutrition_integrity.py"""
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
st, _ = req("POST", "food_entries", {"user_id": uid, "name": "fake", "kcal": 1, "protein_g": 500}); check("cannot add a food entry with made-up nutrients", st >= 400, str(st))
_, before = req("GET", f"food_entries?select=id,kcal&user_id=eq.{uid}&order=id")
st, out = req("PATCH", f"food_entries?user_id=eq.{uid}", {"kcal": 0}); _, after = req("GET", f"food_entries?select=id,kcal&user_id=eq.{uid}&order=id")
check("cannot edit logged nutrients", (st >= 400 or out == []) and after == before, str(st))
st, out = req("GET", f"food_entries?select=id&limit=1"); check("can still read own food log", st == 200, str(st))
sys.exit(0 if all(res) else 1)
