"""Sessions live test part 2: meal-prep session, Coach inside a training session and a booking.
(Based on the Execution-Ready Sessions live test: brand-new member, zero navigation to first lesson.
Creates a temporary member, onboards with a coding goal, then checks session pages, Plan rows,
Coach-in-session, completion, stale-pathway refresh, booking + journey surfacing and goal deletion.
Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The member is removed afterwards."""
import asyncio, json, os, sys, time, uuid
from pathlib import Path
import requests
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
URL = os.environ["SUPABASE_URL"]; SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": SR, "Authorization": f"Bearer {SR}", "Content-Type": "application/json", "Prefer": "return=representation"}
SHOTS = Path("/tmp/browser/ers"); SHOTS.mkdir(parents=True, exist_ok=True)
results = []
def check(n, ok, d=""):
    results.append((n, bool(ok))); print(("PASS " if ok else "FAIL ") + n + (f" :: {d}" if d else ""), flush=True)
def rest(t, q): r = requests.get(f"{URL}/rest/v1/{t}?{q}", headers=H, timeout=30); r.raise_for_status(); return r.json()
def post(t, body): r = requests.post(f"{URL}/rest/v1/{t}", headers=H, json=body, timeout=30); r.raise_for_status(); return r.json()
def patch(t, q, body): r = requests.patch(f"{URL}/rest/v1/{t}?{q}", headers=H, json=body, timeout=30); r.raise_for_status(); return r.json()

async def session_text(page, bid):
    await page.goto(f"{BASE}/app/session/{bid}", wait_until="domcontentloaded")
    await page.wait_for_selector("[data-testid=session-objective]", timeout=30000)
    await page.wait_for_timeout(800)
    return await page.inner_text("main") if await page.locator("main").count() else await page.inner_text("body")

async def ask_coach(page, bid, q):
    await page.goto(f"{BASE}/app/coach?session={bid}", wait_until="domcontentloaded")
    await page.wait_for_selector("[data-testid=coach-session-context]", timeout=30000)
    before = await page.locator(".member-app").inner_text() if await page.locator(".member-app").count() else ""
    box = page.get_by_role("textbox").last
    await box.fill(q); await box.press("Enter")
    for _ in range(120):
        await page.wait_for_timeout(2000)
        t = await page.inner_text("body")
        if "Thinking" not in t and len(t) > len(before) + 80 and q in t: break
    t = await page.inner_text("body")
    return t[t.rfind(q) + len(q):][:900]


