"""Completion item 73: critical end-to-end test, TRAINING.

GOAL -> PROGRAMME GENERATION -> SCHEDULING -> SESSION EXECUTION -> SET LOGGING -> COMPLETION
-> EVIDENCE -> PROGRESSION/REGRESSION -> NEXT PRESCRIPTION

Fresh account per run (confirmed via the auth admin API), removed afterwards. The profile time zone is
one where it is morning, so today's workout can be scheduled at any UTC hour.
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
SHOTS = Path("/tmp/browser/j73"); SHOTS.mkdir(parents=True, exist_ok=True)
results = []
def check(n, ok, d=""): results.append(ok := bool(ok)); print(("PASS " if ok else "FAIL ") + n + (f" :: {d}" if d else ""))
def rest(t, q): r = requests.get(f"{URL}/rest/v1/{t}?{q}", headers=H, timeout=30); r.raise_for_status(); return r.json()
def ins(t, body): r = requests.post(f"{URL}/rest/v1/{t}", headers=H, json=body, timeout=30); assert r.ok, r.text; return r.json()
def patch(t, q, body): r = requests.patch(f"{URL}/rest/v1/{t}?{q}", headers=H, json=body, timeout=30); assert r.ok, r.text
ZONES = ["Pacific/Honolulu", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo",
         "Europe/London", "Europe/Berlin", "Europe/Athens", "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"]
TZ = next(z for z in ZONES if 7 <= datetime.now(ZoneInfo(z)).hour <= 10)

async def do_workout(page, weight, miss=False):
    """Log every prescribed set at the top of the rep range and target reserve, then finish."""
    await page.wait_for_timeout(1500)
    rxs = rest("programme_prescriptions", f"programme_id=eq.{PROG}&day_index=eq.0&select=id,sets,rep_min,rep_max,rir_target,load_kg&order=order_index")
    for i, rx in enumerate(rxs):
        sec = page.locator("section", has=page.get_by_role("button", name="Log set")).nth(i)
        for _ in range(rx["sets"]):
            inp = sec.locator("input")
            if await inp.nth(0).is_enabled(): await inp.nth(0).fill(str(rx["load_kg"] if rx["load_kg"] is not None else weight))
            await inp.nth(1).fill(str(max(0, rx["rep_min"] - 2) if miss else rx["rep_max"])); await inp.nth(2).fill(str(rx["rir_target"]))
            await sec.get_by_role("button", name="Log set").click(); await page.wait_for_timeout(700)
    await page.get_by_role("button", name="Finish workout").click(); await page.wait_for_timeout(3500)
    return rxs

async def main():
    global PROG
    email = f"e2e-train-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"; pw = "E2e!" + uuid.uuid4().hex; uid = None
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        page = await (await b.new_context(viewport={"width": 1280, "height": 1800}, timezone_id=TZ)).new_page()
        try:
            r = requests.post(f"{URL}/auth/v1/admin/users", headers=H, timeout=30, json={"email": email, "password": pw, "email_confirm": True, "user_metadata": {"date_of_birth": "1990-05-01"}})
            r.raise_for_status(); uid = r.json()["id"]
            patch("profiles", f"id=eq.{uid}", {"onboarded": True, "timezone": TZ, "display_name": "Training Tester", "wake_time": "06:00", "sleep_time": "23:00", "work_days": []})
            # The member's own consent for automatic load changes (Settings > Automatic changes).
            ins("auto_adapt_permissions", {"user_id": uid, "permission": "ADJUST_WORKOUT_LOAD_WITHIN_ENGINE_RULE", "enabled": True})
            await page.goto(f"{BASE}/login", wait_until="networkidle")
            await page.fill("#email", email); await page.fill("#pw", pw)
            await page.get_by_role("button", name="Log in").click(); await page.wait_for_url("**/app/**", timeout=20000)

            # GOAL + PROGRAMME GENERATION
            await page.goto(f"{BASE}/app/training", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Strength", exact=True).click()
            await page.get_by_role("button", name="Full gym").click()
            await page.get_by_label("Days per week").fill("6"); await page.get_by_label("Minutes per session").fill("45")
            await page.get_by_role("button", name="Create programme").click(); await page.wait_for_timeout(3000)
            progs = rest("training_programmes", f"user_id=eq.{uid}&select=id,status,goal,version,policy_version")
            check("programme generated for the goal", len(progs) == 1 and progs[0]["goal"] == "strength" and progs[0]["policy_version"], str(progs))
            PROG = progs[0]["id"]
            rx0 = rest("programme_prescriptions", f"programme_id=eq.{PROG}&select=id,day_index")
            check("programme has prescriptions for every day", len({x["day_index"] for x in rx0}) >= 2, f"{len(rx0)} exercises")
            tg = rest("goals", f"user_id=eq.{uid}&domain=eq.training&select=id,weekly_minutes,session_minutes")
            check("programme becomes a training goal for the planner", len(tg) == 1 and tg[0]["weekly_minutes"] == 270 and tg[0]["session_minutes"] == 45, str(tg))

            # SCHEDULING (member reviews and approves the plan)
            await page.goto(f"{BASE}/app/plan", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Replan").first.click(); await page.wait_for_timeout(4000)
            await page.screenshot(path=str(SHOTS / "proposal.png"))
            await page.get_by_role("button", name="Apply permanently").click(); await page.wait_for_timeout(3500)
            wb = rest("plan_blocks", f"user_id=eq.{uid}&occurrence_kind=eq.workout&status=eq.planned&select=id,starts_at,duration_min&order=starts_at")
            today = datetime.now(ZoneInfo(TZ)).date()
            todays = [x for x in wb if datetime.fromisoformat(x["starts_at"]).astimezone(ZoneInfo(TZ)).date() == today]
            check("workouts scheduled as plan sessions", len(wb) >= 1 and all(x["duration_min"] == 45 for x in wb), f"{len(wb)} workouts")
            check("today's workout scheduled", len(todays) == 1, str(todays))

            # SESSION EXECUTION + SET LOGGING + COMPLETION (two comparable sessions)
            await page.goto(f"{BASE}/app/training", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Start").first.click()
            rxs = await do_workout(page, 40)
            await page.screenshot(path=str(SHOTS / "after1.png"))
            s1 = rest("workout_sessions", f"user_id=eq.{uid}&select=id,status,block_id,completed_at&order=started_at")
            sets1 = rest("workout_sets", f"session_id=eq.{s1[0]['id']}&select=id") if s1 else []
            check("workout started from the scheduled session", s1 and s1[0]["block_id"] == (todays[0]["id"] if todays else None))
            check("every set logged", len(sets1) == sum(x["sets"] for x in rxs), f"{len(sets1)} sets")
            check("workout completed", s1 and s1[0]["status"] == "completed" and s1[0]["completed_at"])
            blk = rest("plan_blocks", f"id=eq.{todays[0]['id']}&select=status,evidence") if todays else [{}]
            ev = rest("plan_block_events", f"block_id=eq.{todays[0]['id']}&select=event_type&order=created_at") if todays else []
            check("plan session done with start and complete events", blk[0].get("status") == "done" and [e["event_type"] for e in ev][-2:] == ["start", "complete"], str(ev))
            # EVIDENCE
            led = rest("outcome_ledger", f"user_id=eq.{uid}&metric=eq.workout_completed&select=evidence_class,source")
            check("completion evidence labelled", blk[0].get("evidence") in ("self_reported", "supported", "verified_external") and led and led[0]["evidence_class"], f"{blk[0].get('evidence')} / {led}")
            init = rest("progression_events", f"user_id=eq.{uid}&rule=eq.initial_load_from_first_set&select=id")
            check("first sets set the starting loads", len(init) >= 1, f"{len(init)}")
            await page.get_by_role("button", name="Start").first.click()
            await do_workout(page, 40)
            await page.screenshot(path=str(SHOTS / "after2.png"))
            # PROGRESSION + NEXT PRESCRIPTION
            prog = rest("progression_events", f"user_id=eq.{uid}&rule=in.(double_progression_load,double_progression_reps)&select=prescription_id,rule,prior,next,evidence")
            check("progression applied after two top-of-range sessions", len(prog) >= 1, str(prog[:1])[:300])
            ok = False
            for e in prog:
                rx = rest("programme_prescriptions", f"id=eq.{e['prescription_id']}&select=load_kg,rep_max,revision")[0]
                ok = ok or (float(rx["load_kg"] or 0) == float(e["next"]["load_kg"] or 0) and rx["rep_max"] == e["next"]["rep_max"] and len(e["evidence"]["sessions"]) == 2)
            check("next prescription matches the logged rule and cites both sessions", ok)
            body = await page.inner_text("body")
            nxt = prog and rest("programme_prescriptions", f"id=eq.{prog[0]['prescription_id']}&select=load_kg")[0]["load_kg"]
            check("next prescription shown on Training", nxt is not None and f"@ {float(nxt):g} kg" in body.replace(".0 kg", " kg"), f"{nxt}")
            # REGRESSION: two sessions missing the lower rep target at the new prescription reduce the load.
            for _ in range(2):
                await page.get_by_role("button", name="Start").first.click()
                await do_workout(page, 40, miss=True)
            reg = rest("progression_events", f"user_id=eq.{uid}&rule=eq.regression_load&select=prescription_id,prior,next")
            check("regression applied after two missed lower targets", len(reg) >= 1 and all(float(e["next"]["load_kg"]) < float(e["prior"]["load_kg"]) for e in reg), str(reg[:1]))
            if reg:
                rx = rest("programme_prescriptions", f"id=eq.{reg[0]['prescription_id']}&select=load_kg")[0]
                check("next prescription carries the reduced load", float(rx["load_kg"]) == float(reg[0]["next"]["load_kg"]), str(rx))
            allev = rest("progression_events", f"user_id=eq.{uid}&select=id")
            check("every prescription change logged as a versioned event", len(allev) >= len(init) + len(prog) + len(reg))
        finally:
            await b.close()
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}", headers=H, timeout=30)
    print(f"\n{sum(results)} of {len(results)} pass  (tz {TZ})"); sys.exit(0 if all(results) else 1)
PROG = None
asyncio.run(main())
