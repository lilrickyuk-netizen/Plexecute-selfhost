"""Completion item 76: critical end-to-end test, WELLNESS.

WELLNESS PREFERENCE -> MEDITATION SCHEDULED -> TODAY -> REMINDER -> GUIDED/TIMER SESSION
-> COMPLETION -> OPTIONAL FEEDBACK -> HISTORY -> ADAPTATION

Fresh account per run, removed afterwards. The profile time zone is one where it is morning,
so today's session can be scheduled at any UTC hour. The live guided session uses a 2-minute
length so the timer can really run to completion; adaptation is then checked with the rule's
own history (two earlier completed sessions seeded directly, as a test cannot wait days).
"""
import asyncio, os, sys, uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
import requests
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
URL = os.environ["SUPABASE_URL"]; SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
CRON = os.environ.get("LOVABLE_CRON_SECRET", "")
H = {"apikey": SR, "Authorization": f"Bearer {SR}", "Content-Type": "application/json", "Prefer": "return=representation"}
SHOTS = Path("/tmp/browser/j76"); SHOTS.mkdir(parents=True, exist_ok=True)
results = []
def check(n, ok, d=""): results.append(bool(ok)); print(("PASS " if ok else "FAIL ") + n + (f" :: {d}" if d else ""))
def rest(t, q): r = requests.get(f"{URL}/rest/v1/{t}?{q}", headers=H, timeout=30); r.raise_for_status(); return r.json()
def patch(t, q, body): r = requests.patch(f"{URL}/rest/v1/{t}?{q}", headers=H, json=body, timeout=30); assert r.ok, r.text
ZONES = ["Pacific/Honolulu", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo",
         "Europe/London", "Europe/Berlin", "Europe/Athens", "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"]
TZ = next(z for z in ZONES if 6 <= datetime.now(ZoneInfo(z)).hour <= 9)

