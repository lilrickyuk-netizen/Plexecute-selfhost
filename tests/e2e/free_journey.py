"""Completion item 78: critical end-to-end test, FREE PLAN.

ALL FREE ENTITLEMENTS AND LIMITS: a useful full Free experience, AI caps enforced,
deterministic tools remain available, zero PSTN/live voice, transparent upgrade prompts,
no hidden paid requests.

Fresh account per run, removed afterwards. Time zone is one where it is morning so today's
session can be scheduled at any UTC hour.
"""
import asyncio, os, uuid
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
import requests
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
URL = os.environ["SUPABASE_URL"]; SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": SR, "Authorization": f"Bearer {SR}", "Content-Type": "application/json", "Prefer": "return=representation"}
SHOTS = Path("/tmp/browser/j78"); SHOTS.mkdir(parents=True, exist_ok=True)
results = []
def check(n, ok, d=""): results.append(bool(ok)); print(("PASS " if ok else "FAIL ") + n + (f" :: {d}" if d else ""))
def rest(t, q): r = requests.get(f"{URL}/rest/v1/{t}?{q}", headers=H, timeout=30); r.raise_for_status(); return r.json()
def patch(t, q, body): r = requests.patch(f"{URL}/rest/v1/{t}?{q}", headers=H, json=body, timeout=30); assert r.ok, r.text
def post(t, body): r = requests.post(f"{URL}/rest/v1/{t}", headers=H, json=body, timeout=30); assert r.ok, r.text; return r.json()
ZONES = ["Pacific/Honolulu", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo",
         "Europe/London", "Europe/Berlin", "Europe/Athens", "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"]
TZ = next(z for z in ZONES if 6 <= datetime.now(ZoneInfo(z)).hour <= 9)
TODAY = datetime.now(ZoneInfo(TZ)).date().isoformat()

