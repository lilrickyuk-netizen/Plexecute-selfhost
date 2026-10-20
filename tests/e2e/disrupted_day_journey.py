"""Completion item 72: critical end-to-end test, DISRUPTED DAY.

ACCEPTED DAY -> WORK/COMMITMENT OVERRUN -> RECOVERY MODE -> PROTECTED ITEMS PRESERVED
-> FEASIBLE REPAIR -> DIFF SHOWN -> USER APPROVAL -> NEW SCHEDULE -> EXECUTION HISTORY INTACT

A fresh account is created per run (confirmed via the auth admin API) and removed afterwards.
Its accepted day is seeded in a time zone where it is late morning, so the run works at any UTC hour.
"""
import asyncio, os, sys, uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
import requests
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
URL = os.environ["SUPABASE_URL"]; SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": SR, "Authorization": f"Bearer {SR}", "Content-Type": "application/json", "Prefer": "return=representation"}
SHOTS = Path("/tmp/browser/j72"); SHOTS.mkdir(parents=True, exist_ok=True)
results = []
def check(n, ok, d=""): results.append(ok := bool(ok)); print(("PASS " if ok else "FAIL ") + n + (f" :: {d}" if d else ""))
def rest(t, q): r = requests.get(f"{URL}/rest/v1/{t}?{q}", headers=H, timeout=30); r.raise_for_status(); return r.json()
def ins(t, body): r = requests.post(f"{URL}/rest/v1/{t}", headers=H, json=body, timeout=30); assert r.ok, r.text; return r.json()
def patch(t, q, body): r = requests.patch(f"{URL}/rest/v1/{t}?{q}", headers=H, json=body, timeout=30); assert r.ok, r.text

ZONES = ["Pacific/Honolulu", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo",
         "Europe/London", "Europe/Berlin", "Europe/Athens", "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"]
TZ = next(z for z in ZONES if 9 <= datetime.now(ZoneInfo(z)).hour <= 11)
now = datetime.now(ZoneInfo(TZ))
def at(h, m=0): return now.replace(hour=h, minute=m, second=0, microsecond=0)
base_h = now.hour + 1  # first open session starts within the next hour

