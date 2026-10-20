"""Disposable test member for live tests: created with the service role, signed in through the real login page,
deleted afterwards. Never touches a real member's account."""
import json, os, time, uuid, requests

BASE = "http://localhost:8080"
URL = os.environ["SUPABASE_URL"]
SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": SR, "Authorization": f"Bearer {SR}", "Content-Type": "application/json", "Prefer": "return=representation"}


def create(tier="pro", **profile):
    email = f"e2e-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"
    pw = "E2e!" + uuid.uuid4().hex
    r = requests.post(f"{URL}/auth/v1/admin/users", headers=H, timeout=30,
                      json={"email": email, "password": pw, "email_confirm": True,
                            "user_metadata": {"date_of_birth": "1990-05-01"}})
    r.raise_for_status()
    uid = r.json()["id"]
    for _ in range(20):
        if requests.get(f"{URL}/rest/v1/profiles?id=eq.{uid}&select=id", headers=H, timeout=30).json():
            break
        time.sleep(0.5)
    body = {"onboarded": True, "tier": tier, "display_name": "Test Member", "timezone": "Europe/London",
            "billing_country": "GB", **profile}
    requests.patch(f"{URL}/rest/v1/profiles?id=eq.{uid}", headers=H, json=body, timeout=30).raise_for_status()
    return {"id": uid, "email": email, "password": pw}


def session(m):
    """Access-token session for scripts that call the REST API as the member."""
    r = requests.post(f"{URL}/auth/v1/token?grant_type=password", timeout=30,
                      headers={"apikey": os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY") or SR},
                      json={"email": m["email"], "password": m["password"]})
    r.raise_for_status()
    return r.json()


async def login(page, m):
    await page.goto(f"{BASE}/login", wait_until="networkidle")
    await page.fill("#email", m["email"])
    await page.fill("#pw", m["password"])
    await page.get_by_role("button", name="Log in").click()
    await page.wait_for_url("**/app/**", timeout=60000)


def delete(m):
    if m and m.get("id"):
        requests.delete(f"{URL}/auth/v1/admin/users/{m['id']}", headers=H, timeout=30)


def session_file(tier="execute", admin=False):
    """Drop-in replacement for the owner's ~/.cache/lovable-auth/session.json: a fresh disposable member,
    signed in, with the same {storage_key, session} shape. The member is deleted when the script exits."""
    import atexit
    m = create(tier)
    atexit.register(delete, m)
    seed(m)
    if admin:
        requests.post(f"{URL}/rest/v1/user_roles", headers=H, json={"user_id": m["id"], "role": "admin"}, timeout=30).raise_for_status()
    ref = URL.split("//")[1].split(".")[0]
    return {"storage_key": f"sb-{ref}-auth-token", "session": session(m), "member": m, "cookies": []}


def seed(m):
    """Minimal everyday data an established member has: a stated fact, a goal with an upcoming session, a notification."""
    import datetime as D
    uid = m["id"]
    post = lambda t, b: requests.post(f"{URL}/rest/v1/{t}", headers=H, json=b, timeout=30).json()
    post("life_twin_facts", {"user_id": uid, "domain": "work", "fact_key": "work_pattern", "fact_value": "9-5 weekdays", "source": "USER_ASSERTED", "confidence": 1})
    g = post("goals", {"user_id": uid, "title": "Get stronger", "domain": "training", "status": "active", "weekly_minutes": 120, "session_minutes": 40})[0]
    start = (D.datetime.now(D.timezone.utc) + D.timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)
    post("plan_blocks", {"user_id": uid, "goal_id": g["id"], "title": "Workout: strength", "domain": "training", "duration_min": 40, "starts_at": start.strftime("%Y-%m-%dT%H:%M:%SZ"), "status": "planned"})
    post("notifications", {"user_id": uid, "channel": "in_app", "title": "Your session is tomorrow", "dedupe_key": f"e2e-{uid}"})