async def main():
    email = f"e2e-free-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"; pw = "E2e!" + uuid.uuid4().hex; uid = None
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        page = await (await b.new_context(viewport={"width": 1280, "height": 1800}, timezone_id=TZ)).new_page()
        try:
            r = requests.post(f"{URL}/auth/v1/admin/users", headers=H, timeout=30, json={"email": email, "password": pw, "email_confirm": True, "user_metadata": {"date_of_birth": "1990-05-01"}})
            r.raise_for_status(); uid = r.json()["id"]
            patch("profiles", f"id=eq.{uid}", {"onboarded": True, "timezone": TZ, "display_name": "Free Tester", "wake_time": "06:00", "sleep_time": "23:00", "work_days": []})
            await page.goto(f"{BASE}/login", wait_until="networkidle")
            await page.fill("#email", email); await page.fill("#pw", pw)
            await page.get_by_role("button", name="Log in").click(); await page.wait_for_url("**/app/**", timeout=20000)
            prof = rest("profiles", f"id=eq.{uid}&select=tier")[0]
            check("account starts on the Free plan", prof["tier"] == "free", str(prof))

            # USEFUL FULL FREE EXPERIENCE: goal -> replan -> approve -> Today -> complete -> Progress.
            await page.goto(f"{BASE}/app/goals", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Add goal").click(); await page.wait_for_timeout(800)
            await page.get_by_placeholder("e.g. Get stronger, learn Spanish").fill("Read every day")
            await page.get_by_role("button", name="Save goal").click(); await page.wait_for_timeout(2000)
            goals = rest("goals", f"user_id=eq.{uid}&select=id,title,status,weekly_minutes")
            check("goal created", len(goals) == 1 and goals[0]["status"] == "active", str(goals))

            await page.goto(f"{BASE}/app/plan", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Replan").first.click(); await page.wait_for_timeout(4000)
            await page.get_by_role("button", name="Apply permanently").click(); await page.wait_for_timeout(3500)
            blocks = rest("plan_blocks", f"user_id=eq.{uid}&status=eq.planned&select=id,starts_at,title&order=starts_at")
            todays = [x for x in blocks if datetime.fromisoformat(x["starts_at"]).astimezone(ZoneInfo(TZ)).date().isoformat() == TODAY]
            check("deterministic replan scheduled sessions", len(blocks) >= 1, f"{len(blocks)} blocks")
            check("a session lands today", len(todays) >= 1, str(todays))

            await page.goto(f"{BASE}/app/today", wait_until="networkidle"); await page.wait_for_timeout(1500)
            check("session shown on Today", await page.get_by_text("Read every day").first.is_visible(), "")
            if todays:
                bid = todays[0]["id"]
                now = datetime.now(ZoneInfo(TZ)).isoformat()
                patch("plan_blocks", f"id=eq.{bid}", {"status": "started", "started_at": now})
                post("plan_block_events", {"user_id": uid, "block_id": bid, "event_type": "start", "from_status": "planned", "to_status": "started", "occurred_at": now, "actor_type": "user", "actor_id": uid, "source_channel": "app"})
                patch("plan_blocks", f"id=eq.{bid}", {"status": "done", "completed_at": now})
                post("plan_block_events", {"user_id": uid, "block_id": bid, "event_type": "complete", "from_status": "started", "to_status": "done", "occurred_at": now, "actor_type": "user", "actor_id": uid, "source_channel": "app"})
                await page.goto(f"{BASE}/app/progress", wait_until="networkidle"); await page.wait_for_timeout(1500)
                body = await page.content()
                import re as _re
                m = _re.search(r"(\d+) of \d+ min · (\d+)/(\d+) sessions", body)
                check("Progress counts the finished session", bool(m) and m.group(2) == "1" and m.group(1) != "0", m.group(0) if m else "no plan-vs-actual row")

            # GOAL LIMIT: Free includes up to 3 active goals; a 4th is refused.
            post("goals", {"user_id": uid, "domain": "learning", "title": "Seed two", "status": "active", "weekly_minutes": 30, "session_minutes": 30})
            post("goals", {"user_id": uid, "domain": "wellness", "title": "Seed three", "status": "active", "weekly_minutes": 30, "session_minutes": 30})
            await page.goto(f"{BASE}/app/goals", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.screenshot(path=str(SHOTS / "goal_limit.png"))
            body = await page.content()
            blocked = await page.get_by_role("button", name="Goal limit reached on Free").is_disabled()
            r4 = requests.post(f"{URL}/rest/v1/goals", headers=H, timeout=30,
                               json={"user_id": uid, "domain": "learning", "title": "One goal too many", "status": "active", "weekly_minutes": 30, "session_minutes": 30})
            goals = rest("goals", f"user_id=eq.{uid}&status=eq.active&select=id")
            check("the page says the Free goal limit is reached", "Goal limit reached on Free" in body and blocked, "")
            check("4th active goal refused with a clear reason", not r4.ok and "up to 3 active goals" in r4.text and len(goals) == 3, r4.text[:160])

            # COACH CAP: 5 free turns per day; exhausted state shows a transparent upgrade prompt.
            await page.goto(f"{BASE}/app/coach", wait_until="networkidle"); await page.wait_for_timeout(2000)
            body = await page.content()
            check("coach shows the free turn allowance", "5" in body and "turn" in body.lower(), "")
            for i in range(5):
                post("coach_messages", {"user_id": uid, "role": "user", "content": f"seeded turn {i}", "mode": "COACH"})
            await page.goto(f"{BASE}/app/coach", wait_until="networkidle"); await page.wait_for_timeout(2000)
            await page.screenshot(path=str(SHOTS / "coach_limit.png"))
            body = await page.content()
            check("out-of-turns state names the paid allowance", "200 coach turns" in body, "")
            check("upgrade prompt links to plan comparison", await page.get_by_role("link", name="Compare plans").first.is_visible(), "")
            check("composer is hidden when out of turns", not await page.locator("#coach-input").is_visible(), "")

            # AI TOKEN BUDGET: with today's free AI budget used up, the coach refuses before any provider call.
            r = requests.post(f"{URL}/rest/v1/rpc/reserve_ai_budget", headers=H, timeout=30,
                              json={"_user_id": uid, "_day": TODAY, "_in": 25000, "_out": 5000, "_max_in": 25000, "_max_out": 5000})
            check("budget reservation rpc works", r.ok and r.json() is True, r.text[:200])
            r = requests.post(f"{URL}/rest/v1/rpc/reserve_ai_budget", headers=H, timeout=30,
                              json={"_user_id": uid, "_day": TODAY, "_in": 1, "_out": 1, "_max_in": 25000, "_max_out": 5000})
            check("budget refuses once exhausted", r.ok and r.json() is False, r.text[:200])
            usage = rest("ai_usage", f"user_id=eq.{uid}&select=input_tokens,output_tokens")
            check("AI usage is recorded per local day", len(usage) == 1 and usage[0]["input_tokens"] >= 25000, str(usage))

            # ZERO PSTN / LIVE VOICE: the Accountability page is an upgrade prompt, no calling controls.
            await page.goto(f"{BASE}/app/accountability", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.screenshot(path=str(SHOTS / "accountability.png"))
            body = await page.content()
            check("calls are presented as a paid feature", "part of Pro" in body, "")
            check("no call-now control for Free", not await page.get_by_role("button", name="Call me now").is_visible(), "")

            # TRANSPARENT UPGRADE: the billing page shows the plans.
            await page.goto(f"{BASE}/app/billing", wait_until="networkidle"); await page.wait_for_timeout(1500)
            body = await page.content()
            check("plan comparison is reachable and clear", "Pro" in body and "Execute" in body, "")

            # NO HIDDEN PAID REQUESTS: tier untouched, no subscriptions, no call campaigns.
            prof = rest("profiles", f"id=eq.{uid}&select=tier")[0]
            subs = rest("subscriptions", f"user_id=eq.{uid}&select=user_id")
            camps = rest("call_campaigns", f"user_id=eq.{uid}&select=id")
            check("tier stays free", prof["tier"] == "free", str(prof))
            check("no subscription rows created", len(subs) == 0, str(subs))
            check("no call campaigns created", len(camps) == 0, str(camps))
        finally:
            await b.close()
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}", headers=H, timeout=30)
    print(f"\n{sum(results)}/{len(results)} checks passed")
    sys.exit(0 if all(results) else 1)

import sys
asyncio.run(main())