async def main():
    email = f"e2e-disrupt-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"; pw = "E2e!" + uuid.uuid4().hex; uid = None
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        page = await (await b.new_context(viewport={"width": 1280, "height": 1800}, timezone_id=TZ)).new_page()
        try:
            r = requests.post(f"{URL}/auth/v1/admin/users", headers=H, timeout=30, json={"email": email, "password": pw, "email_confirm": True, "user_metadata": {"date_of_birth": "1990-05-01"}})
            r.raise_for_status(); uid = r.json()["id"]
            patch("profiles", f"id=eq.{uid}", {"onboarded": True, "tier": "pro", "timezone": TZ, "display_name": "Disrupted Tester", "wake_time": "07:00", "sleep_time": "23:00", "work_days": []})
            g_run, g_read, g_med = [ins("goals", {"user_id": uid, "title": t, "domain": d, "priority": pr, "is_protected": prot, "status": "active"})[0]["id"]
                                    for t, d, pr, prot in [("Run 5k", "fitness", 2, False), ("Read more", "learning", 3, False), ("Physio exercises", "health", 1, True)]]
            ws = (now - timedelta(days=now.isoweekday() - 1)).date().isoformat()
            ins("plan_versions", {"user_id": uid, "week_start": ws, "version": 1, "status": "approved", "trigger": "onboarding", "feasibility": "feasible", "explanation": "Accepted first week"})
            def blk(gid, title, dom, start, dur, prot=False):
                return ins("plan_blocks", {"user_id": uid, "goal_id": gid, "title": title, "domain": dom, "starts_at": start.isoformat(), "duration_min": dur, "status": "planned", "is_protected": prot, "source_type": "goal"})[0]["id"]
            b_done = blk(g_read, "Read more", "learning", now + timedelta(minutes=5), 20)
            b_run = blk(g_run, "Run 5k", "fitness", at(base_h + 1), 45)
            b_med = blk(g_med, "Physio exercises", "health", at(base_h + 2), 30, True)
            b_read2 = blk(g_read, "Read more", "learning", at(base_h + 3), 30)

            await page.goto(f"{BASE}/login", wait_until="networkidle")
            await page.fill("#email", email); await page.fill("#pw", pw)
            await page.get_by_role("button", name="Log in").click(); await page.wait_for_url("**/app/**", timeout=20000)
            await page.goto(f"{BASE}/app/today", wait_until="networkidle"); await page.wait_for_timeout(2000)
            body = await page.inner_text("body")
            check("accepted day shows on Today", "Run 5k" in body and "Physio exercises" in body)
            # Execute the first session so there is history to protect.
            await page.get_by_role("button", name="Start").first.click(); await page.wait_for_timeout(2000)
            await page.get_by_role("button", name="Done").first.click(); await page.wait_for_timeout(2500)
            ev_before = rest("plan_block_events", f"block_id=eq.{b_done}&select=id,event_type,to_status&order=created_at")
            st = rest("plan_blocks", f"id=eq.{b_done}&select=status")[0]["status"]
            check("first session executed before the disruption", st == "done" and len(ev_before) >= 2, f"{st}, {len(ev_before)} events")

            # OVERRUN -> RECOVERY MODE
            busy_until = f"{base_h + 2:02d}:30"
            await page.get_by_role("button", name="Repair my day").click(); await page.wait_for_timeout(500)
            dlg = page.get_by_role("dialog")
            await dlg.locator("select").select_option("overran")
            await dlg.locator("input[type=time]").fill(busy_until)
            await dlg.locator("textarea").fill("Client meeting ran long")
            await dlg.get_by_role("button", name="Show me the repaired day").click(); await page.wait_for_timeout(4000)
            await page.screenshot(path=str(SHOTS / "diff.png"))
            dtxt = await dlg.inner_text()
            check("diff shown with each session's outcome", "Physio exercises" in dtxt and "Run 5k" in dtxt and ("Moved" in dtxt or "Later this week" in dtxt or "Shorter" in dtxt), dtxt[:300].replace("\n", " | "))
            check("protected session marked left alone", "Left alone" in dtxt)
            check("nothing changed before approval", rest("plan_blocks", f"id=eq.{b_run}&select=starts_at")[0]["starts_at"] and "Nothing has moved yet" in dtxt)
            prop = rest("plan_versions", f"user_id=eq.{uid}&status=eq.proposed&select=id,feasibility,trigger,diff_summary")
            check("feasible repair proposal saved", len(prop) == 1 and prop[0]["trigger"] == "recovery" and prop[0]["feasibility"] == "feasible", prop and prop[0]["feasibility"])
            items = {i["id"]: i for i in prop[0]["diff_summary"]["day_repair"]["items"]} if prop else {}
            check("protected item preserved in the repair", items.get(b_med, {}).get("action") == "frozen", items.get(b_med, {}).get("action"))
            check("overrun session repaired, not dropped", items.get(b_run, {}).get("action") in ("moved", "shortened", "deferred") and (items[b_run].get("action") != "deferred" or items[b_run].get("deferredTo")), str(items.get(b_run)))
            await dlg.get_by_role("button", name="Review on Plan").click(); await page.wait_for_url("**/app/plan**", timeout=15000); await page.wait_for_timeout(2500)
            await page.screenshot(path=str(SHOTS / "plan.png"))
            # USER APPROVAL
            await page.get_by_role("button", name="Apply permanently").click(); await page.wait_for_timeout(3500)
            check("member approved the repair", rest("plan_versions", f"id=eq.{prop[0]['id']}&select=status")[0]["status"] == "approved")
            # NEW SCHEDULE
            after = rest("plan_blocks", f"user_id=eq.{uid}&select=id,title,starts_at,status,is_protected&order=starts_at")
            med = [x for x in after if x["title"] == "Physio exercises"]
            check("protected session unchanged", len(med) == 1 and med[0]["id"] == b_med and datetime.fromisoformat(med[0]["starts_at"]) == at(base_h + 2), str(med))
            cutoff = at(base_h + 2, 30)
            runs = [x for x in after if x["title"].startswith("Run 5k") and x["status"] in ("planned", "scheduled")]
            check("new schedule keeps the run clear of the overrun", runs and all(datetime.fromisoformat(x["starts_at"]) >= cutoff for x in runs), str([x["starts_at"] for x in runs]))
            starts = sorted((datetime.fromisoformat(x["starts_at"]), x) for x in after if x["status"] in ("planned", "scheduled"))
            check("no sessions start inside the overrun window", not any(now < s < cutoff and not x["is_protected"] for s, x in starts), str([(s.isoformat(), x["title"]) for s, x in starts if s < cutoff]))
            await page.goto(f"{BASE}/app/today", wait_until="networkidle"); await page.wait_for_timeout(2000); await page.screenshot(path=str(SHOTS / "today_after.png"))
            # EXECUTION HISTORY INTACT
            d = rest("plan_blocks", f"id=eq.{b_done}&select=status,started_at,completed_at")
            ev_after = rest("plan_block_events", f"block_id=eq.{b_done}&select=id&order=created_at")
            old = rest("plan_blocks", f"id=eq.{b_run}&select=status")[0]["status"]
            check("original run kept as rescheduled history", old == "rescheduled", old)
            check("completed session and its history intact", d and d[0]["status"] == "done" and d[0]["completed_at"] and [e["id"] for e in ev_before] == [e["id"] for e in ev_after][:len(ev_before)])
            hist = rest("plan_versions", f"user_id=eq.{uid}&select=version,status&order=version")
            check("plan history kept (old version not rewritten)", len(hist) >= 2 and hist[0]["version"] == 1, str(hist))
            aud = rest("audit_events", f"user_id=eq.{uid}&action=in.(day.disrupted,plan.day_repair_proposed)&select=action")
            check("disruption and repair audited", {a["action"] for a in aud} == {"day.disrupted", "plan.day_repair_proposed"})
        finally:
            await b.close()
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}", headers=H, timeout=30)
    print(f"\n{sum(results)} of {len(results)} pass  (tz {TZ})"); sys.exit(0 if all(results) else 1)
asyncio.run(main())