TZ = "Europe/London"
async def main():
    email = f"e2e-sess2-{uuid.uuid4().hex[:8]}@example.com"; pw = "E2e-" + uuid.uuid4().hex; uid = None
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        ctx = await b.new_context(viewport={"width": 412, "height": 900}, is_mobile=True, timezone_id=TZ); page = await ctx.new_page()
        try:
            r = requests.post(f"{URL}/auth/v1/admin/users", headers=H, timeout=30, json={"email": email, "password": pw, "email_confirm": True, "user_metadata": {"date_of_birth": "1990-05-01"}}); r.raise_for_status(); uid = r.json()["id"]
            patch("profiles", f"id=eq.{uid}", {"onboarded": True, "tier": "execute", "timezone": TZ, "display_name": "Session Tester", "wake_time": "06:00", "sleep_time": "23:00", "work_days": []})
            post("nutrition_targets", {"user_id": uid, "kcal": 2200, "protein_g": 160, "carbs_g": 240, "fat_g": 70, "tdee": 2600, "confidence": "medium", "explanation": "test targets", "inputs": {}, "method": "formula", "status": "applied"})
            await page.goto(f"{BASE}/login", wait_until="networkidle"); await page.fill("#email", email); await page.fill("#pw", pw)
            await page.get_by_role("button", name="Log in").click(); await page.wait_for_url("**/app/**", timeout=30000)
            # Training programme
            await page.goto(f"{BASE}/app/training", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Strength", exact=True).click(); await page.get_by_role("button", name="Full gym").click()
            await page.get_by_label("Days per week").fill("4"); await page.get_by_label("Minutes per session").fill("45")
            await page.get_by_role("button", name="Create programme").click(); await page.wait_for_timeout(3500)
            check("training programme created", len(rest("training_programmes", f"user_id=eq.{uid}&select=id")) == 1)
            # Meal plan from typed foods, accepted
            await page.goto(f"{BASE}/app/nutrition?tab=prep", wait_until="networkidle"); await page.wait_for_timeout(2500)
            if not await page.get_by_label("Foods you have").count():
                await page.get_by_role("tab", name="Meal prep").click(); await page.wait_for_timeout(1500)
            await page.get_by_label("Foods you have").fill("2kg chicken breast, 1kg rice, 500g porridge oats, a dozen eggs, 1kg greek yoghurt")
            await page.get_by_role("button", name="Add foods").click(); await page.wait_for_timeout(5000)
            for _ in range(3):
                if await page.get_by_role("button", name="Use as needed and confirm").count():
                    await page.get_by_role("button", name="Use as needed and confirm").first.click(); await page.wait_for_timeout(1500)
            await page.get_by_label("Plan start").fill(time.strftime("%Y-%m-%d"))
            await page.get_by_role("button", name="Plan my meals").click(); await page.wait_for_timeout(5000)
            await page.get_by_role("button", name="Accept this plan").click(); await page.wait_for_timeout(3000)
            print("INVENTORY", rest("food_inventory", f"user_id=eq.{uid}&select=name,food_key,status,quantity_status,grams"))
            check("meal plan accepted", len(rest("meal_plans", f"user_id=eq.{uid}&status=eq.approved&select=id")) == 1)
            # Weekly plan places workouts and prep
            await page.goto(f"{BASE}/app/plan", wait_until="networkidle"); await page.wait_for_timeout(2500)
            await page.get_by_role("button", name="Replan rest of week").click(); await page.wait_for_timeout(8000)
            await page.get_by_role("button", name="Apply once").click(); await page.wait_for_timeout(4000)
            await page.screenshot(path=str(SHOTS / "p2_plan.png"))
            blocks = rest("plan_blocks", f"user_id=eq.{uid}&select=id,occurrence_kind,title,starts_at&order=starts_at")
            prep = [x for x in blocks if x["occurrence_kind"] == "meal_prep"]; wo = [x for x in blocks if x["occurrence_kind"] == "workout"]
            check("plan has meal-prep and workout sessions", prep and wo, f"{len(prep)} prep, {len(wo)} workouts")
            if prep:
                t = await session_text(page, prep[0]["id"]); await page.screenshot(path=str(SHOTS / "p2_prep.png"))
                check("meal prep: meals to cook shown", "Cook" in t and "g" in t, t[:400].replace("\n", " | "))
                check("meal prep: what you have / still needed shown", "you already have" in t.lower() or "still needed" in t.lower(), t[t.lower().find("you already"):][:250].replace("\n", " | "))
                check("meal prep: Start prep is the one main action", await page.get_by_role("button", name="Start prep").count() + await page.get_by_role("link", name="Start prep").count() == 1)
                a = await ask_coach(page, prep[0]["id"], "What am I cooking in this session?")
                check("Coach in meal-prep session names the real food", any(k in a.lower() for k in ("chicken", "rice", "oats", "egg", "yoghurt")), a[:300].replace("\n", " | "))
            if wo:
                t = await session_text(page, wo[0]["id"]); await page.screenshot(path=str(SHOTS / "p2_workout.png"))
                ex = [ln.split(" — ")[0].strip() for ln in t.split("\n") if " — " in ln and "×" in ln]
                check("workout session lists exercises", ex, ", ".join(ex))
                a = await ask_coach(page, wo[0]["id"], "Which exercises do I do in this workout?")
                await page.screenshot(path=str(SHOTS / "p2_coach_workout.png"))
                check("Coach in training session names this session's exercises", ex and sum(e.lower() in a.lower() for e in ex) >= 2, a[:400].replace("\n", " | "))
                n0 = len(rest("plan_blocks", f"user_id=eq.{uid}&select=id"))
            # Booking session
            day = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 3 * 86400)); appt = f"{day}T14:00:00Z"
            cm = post("commitments", {"user_id": uid, "title": "Dentist", "kind": "appointment", "recurrence": "once", "on_date": day, "start_time": "14:00", "end_time": "14:45", "days": []})
            bk = post("appointment_bookings", {"user_id": uid, "idempotency_key": f"e2e-{uuid.uuid4().hex}", "service": "Dental check-up", "kind": "appointment", "method": "online", "status": "checkout_ready", "payment_state": "checkout_ready", "provider_name": "Smile Dental", "checkout_url": "https://example.com/checkout", "commitment_id": cm[0]["id"]})
            post("journeys", {"user_id": uid, "appointment_id": bk[0]["id"], "origin_address": "Home", "dest_address": "1 High St", "dest_label": "Smile Dental", "mode": "transit", "arrive_by": appt, "leave_at": f"{day}T13:15:00Z", "duration_min": 31, "buffer_min": 14})
            blk = post("plan_blocks", {"user_id": uid, "title": "Dentist", "domain": "admin", "occurrence_kind": "appointment_prep", "source_type": "commitment", "commitment_id": cm[0]["id"], "starts_at": appt, "original_starts_at": appt, "duration_min": 45, "status": "planned", "source_ref": f"e2e:{cm[0]['id']}"})
            a = await ask_coach(page, blk[0]["id"], "Where am I with this booking and when should I leave?")
            await page.screenshot(path=str(SHOTS / "p2_coach_booking.png"))
            check("Coach in booking session gives the real status and next step", "checkout" in a.lower(), a[:400].replace("\n", " | "))
            check("Coach gives the leave time in the member's own time (14:15 London), not UTC", ("14:15" in a or "2:15" in a) and "UTC" not in a, "")
            check("asking Coach created no duplicate bookings or journeys", len(rest("appointment_bookings", f"user_id=eq.{uid}&select=id")) == 1 and len(rest("journeys", f"user_id=eq.{uid}&select=id")) == 1)
        finally:
            await b.close()
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}", headers=H, timeout=30)
    print(f"\n{sum(ok for _, ok in results)} of {len(results)} pass")
    sys.exit(0 if all(ok for _, ok in results) else 1)

asyncio.run(main())
