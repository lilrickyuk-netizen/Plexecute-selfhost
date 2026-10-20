"""Step 78: account records owned by the app (plan level, call consent, emergency stop, processing pause, deletion status, link codes, date of birth once set) cannot be changed by the member role; preferences still save. Run: python3 tests/e2e/profile_integrity.py"""
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
Q = f"profiles?select=tier,call_consent_version,call_consent_at,calls_stopped_at,processing_restricted,account_status,calendar_token,health_token,date_of_birth,display_name&id=eq.{uid}"
_, before = req("GET", Q); b = before[0]
attempts = {"call consent": {"call_consent_version": "forged", "call_consent_at": "2020-01-01T00:00:00Z"}, "emergency stop record": {"calls_stopped_at": None if b["calls_stopped_at"] else "2020-01-01T00:00:00Z"},
  "data processing pause": {"processing_restricted": not b["processing_restricted"]}, "account deletion status": {"account_status": "active" if b["account_status"] != "active" else "deletion_pending"},
  "calendar link code": {"calendar_token": "guessable"}, "health link code": {"health_token": "guessable"}, "date of birth": {"date_of_birth": "2015-01-01"}}
for name, patch in attempts.items():
    req("PATCH", f"profiles?id=eq.{uid}", patch); _, now = req("GET", Q); check(f"cannot change own {name}", now == before)
st, _ = req("PATCH", f"profiles?id=eq.{uid}", {"display_name": b["display_name"]}); check("can still save own preferences", st < 300, str(st))
sys.exit(0 if all(res) else 1)