async def main():
    email = f"e2e-well-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"; pw = "E2e!" + uuid.uuid4().hex; uid = None
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        page = await (await b.new_context(viewport={"width": 1280, "height": 1800}, timezone_id=TZ)).new_page()
        try:
            r = requests.post(f"{URL}/auth/v1/admin/users", headers=H, timeout=30, json={"email": email, "password": pw, "email_confirm": True, "user_metadata": {"date_of_birth": "1990-05-01"}})
            r.raise_for_status(); uid = r.json()["id"]
            patch("profiles", f"id=eq.{uid}", {"onboarded": True, "timezone": TZ, "display_name": "Wellness Tester", "wake_time": "06:00", "sleep_time": "23:00", "work_days": []})
            await page.goto(f"{BASE}/login", wait_until="networkidle")
            await page.fill("#email", email); await page.fill("#pw", pw)
            await page.get_by_role("button", name="Log in").click(); await page.wait_for_url("**/app/**", timeout=20000)

            # WELLNESS PREFERENCE (saved through the Wellness page)
            await page.goto(f"{BASE}/app/wellness", wait_until="networkidle"); await page.wait_for_timeout(2000)
            await page.get_by_text("Shortest (min)").locator("input").fill("2")
            await page.get_by_text("Longest (min)").locator("input").fill("2")
            await page.get_by_text("Per week").locator("input").fill("3")
            await page.get_by_role("button", name="Any", exact=True).click()
            await page.get_by_role("button", name="Save settings").click(); await page.wait_for_timeout(2500)
            prefs = rest("wellness_preferences", f"user_id=eq.{uid}&select=enabled,session_types,experience,min_minutes,max_minutes,reminders")
            goal = rest("goals", f"user_id=eq.{uid}&domain=eq.wellness&select=id,title,weekly_minutes,session_minutes,status")
            check("wellness preferences saved", len(prefs) == 1 and prefs[0]["enabled"] and prefs[0]["reminders"], str(prefs))
            check("meditation goal created for the planner", len(goal) == 1 and goal[0]["status"] == "active" and goal[0]["weekly_minutes"] == 6, str(goal))
            prof = rest("profiles", f"id=eq.{uid}&select=reminders_enabled")[0]
            check("reminder switch honoured", prof["reminders_enabled"] is True, str(prof))

            # MEDITATION SCHEDULED (member reviews and approves the plan)
            await page.goto(f"{BASE}/app/plan", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Replan").first.click(); await page.wait_for_timeout(4000)
            await page.get_by_role("button", name="Apply permanently").click(); await page.wait_for_timeout(3500)
            wb = rest("plan_blocks", f"user_id=eq.{uid}&occurrence_kind=eq.meditation&status=eq.planned&select=id,starts_at,duration_min,goal_id&order=starts_at")
            today = datetime.now(ZoneInfo(TZ)).date()
            todays = [x for x in wb if datetime.fromisoformat(x["starts_at"]).astimezone(ZoneInfo(TZ)).date() == today]
            check("meditation sessions scheduled", len(wb) >= 1 and all(x["goal_id"] == goal[0]["id"] for x in wb), f"{len(wb)} blocks")
            check("today's meditation session scheduled", len(todays) == 1, str(todays))
            BID = todays[0]["id"] if todays else None

            # TODAY: the session appears on Today.
            await page.goto(f"{BASE}/app/today", wait_until="networkidle"); await page.wait_for_timeout(1500)
            check("session shown on Today", await page.get_by_text("Meditation").first.is_visible(), "")

            # REMINDER: the reminder run notifies about the upcoming session. For the test the session's
            # start is moved to 30 minutes from now (a test cannot wait for the evening), inside the lead window.
            import time as _t
            wait = 300 - (_t.time() % 300) + 3  # the reminder run is single-flight per 5-minute slot
            soon = (datetime.now(ZoneInfo(TZ)) + timedelta(seconds=wait) + timedelta(minutes=8)).isoformat()
            patch("plan_blocks", f"id=eq.{BID}", {"starts_at": soon})
            if wait > 3: await asyncio.sleep(wait)
            rc = requests.post(f"{BASE}/api/public/cron/reminders", headers={"Authorization": f"Bearer {CRON}"}, timeout=60)
            print("reminder tick:", rc.json().get("tick", {}).get("status"), str(rc.json())[:200])
            notes = rest("notifications", f"user_id=eq.{uid}&block_id=eq.{BID}&select=intent,kind,title") if BID else []
            check("reminder run accepted", rc.status_code == 200, f"status {rc.status_code}")
            check("session reminder sent and logged", any(n["intent"] == "session_reminder" for n in notes), str(notes)[:200])
            dec = rest("intervention_decisions", f"user_id=eq.{uid}&block_id=eq.{BID}&select=kind,allowed,reason") if BID else []
            check("reminder decision recorded with its reason", any(d["allowed"] for d in dec), str(dec)[:200])

            # GUIDED SESSION -> COMPLETION -> OPTIONAL FEEDBACK (2-minute timer really runs)
            await page.goto(f"{BASE}/app/wellness?block={BID}", wait_until="networkidle"); await page.wait_for_timeout(2000)
            await page.get_by_text("how calm do you feel right now", exact=False).locator("..").get_by_role("button", name="3", exact=True).click()
            await page.get_by_role("button", name="Start session").click()
            await page.wait_for_timeout(130000)  # let the 2-minute timer finish
            await page.get_by_text("how calm do you feel now", exact=False).locator("..").get_by_role("button", name="4", exact=True).click()
            await page.get_by_text("how useful was this session", exact=False).locator("..").get_by_role("button", name="5", exact=True).click()
            await page.get_by_placeholder("Optional note").fill("Settled nicely before work.")
            await page.get_by_role("button", name="Finish & save").click(); await page.wait_for_timeout(3000)
            sess = rest("wellness_sessions", f"user_id=eq.{uid}&select=id,session_type,planned_minutes,actual_minutes,completion_state,calm_before,calm_after,useful,block_id&order=created_at.desc")
            blk = rest("plan_blocks", f"id=eq.{BID}&select=status") if BID else [{}]
            led = rest("outcome_ledger", f"user_id=eq.{uid}&domain=eq.wellness&metric=eq.session_minutes&select=value,evidence_class")
            check("guided session completed and saved", sess and sess[0]["completion_state"] == "completed" and sess[0]["block_id"] == BID, str(sess[:1])[:200])
            check("optional feedback stored", sess and sess[0]["calm_before"] == 3 and sess[0]["calm_after"] == 4 and sess[0]["useful"] == 5, "")
            check("plan session marked done with outcome recorded", blk[0].get("status") == "done" and led and led[0]["value"] >= 2, f"{blk} {led}")

            # HISTORY: the session shows in the on-page history.
            await page.goto(f"{BASE}/app/wellness", wait_until="networkidle"); await page.wait_for_timeout(2000)
            check("session appears in history", await page.get_by_text("Done ·").first.is_visible(), "")

            # ADAPTATION: three full completions in a row lengthen the next session (rule: +2 min).
            for i in (2, 1):
                r = requests.post(f"{URL}/rest/v1/wellness_sessions", headers=H, timeout=30, json={
                    "user_id": uid, "session_type": "mindfulness", "script_key": "mindfulness_v1", "planned_minutes": 2,
                    "actual_minutes": 2, "completion_state": "completed", "rule_version": "wellness_adapt_v1",
                    "created_at": (datetime.now(ZoneInfo(TZ)) - timedelta(days=i)).isoformat()})
                assert r.ok, r.text
            patch("wellness_preferences", f"user_id=eq.{uid}", {"max_minutes": 10})
            await page.reload(wait_until="networkidle"); await page.wait_for_timeout(2500)
            await page.screenshot(path=str(SHOTS / "adapted.png"))
            rec_text = await page.locator("section").first.inner_text()
            check("next session adapted longer with its reason", "4 min" in rec_text and "last three sessions" in rec_text, rec_text[:160])
        finally:
            await b.close()
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}", headers=H, timeout=30)
    print(f"\n{sum(results)} of {len(results)} pass  (tz {TZ})"); sys.exit(0 if all(results) else 1)
asyncio.run(main())
