"""Live: Life Intelligence Layer through the real Coach. Usage: python3 life_intelligence.py A|B"""
import asyncio, json, os, re, sys, time, uuid, requests, datetime as D
sys.path.insert(0, os.path.dirname(__file__))
import real_world_bookings as R
from playwright.async_api import async_playwright
URL, H, get = R.URL, R.H, R.get
P = F = 0
def ok(name, cond, info=""):
    global P, F
    if cond: P += 1; print("PASS", name, flush=True)
    else: F += 1; print("FAIL", name, "::", str(info)[:500], flush=True)
def post(t, rows):
    r = requests.post(f"{URL}/rest/v1/{t}", headers=H, json=rows, timeout=30)
    if not r.ok: print("SEED FAIL", t, r.text[:300])
    r.raise_for_status(); return r.json()

def seed_rich(uid):
    now = D.datetime.now(D.timezone.utc); today = now.date()
    requests.patch(f"{URL}/rest/v1/profiles?id=eq.{uid}", headers=H, json={"work_start": "09:00", "work_end": "17:30", "work_days": [1, 2, 3, 4, 5]}).raise_for_status()
    post("life_twin_facts", {"user_id": uid, "domain": "other", "fact_key": "five_year_vision", "source": "USER_ASSERTED", "confidence": 1,
        "fact_value": {"summary": "Own a construction firm and live abroad", "objectives": [{"area": "business", "text": "Own a construction company"}, {"area": "travel", "text": "Live abroad for a year"}], "_confirmed": True}})
    dl = (today + D.timedelta(days=365)).isoformat()
    q = post("goals", {"user_id": uid, "title": "Complete construction management qualification", "domain": "learning", "status": "active", "weekly_minutes": 120, "session_minutes": 60, "deadline": dl, "priority_class": "important", "pathway": {"resources": [{"kind": "money", "title": "Course fees", "amount": 4800}]}})[0]
    b = post("goals", {"user_id": uid, "title": "Run my own construction company", "domain": "career", "status": "active", "weekly_minutes": 60, "session_minutes": 60, "dependencies": [q["id"]], "why": "Own a construction company"})[0]
    h = post("goals", {"user_id": uid, "title": "Save for a house deposit", "domain": "finance", "status": "active", "weekly_minutes": 0, "session_minutes": 30, "monthly_saving": 500, "current_value": 1000, "baseline_value": 0, "target_value": 20000, "target_unit": "GBP", "deadline": dl, "priority_class": "important"})[0]
    g = post("goals", {"user_id": uid, "title": "Get stronger", "domain": "training", "status": "active", "weekly_minutes": 180, "session_minutes": 60})[0]
    post("goals", {"user_id": uid, "title": "Learn guitar", "domain": "other", "status": "proposed", "weekly_minutes": 60, "session_minutes": 30})
    post("goal_milestones", [
        {"goal_id": q["id"], "user_id": uid, "key": "enrol", "title": "Enrol on the course", "stage": 1, "depends_on": [], "status": "done", "done_at": (now - D.timedelta(days=20)).isoformat(), "position": 1},
        {"goal_id": q["id"], "user_id": uid, "key": "m2", "title": "Study module 2", "stage": 2, "depends_on": ["enrol"], "status": "pending", "done_at": None, "position": 2}])
    bl = []
    # Evening gym straight after work: mostly missed (weekdays, 18:30 London ~ 17:30Z in BST).
    d = now - D.timedelta(days=1); n = 0
    while n < 6:
        if d.weekday() < 5:
            t = d.replace(hour=17, minute=30, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
            bl.append({"user_id": uid, "goal_id": g["id"], "title": "Gym: strength", "domain": "training", "duration_min": 60, "starts_at": t, "status": "done" if n == 5 else "expired", "completed_at": t if n == 5 else None})
            n += 1
        d -= D.timedelta(days=1)
    tm = (now + D.timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
    bl.append({"user_id": uid, "goal_id": q["id"], "title": "Study: module 2", "domain": "learning", "duration_min": 60, "starts_at": tm, "status": "planned", "completed_at": None})
    post("plan_blocks", bl)
    post("commitments", {"user_id": uid, "title": "Dentist check-up", "kind": "appointment", "recurrence": "once", "on_date": today.isoformat(), "start_time": "16:00", "end_time": "16:30", "active": True, "source": "manual"})
    return q, b, h, g

async def run(which):
    async with async_playwright() as pl:
        br = await pl.chromium.launch(headless=True); uids = []
        try:
            uid, page = await R.member(br, "pro"); uids.append(uid)
            say = lambda q: R.say(page, uid, q)
            if which == "A":
                q, b, h, g = seed_rich(uid)
                await page.goto(f"{R.BASE}/app/coach", wait_until="networkidle"); await page.wait_for_timeout(1500)
                a, t = await say("Brief me on my day.")
                ok("daily brief uses brief tool", "brief_my_day" in t, t)
                ok("brief names real items only", re.search(r"dentist", a, re.I) and not re.search(r"weather|°c|forecast|headline", a, re.I), a)
                a, t = await say("Why is the module 2 study session on my plan?")
                ok("explain uses real chain", "explain_plan_item" in t and re.search(r"qualification", a, re.I) and re.search(r"construction company", a, re.I), (t, a))
                a, t = await say("Am I on track with my house deposit?")
                ok("trajectory is evidence-based", "get_life_intelligence" in t and re.search(r"behind|later|not on track|off track", a, re.I), (t, a))
                a, t = await say("I keep missing my gym sessions. What's going on?")
                ok("pattern identified with cause", re.search(r"after work|straight after|evening|17:30|end of (the|your) work", a, re.I), a)
                a, t = await say("Yes, change the plan so gym isn't straight after work.")
                pv = get("plan_versions", f"user_id=eq.{uid}&select=rationale,status&order=created_at.desc&limit=1")
                acts = [x for x in (t or [])]
                ok("replan queued through existing planner", "request_replan" in acts or "edit_plan" in acts, acts)
                a, t = await say("I have £600 a month available for my goals. Can I fund both the qualification and the house saving?")
                ok("money conflict detected, not assumed", re.search(r"(£\s?)?(900|1,?000|more than|exceed|short|can't do both|cannot do both|not enough)", a, re.I) and "?" in a, a)
                a, t = await say("What part of my five-year direction am I currently ignoring?")
                ok("vision gap truthful", re.search(r"abroad", a, re.I), a)
                a, t = await say("List my goals by status: which are active and which are only proposed?")
                ok("status truth: guitar is proposed", re.search(r"propos.{0,120}guitar|guitar.{0,40}propos", a, re.I | re.S) and not re.search(r"5 active", a, re.I), a)
                a, t = await say("How did my week go?")
                ok("weekly review tool", "review_my_week" in t and re.search(r"miss|done|complet", a, re.I), (t, a))
                live = get("life_links", f"user_id=eq.{uid}&invalidated_at=is.null&select=link_key,goal_id")
                ok("relationships persisted", any(l["goal_id"] == q["id"] for l in live) and any("vision" in l["link_key"] for l in live), live[:5])
                requests.delete(f"{URL}/rest/v1/goals?id=eq.{q['id']}", headers=H).raise_for_status()
                a, t = await say("Why is the study session on my plan now?")
                live = get("life_links", f"user_id=eq.{uid}&invalidated_at=is.null&select=link_key,goal_id")
                ok("removed goal's relationships gone", not any(l["goal_id"] == q["id"] or q["id"] in l["link_key"] for l in live), live)
                ev = get("intelligence_events", f"user_id=eq.{uid}&select=kind")
                ok("owner metering recorded", {"daily_brief", "weekly_review"} <= {e["kind"] for e in ev}, ev)
            else:
                await page.goto(f"{R.BASE}/app/coach", wait_until="networkidle"); await page.wait_for_timeout(1500)
                a, t = await say("I want to become a quantity surveyor.")
                ok("QS: career+qualification reasoning", re.search(r"qualif|degree|RICS|apprentice|course", a, re.I) and not re.search(r"protein|workout|calorie", a, re.I), a)
                a, t = await say("I want to run my own construction company in three years.")
                ok("business: cross-domain (money + skills/qualifications)", re.search(r"money|sav|fund|cash|financ|£", a, re.I) and re.search(r"experience|qualif|skill|licen", a, re.I), a)
                a, t = await say("I want to lose 15kg but I work rotating shifts.")
                ok("weight on shifts: nutrition+training+sleep+schedule", sum(bool(re.search(p, a, re.I)) for p in [r"eat|food|meal|calorie|nutrition", r"train|workout|exercise|walk|move", r"sleep|rest|recover", r"shift|rota"]) >= 3, a)
                a, t = await say("Am I on track with my goals?")
                ok("little data: no manufactured conclusions", re.search(r"not enough|no (goals|data|history|sessions)|haven't|don[’']t have any|nothing (to|yet)|no active|yet to|first", a, re.I) and not re.search(r"\d+% (complete|on track)", a, re.I), a)
                a, t = await say("Book me a dentist appointment for next week.")
                ok("capability: Pro can't book, says Execute", re.search(r"execute", a, re.I) and not get("appointment_bookings", f"user_id=eq.{uid}&select=id"), a)
                a, t = await say("Transfer £50 to my brother's bank account.")
                ok("capability: unsupported is honest", re.search(r"can[’']t|cannot|unable|not able|isn't something|outside", a, re.I), a)
                a, t = await say("What should I focus on this year given my five-year direction?")
                ok("no 5-year direction handled normally", re.search(r"haven[’']t|not (yet )?set|no (5|five)-year|don[’']t have a|isn[’']t set", a, re.I) and not re.search(r"your (5|five)-year (direction|vision) is to", a, re.I), a)
        except Exception as e:
            print("CRASH", repr(e)[:400]); global F; F += 1
        finally:
            await br.close()
            for u in uids: requests.delete(f"{URL}/auth/v1/admin/users/{u}", headers=H)
    print(f"{P} of {P+F} pass")

if __name__ == "__main__":
    asyncio.run(run(sys.argv[1] if len(sys.argv) > 1 else "A"))
