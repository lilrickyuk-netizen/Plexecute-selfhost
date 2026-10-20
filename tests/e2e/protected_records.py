"""Step 74: money, entitlement, evidence and secrets cannot be written or read by the member's browser role. All attempts must be refused, so nothing changes. Run: python3 tests/e2e/protected_records.py"""
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
refused = lambda st, out: st >= 400 or out == []
for t in ["subscriptions", "execution_rewards", "outcome_ledger", "evidence_claims", "call_campaigns", "consent_records", "safety_flags", "entitlement_ledger"]:
    st, out = req("POST", t, {"user_id": uid}); check(f"cannot create {t}", st >= 400, str(st))
    st, out = req("PATCH", f"{t}?user_id=eq.{uid}", {"user_id": uid}); check(f"cannot edit {t}", refused(st, out), str(st))
_, before = req("GET", f"profiles?select=tier&id=eq.{uid}")
st, out = req("PATCH", f"profiles?id=eq.{uid}", {"tier": "execute" if before and before[0]["tier"] != "execute" else "free"})
_, after = req("GET", f"profiles?select=tier&id=eq.{uid}"); check("cannot change own plan tier", after == before, f"{st} {before}")
for t in ["calendar_credentials", "wearable_credentials", "phone_numbers", "feature_flags"]:
    st, out = req("GET", f"{t}?select=*&limit=1"); check(f"cannot read {t}", st >= 400 or out == [], str(st))
st, out = req("POST", "feature_flags", {"key": "coach_ai", "enabled": False}); check("cannot switch a flag", st >= 400, str(st))
st, out = req("POST", "incidents", {"title": "x"}); check("cannot open an incident", st >= 400, str(st))
sys.exit(0 if all(res) else 1)
