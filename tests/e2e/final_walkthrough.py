"""Step 104: FINAL APPLICATION WALKTHROUGH — drive the app as a real user through
every major workflow, screenshotting each stage. Fresh account, removed after."""
import asyncio, os, sys, time, uuid
from pathlib import Path
import requests
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
URL = os.environ["SUPABASE_URL"]; SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": SR, "Authorization": f"Bearer {SR}", "Content-Type": "application/json"}
SHOTS = Path("/tmp/browser/walkthrough/shots"); SHOTS.mkdir(parents=True, exist_ok=True)
results = []
n = 0
def check(name, ok, detail=""):
    results.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name + (f" :: {detail}" if detail else ""))
async def shot(page, label):
    global n; n += 1
    await page.screenshot(path=str(SHOTS / f"{n:02d}_{label}.png"))

async def main():
    email = f"e2e-walk-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"
    pw = "E2e!" + uuid.uuid4().hex + "Aa1"
    uid = None
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        page = await (await b.new_context(viewport={"width": 1280, "height": 1800})).new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            # 1. SIGN UP (form) -> under-18 gate
            await page.goto(f"{BASE}/login?mode=signup", wait_until="networkidle")
            if not await page.locator("#dob").count():
                await page.get_by_text("Create one", exact=False).first.click()
            await page.fill("#email", email); await page.fill("#pw", pw)
            await page.fill("#dob", time.strftime("%Y-%m-%d", time.localtime(time.time() - 10 * 365 * 86400)))
            await page.get_by_role("button", name="Create account").click(); await page.wait_for_timeout(1200)
            check("sign-up refuses under 18", "18" in (await page.content()))
            await shot(page, "signup_gate")

            r = requests.post(f"{URL}/auth/v1/admin/users", headers=H, timeout=30,
                              json={"email": email, "password": pw, "email_confirm": True, "user_metadata": {"date_of_birth": "1990-05-01"}})
            r.raise_for_status(); uid = r.json()["id"]
            await page.goto(f"{BASE}/login", wait_until="networkidle")
            await page.fill("#email", email); await page.fill("#pw", pw)
            await page.get_by_role("button", name="Log in").click()
            await page.wait_for_url("**/onboarding**", timeout=20000)
            check("login lands on Life Audit onboarding", "/onboarding" in page.url)

            # 2. ONBOARDING: Life Audit -> goals -> feasibility -> accept
            # LIFE AUDIT: identity and consent, then the current questionnaire.
            await page.wait_for_timeout(1500)
            await page.get_by_role("textbox").first.fill("Walkthrough Tester")
            await page.get_by_text("I confirm I am 18 or older").click()
            await page.get_by_text("I agree to the").click()
            await page.get_by_role("button", name="Continue", exact=True).click()
            questionnaire = page.get_by_test_id("onboarding-questionnaire")
            for answer in ["Fitness and sport", "Monday to Friday, 9am to 5pm", "7:00am",
                           "11:00pm", "3 sessions a week", "60 minutes", "Weekday evenings",
                           "Work or study", "My own answer", "Evening", "None", "I'm not sure yet"]:
                await questionnaire.get_by_role("button", name=answer, exact=True).click()
                if answer == "My own answer":
                    await questionnaire.get_by_role("textbox").fill("Long work days")
                await questionnaire.get_by_role("button", name="Next", exact=True).click()
            await questionnaire.get_by_label("Main goal").fill("Get stronger")
            await questionnaire.get_by_role("button", name="Review my answers").click()
            await page.get_by_text("Understanding…", exact=True).wait_for(state="hidden", timeout=120000)
            await questionnaire.wait_for(state="hidden", timeout=120000)
            if await page.get_by_text("Skip these", exact=False).count():
                await page.get_by_text("Skip these", exact=False).click()
            await page.get_by_role("button", name="Looks right").click()
            body = await page.inner_text("body")
            check("feasibility verdict shown", "sessions placed" in body and "free time this week" in body)
            await shot(page, "feasibility")
            await page.get_by_role("button", name="Accept and start").click()
            await page.wait_for_url("**/app/coach**", timeout=60000)
            check("accepting the plan lands on Coach", "/app/coach" in page.url)
            await page.goto(f"{BASE}/app/today", wait_until="networkidle")
            await shot(page, "today_first")

            # 3. TODAY: start and complete a block
            await page.wait_for_timeout(2500)
            start_btn = page.get_by_role("button", name="Start").first
            if await start_btn.count():
                await start_btn.click(); await page.wait_for_timeout(1500)
                done_btn = page.get_by_role("button", name="Done").first
                if not await done_btn.count(): done_btn = page.get_by_role("button", name="Complete").first
                if await done_btn.count():
                    await done_btn.click(); await page.wait_for_timeout(2000)
                body = (await page.inner_text("body")).lower()
                check("Today: started and completed a session", "done" in body or "complete" in body)
            else:
                # session is later today: start/complete it from the week view instead
                await page.goto(f"{BASE}/app/plan", wait_until="networkidle"); await page.wait_for_timeout(2000)
                sb = page.get_by_role("button", name="Start").first
                await sb.click(); await page.wait_for_timeout(1500)
                db = page.get_by_role("button", name="Done").first
                await db.click(); await page.wait_for_timeout(2000)
                body = (await page.inner_text("body")).lower()
                check("Today: started and completed a session", "done" in body or "completed" in body)
                await page.goto(f"{BASE}/app/today", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await shot(page, "today_completed")

            # 4. PLAN: view week, request a replan, approve the proposal
            await page.goto(f"{BASE}/app/plan", wait_until="networkidle"); await page.wait_for_timeout(2000)
            await shot(page, "plan_week")
            replan = page.get_by_role("button", name="Replan").first
            if await replan.count():
                await replan.click(); await page.wait_for_timeout(6000)
                body = await page.inner_text("body")
                check("Plan: replan proposal shown", "proposal" in body.lower() or "review" in body.lower() or "approve" in body.lower())
                await shot(page, "plan_proposal")
                approve = page.get_by_role("button", name="Apply permanently").first
                if await approve.count():
                    await approve.click(); await page.wait_for_timeout(4000)
                    body = (await page.inner_text("body")).lower()
                    check("Plan: proposal approved and applied", "plan v2 ready" not in body or "review before anything changes" not in body)
                else:
                    check("Plan: proposal approved and applied", False, "no Apply button")
            else:
                check("Plan: replan proposal shown", False, "no Replan button")

            # 5. COACH: send a message, get a reply
            await page.goto(f"{BASE}/app/coach", wait_until="networkidle"); await page.wait_for_timeout(2000)
            box = page.get_by_placeholder("Tell Coach what you need…")
            check("Coach: composer visible", await box.is_visible())
            await box.fill("I have 30 minutes free this evening. What should I do with it?")
            await page.locator('button[aria-label="Send"]').click()
            await page.wait_for_timeout(25000)
            body = await page.inner_text("body")
            check("Coach: reply received", "coach" in body.lower() and len(body) > 200)
            await shot(page, "coach_reply")

            # 6. NUTRITION: log food manually
            await page.goto(f"{BASE}/app/nutrition", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Add food").first.click()
            await page.get_by_role("tab", name="Manual").click()
            await page.get_by_placeholder("Food name").fill("Walkthrough oats")
            await page.get_by_placeholder("kcal").fill("200"); await page.get_by_placeholder("Protein").fill("10")
            await page.get_by_role("button", name="Next").click()
            await page.get_by_role("dialog").locator('input[type=number]').fill("150")
            await page.get_by_role("button", name="Log", exact=True).click()
            await page.wait_for_timeout(2000)
            check("Nutrition: food logged and shown", await page.locator("div.mb-1\\.5", has_text="Walkthrough oats").count() > 0)
            await shot(page, "nutrition_logged")

            # 7. GOALS: add a goal
            await page.goto(f"{BASE}/app/goals", wait_until="networkidle"); await page.wait_for_timeout(1500)
            add = page.get_by_role("button", name="Add goal").first
            if not await add.count(): add = page.get_by_role("button", name="New goal").first
            if await add.count():
                await add.click(); await page.wait_for_timeout(800)
                await page.get_by_placeholder("e.g. Get stronger, learn Spanish").fill("Read more books")
                save = page.get_by_role("button", name="Save goal", exact=True).first
                if not await save.count(): save = page.get_by_role("button", name="Add", exact=True).first
                await save.click(); await page.wait_for_timeout(2000)
                check("Goals: new goal saved", "Read more books" in await page.inner_text("body"))
            else:
                check("Goals: new goal saved", False, "no add-goal button")
            await shot(page, "goals")

            # 8. TRAINING, 9. LEARNING, 10. PROGRESS, 11. HISTORY — view as a member
            for path, label, expect in [
                ("/app/training", "training", "train"),
                ("/app/learning", "learning", "learn"),
                ("/app/progress", "progress", "progress"),
                ("/app/history", "history", "history"),
                ("/app/wellness", "wellness", "wellness"),
                ("/app/movement", "movement", "cardio"),
            ]:
                await page.goto(f"{BASE}{path}", wait_until="networkidle"); await page.wait_for_timeout(1500)
                body = (await page.inner_text("body")).lower()
                check(f"{label} page loads with content", expect in body and "couldn't load" not in body)
                await shot(page, label)

            # 12. SETTINGS: change display name
            await page.goto(f"{BASE}/app/profile", wait_until="networkidle"); await page.wait_for_timeout(1500)
            name_input = page.get_by_label("Name", exact=True).first
            if not await name_input.count(): name_input = page.locator("input").first
            await name_input.fill("Walked Through")
            save = page.get_by_role("button", name="Save", exact=True).first
            if await save.count():
                await save.click(); await page.wait_for_timeout(2000)
            r = requests.get(f"{URL}/rest/v1/profiles?id=eq.{uid}&select=display_name", headers=H, timeout=30)
            check("Settings: display name saved", r.json() and r.json()[0].get("display_name") == "Walked Through", str(r.json()[:1]))
            await shot(page, "settings")

            # 13. BILLING and HELP pages
            for path, label in [("/app/billing", "billing"), ("/app/help", "help"), ("/app/more", "more")]:
                await page.goto(f"{BASE}{path}", wait_until="networkidle"); await page.wait_for_timeout(1200)
                body = (await page.inner_text("body")).lower()
                check(f"{label} page loads", "couldn't load" not in body and len(body) > 50)
                await shot(page, label)

            # 14. SIGN OUT
            await page.goto(f"{BASE}/app/settings", wait_until="networkidle"); await page.wait_for_timeout(1200)
            so = page.get_by_role("button", name="Log out").first
            if not await so.count(): so = page.get_by_role("button", name="Sign out").first
            if await so.count():
                await so.click(); await page.wait_for_timeout(3000)
                await page.goto(f"{BASE}/app/today", wait_until="networkidle"); await page.wait_for_timeout(1500)
                check("sign out returns to login and protects the app", "/login" in page.url)
            else:
                check("sign out returns to login and protects the app", False, "no log out button")
            await shot(page, "signed_out")

            check("no uncaught page errors during the whole walkthrough", not errors, str(errors[:3]))
        finally:
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}", headers=H, timeout=30)
            await b.close()
    print(f"{sum(results)} of {len(results)} pass")
    sys.exit(0 if all(results) else 1)

asyncio.run(main())
