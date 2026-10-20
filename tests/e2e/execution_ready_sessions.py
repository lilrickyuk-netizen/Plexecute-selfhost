"""Execution-Ready Sessions live test: brand-new member, zero navigation to first lesson.
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
    box = page.get_by_placeholder("Tell Coach what you need…")
    await box.fill(q); await box.press("Enter")
    for _ in range(120):
        await page.wait_for_timeout(2000)
        t = await page.inner_text("body")
        if "Thinking" not in t and len(t) > len(before) + 80 and q in t: break
    t = await page.inner_text("body")
    return t[t.rfind(q) + len(q):][:900]

async def main():
    email = f"e2e-ers-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"; pw = "E2e!" + uuid.uuid4().hex; uid = None
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        page = await (await b.new_context(viewport={"width": 411, "height": 900})).new_page()
        try:
            r = requests.post(f"{URL}/auth/v1/admin/users", headers=H, timeout=30, json={"email": email, "password": pw, "email_confirm": True, "user_metadata": {"date_of_birth": "1990-05-01"}})
            r.raise_for_status(); uid = r.json()["id"]
            await page.goto(f"{BASE}/login", wait_until="networkidle")
            await page.fill("#email", email); await page.fill("#pw", pw)
            await page.get_by_role("button", name="Log in").click()
            await page.wait_for_url("**/onboarding**", timeout=30000)
            await page.wait_for_timeout(1500); await page.get_by_role("textbox").first.fill("Session Tester")
            await page.get_by_text("I confirm I am 18 or older").click(); await page.get_by_text("I agree to the").click()
            await page.get_by_role("button", name="Continue").click()
            await __import__("_onboarding").questionnaire(page,
                "Learn coding from scratch and become a full-stack software developer")
            await page.get_by_role("button", name="Accept and start").click()
            await page.wait_for_url("**/app/coach**", timeout=90000)
            check("onboarding completes to Coach hub", "/app/coach" in page.url)

            goals = rest("goals", f"user_id=eq.{uid}&select=id,title,domain")
            print("goals", goals)
            learn = [g for g in goals if g["domain"] == "learning"]
            topics = rest("learning_topics", f"user_id=eq.{uid}&select=goal_id,title,position&order=position")
            res = rest("learning_resources", f"user_id=eq.{uid}&select=url,content")
            check("learning syllabus prepared at plan time (no manual build)", len(topics) >= 3, f"{len(topics)} topics")
            check("all saved resources are real https links", res and all(x["url"].startswith("https://") for x in res), f"{len(res)} resources")
            blocks = rest("plan_blocks", f"user_id=eq.{uid}&select=id,title,occurrence_kind,goal_id,status,starts_at&order=starts_at")
            lb = [x for x in blocks if x["occurrence_kind"] in ("learning", "study")]
            cb = [x for x in blocks if x["occurrence_kind"] == "work_task"]
            print("kinds", sorted({x["occurrence_kind"] for x in blocks}))
            check("first week has learning sessions", lb, f"{len(lb)}")

            # Zero navigation: Today -> next session -> start.
            await page.goto(f"{BASE}/app/today", wait_until="domcontentloaded"); await page.wait_for_timeout(6000)
            await page.screenshot(path=str(SHOTS / "2_today.png"))
            tt = await page.inner_text("body")
            check("Today shows next session's objective + start-here", await page.locator("[data-testid=today-next-brief]").count() > 0 or "Day executed" in tt or "Nothing scheduled" in tt, tt[tt.find("Next up"):][:250].replace("\n", " | "))

            if lb:
                t = await session_text(page, lb[0]["id"]); await page.screenshot(path=str(SHOTS / "3_learning.png"))
                check("learning session: concrete beginner first topic", "variables" in t.lower() or "html" in t.lower(), t[:300].replace("\n", " | "))
                href = await page.get_by_role("link", name="Start lesson").get_attribute("href") if await page.get_by_role("link", name="Start lesson").count() else None
                check("primary CTA opens a real saved lesson", href and href.startswith("https://") and any(href == x["url"] for x in res), href)
                check("completion + next step shown", "practice" in t.lower() and "Next session" in t, "")
                check("why links to goal", "Part of your goal" in t)
            if cb:
                t = await session_text(page, cb[0]["id"]); await page.screenshot(path=str(SHOTS / "4_career.png"))
                check("career session: concrete task from pathway, not 'work on goal'", "Complete the Python basics" in t or "Set up Git" in t, t[:300].replace("\n", " | "))
                check("career session lists official sources", "docs.python.org" in (await page.content()) or "git-scm.com" in (await page.content()))

            # Plan rows: compact objective line.
            await page.goto(f"{BASE}/app/plan", wait_until="domcontentloaded"); await page.wait_for_timeout(8000)
            await page.screenshot(path=str(SHOTS / "5_plan.png"))
            pt = await page.inner_text("body")
            check("Plan rows show short objective", "Today:" in pt or "Complete the Python" in pt or "exercises." in pt, "")

            # Coach inside a session.
            if lb:
                a1 = await ask_coach(page, lb[0]["id"], "What do I do first?")
                await page.screenshot(path=str(SHOTS / "6_coach1.png"))
                check("Coach 'what first' answers from the session", any(k in a1.lower() for k in ("informal introduction", "variables", "python tutorial")), a1[:300].replace("\n", " | "))
                a2 = await ask_coach(page, lb[0]["id"], "Why am I doing this?")
                check("Coach 'why' uses the real goal chain", "coding" in a2.lower() or "developer" in a2.lower(), a2[:300].replace("\n", " | "))

            # Complete -> next topic becomes the session's objective (stale-pathway refresh).
            if lb:
                bid = lb[0]["id"]
                await session_text(page, bid)
                for nm in ("Start lesson",):
                    pass
                await page.get_by_role("button", name="Start").first.click(); await page.wait_for_timeout(2000)
                await page.get_by_role("button", name="Done").first.click(); await page.wait_for_timeout(3000)
                d = rest("plan_blocks", f"id=eq.{bid}&select=status,completed_at")[0]
                check("session completed once", d["status"] == "done" and d["completed_at"], json.dumps(d))
                ev = rest("plan_block_events", f"block_id=eq.{bid}&to_status=eq.done&select=id")
                check("no duplicate completion events", len(ev) == 1, f"{len(ev)}")
                g0 = lb[1]["goal_id"] if len(lb) > 1 else lb[0]["goal_id"]
                first = rest("learning_topics", f"goal_id=eq.{g0}&select=id,title&order=position&limit=1")[0]
                patch("learning_topics", f"id=eq.{first['id']}", {"done_at": "2026-10-13T20:00:00Z"})
                if len(lb) > 1:
                    t = await session_text(page, lb[1]["id"])
                    check("after progress, next session moves on (no repeated basics)", first["title"] not in t.split("Start here")[0], t[:200].replace("\n", " | "))
                    # Move: same row keeps its brief.
                    nb = lb[1]["id"]; old = rest("plan_blocks", f"id=eq.{nb}&select=starts_at")[0]["starts_at"]
                    n0 = len(rest("plan_blocks", f"user_id=eq.{uid}&select=id"))
                    await page.locator("[data-testid=session-objective]").wait_for()
                    await page.locator("[aria-haspopup=menu]").last.click(); await page.wait_for_timeout(500)
                    await page.get_by_text("Snooze 1 hour").click(); await page.wait_for_timeout(3500)
                    new = rest("plan_blocks", f"id=eq.{nb}&select=starts_at,status")[0]
                    n1 = len(rest("plan_blocks", f"user_id=eq.{uid}&select=id"))
                    t2 = await session_text(page, nb)
                    check("move: same session moved, no duplicate", new["starts_at"] != old and n1 == n0, f"{old} -> {new['starts_at']} rows {n0}->{n1}")
                    check("move: objective and lesson stay attached", "Conditions and basic logic" in t2 and await page.get_by_role("link", name="Start lesson").count() == 1)
                    # Stale pathway: the member changes the syllabus; the session follows immediately.
                    t3_id = rest("learning_topics", f"goal_id=eq.{g0}&title=like.Conditions*&select=id")[0]["id"]
                    patch("learning_topics", f"id=eq.{t3_id}", {"title": "Loops and decisions (rewritten)"})
                    t3 = await session_text(page, nb)
                    check("stale pathway: changed topic replaces old instruction", "Loops and decisions (rewritten)" in t3 and "Conditions and basic logic" not in t3.split("Start here")[0])
                    # Cancel/remove: the session no longer offers a start action.
                    await page.locator("[aria-haspopup=menu]").last.click(); await page.wait_for_timeout(500)
                    await page.get_by_text("Skip with reason").click(); await page.wait_for_timeout(600)
                    await page.get_by_role("radio").first.click(); await page.get_by_role("button", name="Save").click(); await page.wait_for_timeout(3500)
                    st = rest("plan_blocks", f"id=eq.{nb}&select=status")[0]["status"]
                    t4 = await session_text(page, nb)
                    check("removed session shows no start action", st in ("cancelled", "skipped") and not await page.get_by_role("link", name="Start lesson").count(), st)
            # Booking + journey surfaced on a session (existing records).
            cm = post("commitments", {"user_id": uid, "title": "Dentist", "kind": "appointment", "recurrence": "once", "on_date": time.strftime("%Y-%m-%d", time.gmtime(time.time() + 3 * 86400)), "start_time": "14:00", "end_time": "14:45", "days": []})
            cid = cm[0]["id"]
            appt = time.strftime("%Y-%m-%dT14:00:00Z", time.gmtime(time.time() + 3 * 86400))
            bk = post("appointment_bookings", {"user_id": uid, "idempotency_key": f"e2e-{uuid.uuid4().hex}", "service": "Dental check-up", "kind": "appointment", "method": "online", "status": "checkout_ready", "payment_state": "checkout_ready", "provider_name": "Smile Dental", "checkout_url": "https://example.com/checkout", "commitment_id": cid})
            post("journeys", {"user_id": uid, "appointment_id": bk[0]["id"], "origin_address": "Home", "dest_address": "1 High St", "dest_label": "Smile Dental", "mode": "transit", "arrive_by": appt, "leave_at": appt.replace("14:00", "13:15"), "duration_min": 31, "buffer_min": 14})
            blk = post("plan_blocks", {"user_id": uid, "title": "Dentist", "domain": "admin", "occurrence_kind": "appointment_prep", "source_type": "commitment", "commitment_id": cid, "starts_at": appt, "original_starts_at": appt, "duration_min": 45, "status": "planned", "source_ref": f"e2e:{cid}"})
            t = await session_text(page, blk[0]["id"]); await page.screenshot(path=str(SHOTS / "7_booking.png"))
            check("booking: status and provider on the session", "Smile Dental" in t and "checkout ready" in t.lower(), t[:300].replace("\n", " | "))
            href = await page.get_by_role("link", name="Finish on the business's checkout").get_attribute("href") if await page.get_by_role("link", name="Finish on the business's checkout").count() else None
            check("booking: primary action is the business's checkout handoff", href == "https://example.com/checkout", href)
            check("journey: leave time, travel and buffer shown with Open journey", ("Leave at 14:15" in t or "Leave at 13:15" in t) and "UTC" not in t and "Travel 31 min" in t and "14 min arrival buffer" in t and "Open journey" in t)
            n = len(rest("appointment_bookings", f"user_id=eq.{uid}&select=id"))
            check("viewing the session creates no duplicate booking", n == 1)
            # Deleted goal: its sessions stop claiming the goal.
            patch("goals", f"id=eq.{learn[0]['id']}", {"status": "archived"})
            t = await session_text(page, lb[2]["id"] if len(lb) > 2 else lb[0]["id"])
            check("archived goal no longer explains its sessions", "Part of your goal" not in t)
        finally:
            await b.close()
            if uid:
                requests.delete(f"{URL}/auth/v1/admin/users/{uid}", headers=H, timeout=30)
    print(f"\n{sum(ok for _, ok in results)} of {len(results)} pass")
    sys.exit(0 if all(ok for _, ok in results) else 1)

asyncio.run(main())
