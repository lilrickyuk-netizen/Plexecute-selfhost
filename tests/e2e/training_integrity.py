"""Step 76: workout sets are saved only by the server during an in-progress workout; the member browser role cannot add, edit or delete them. Run: python3 tests/e2e/training_integrity.py"""
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
st, _ = req("POST", "workout_sets", {"user_id": uid, "exercise": "fake", "weight_kg": 500, "reps": 50, "set_number": 1}); check("cannot add a fake workout set", st >= 400, str(st))
_, before = req("GET", f"workout_sets?select=id,weight_kg&user_id=eq.{uid}&order=id")
st, out = req("PATCH", f"workout_sets?user_id=eq.{uid}", {"weight_kg": 999}); _, a1 = req("GET", f"workout_sets?select=id,weight_kg&user_id=eq.{uid}&order=id")
check("cannot edit logged sets", (st >= 400 or out == []) and a1 == before, str(st))
st, out = req("DELETE", f"workout_sets?user_id=eq.{uid}"); _, a2 = req("GET", f"workout_sets?select=id,weight_kg&user_id=eq.{uid}&order=id")
check("cannot delete logged sets", (st >= 400 or out == []) and a2 == before, f"{st} rows={len(before or [])}")
st, _ = req("GET", "workout_sets?select=id&limit=1"); check("can still read own sets", st == 200, str(st))
sys.exit(0 if all(res) else 1)
