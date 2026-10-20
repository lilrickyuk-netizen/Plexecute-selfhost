"""Completion item 71: critical end-to-end test, NEW USER.

SIGN UP -> LIFE AUDIT -> LIFE TWIN -> GOALS -> FEASIBILITY -> PLAN -> ACCEPT -> COACH
-> EXECUTE -> COMPLETE -> VERIFY -> PROGRESS -> ADAPT

A brand-new account is created for each run and fully removed afterwards.
The account is created confirmed through the auth admin API (the confirmation e-mail
cannot be clicked from a test); the sign-up form itself is exercised for the 18+ gate.
Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
"""
import asyncio, json, os, sys, time, uuid
from pathlib import Path
import requests
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
URL = os.environ["SUPABASE_URL"]
SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": SR, "Authorization": f"Bearer {SR}", "Content-Type": "application/json"}
SHOTS = Path("/tmp/browser/j71"); SHOTS.mkdir(parents=True, exist_ok=True)
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name + (f" :: {detail}" if detail else ""))

def rest(table, q):
    r = requests.get(f"{URL}/rest/v1/{table}?{q}", headers=H, timeout=30); r.raise_for_status(); return r.json()

async def main():
    email = f"e2e-newuser-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"
    pw = "E2e!" + uuid.uuid4().hex
    uid = None
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        page = await (await b.new_context(viewport={"width": 1280, "height": 1800})).new_page()
        try:
            # SIGN UP: the form refuses under-18s before anything is sent.
            await page.goto(f"{BASE}/login?mode=signup", wait_until="networkidle")
            if not await page.locator("#dob").count():
                await page.get_by_text("Create one", exact=False).first.click()
            await page.fill("#email", email); await page.fill("#pw", pw)
            await page.fill("#dob", time.strftime("%Y-%m-%d", time.localtime(time.time() - 10 * 365 * 86400)))
            await page.get_by_role("button", name="Create account").click(); await page.wait_for_timeout(1200)
            check("sign-up refuses under 18", "18" in (await page.content()) and not await page.get_by_text("Check your inbox").count())

            r = requests.post(f"{URL}/auth/v1/admin/users", headers=H, timeout=30,
                              json={"email": email, "password": pw, "email_confirm": True, "user_metadata": {"date_of_birth": "1990-05-01"}})
            r.raise_for_status(); uid = r.json()["id"]
            await page.goto(f"{BASE}/login", wait_until="networkidle")
            await page.fill("#email", email); await page.fill("#pw", pw)
            await page.get_by_role("button", name="Log in").click()
            await page.wait_for_url("**/onboarding**", timeout=20000)
            check("new account lands on Life Audit", "/onboarding" in page.url)

            # LIFE AUDIT: identity and consent, then the current questionnaire.
            await page.wait_for_timeout(1500)
            await page.get_by_role("textbox").first.fill("Journey Tester")
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
            # GOALS
            await page.screenshot(path=str(SHOTS / "goals.png"))
            await page.get_by_role("button", name="Looks right").click()
            # FEASIBILITY + PLAN
            body = await page.inner_text("body")
            check("feasibility verdict shown", "sessions placed" in body and "free time this week" in body, body[body.find("Your first week"):][:200])
            await page.screenshot(path=str(SHOTS / "feasibility.png"))
            # ACCEPT
            await page.get_by_role("button", name="Accept and start").click()
            await page.wait_for_url("**/app/coach**", timeout=60000)
            check("accept goes to Coach", "/app/coach" in page.url)

            prof = rest("profiles", f"id=eq.{uid}&select=onboarded,life_audit")[0]
            check("Life Audit saved", prof["onboarded"] and "long work days" in prof["life_audit"].get("biggest_blocker", "").lower())
            facts = rest("life_twin_facts", f"user_id=eq.{uid}&select=fact_key,source")
            check("Life Twin facts created from audit", len(facts) >= 3 and all(f["source"] == "USER_ASSERTED" for f in facts), f"{len(facts)} facts")
            goals = rest("goals", f"user_id=eq.{uid}&select=id,title")
            check("goal saved", any("stronger" in g["title"].lower() for g in goals))
            pv = rest("plan_versions", f"user_id=eq.{uid}&select=id,status,feasibility,engine_versions")
            check("plan accepted with feasibility + rule versions", any(v["status"] == "approved" and v["feasibility"] and v["engine_versions"] for v in pv))
            blocks = rest("plan_blocks", f"user_id=eq.{uid}&select=id,title,status,starts_at&order=starts_at")
            check("plan sessions created", len(blocks) > 0, f"{len(blocks)} blocks")

            # TODAY -> EXECUTE -> COMPLETE (from the week view, so the run works at any hour)
            await page.goto(f"{BASE}/app/plan", wait_until="networkidle"); await page.wait_for_timeout(1500)
            row = page.locator("div", has=page.get_by_role("button", name="Start")).last
            await page.get_by_role("button", name="Start").first.click(); await page.wait_for_timeout(2000)
            await page.get_by_role("button", name="Done").first.click(); await page.wait_for_timeout(2500)
            await page.screenshot(path=str(SHOTS / "done.png"))
            done = rest("plan_blocks", f"user_id=eq.{uid}&status=eq.done&select=id,evidence,started_at,completed_at")
            check("session started then completed", len(done) == 1 and done[0]["started_at"] and done[0]["completed_at"])
            ev = rest("plan_block_events", f"block_id=eq.{done[0]['id']}&select=event_type,to_status&order=created_at") if done else []
            check("execution history recorded", len(ev) >= 2, json.dumps(ev)[:200])
            # VERIFY
            check("completion evidence labelled", done and done[0]["evidence"] in ("self_reported", "supported", "verified_external"), done and done[0]["evidence"])
            check("evidence label visible", await page.get_by_text("Done ·").count() > 0)
            # PROGRESS
            await page.goto(f"{BASE}/app/progress", wait_until="networkidle"); await page.wait_for_timeout(2000)
            ptxt = await page.inner_text("body")
            await page.screenshot(path=str(SHOTS / "progress.png"))
            sec = ptxt[ptxt.find("Plan vs actual"):ptxt.find("Training progression")]
            check("progress reflects the completed session", "Nothing recorded yet" not in sec and "1/1 sessions" in sec, sec[:200].replace("\n", " | "))
            wk = ptxt[ptxt.find("This week"):][:60]
            check("this week's adherence counts it", "nothing due" not in wk, wk.replace("\n", " | "))
            # ADAPT: replan proposes a new version that the member reviews and approves.
            await page.goto(f"{BASE}/app/plan", wait_until="networkidle"); await page.wait_for_timeout(1000)
            await page.get_by_role("button", name="Replan").first.click(); await page.wait_for_timeout(4000)
            await page.screenshot(path=str(SHOTS / "adapt.png"))
            prop = rest("plan_versions", f"user_id=eq.{uid}&status=eq.proposed&select=id,diff_summary")
            check("adapt creates a reviewable proposal", len(prop) == 1)
            ptx = await page.inner_text("body")
            check("proposal and fit check agree", ("couldn't fit" in ptx) == ("Fits your week" not in ptx), ptx[ptx.find("IMPACT"):][:120].replace("\n", " | "))
            await page.get_by_role("button", name="Apply permanently").click(); await page.wait_for_timeout(3000)
            st = rest("plan_versions", f"id=eq.{prop[0]['id']}&select=status")[0]["status"] if prop else None
            check("adapted plan approved by member", st == "approved", st)
            blocks2 = rest("plan_blocks", f"user_id=eq.{uid}&goal_id=not.is.null&select=goal_id,starts_at,status")
            print("blocks2", [(b["starts_at"][:16], b["status"]) for b in blocks2])
            days = [b["goal_id"] + b["starts_at"][:10] for b in blocks2 if b["status"] not in ("rescheduled", "cancelled", "superseded")]
            check("one session per goal per day after adapting", len(days) == len(set(days)), str(days))
            done2 = rest("plan_blocks", f"user_id=eq.{uid}&status=eq.done&select=id")
            check("completed session kept through adaptation", len(done2) == 1)
        finally:
            await b.close()
            if uid:
                requests.delete(f"{URL}/auth/v1/admin/users/{uid}", headers=H, timeout=30)
    print(f"\n{sum(ok for _, ok in results)} of {len(results)} pass")
    sys.exit(0 if all(ok for _, ok in results) else 1)

asyncio.run(main())
