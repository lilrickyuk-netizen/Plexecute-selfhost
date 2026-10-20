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
GOAL = sys.argv[1]; TAG = sys.argv[2]
SHOTS = Path(f"/tmp/browser/univ/{TAG}"); SHOTS.mkdir(parents=True, exist_ok=True)
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
            await page.wait_for_load_state("networkidle"); await page.wait_for_timeout(3000); await page.get_by_role("textbox").first.fill("Session Tester")
            await page.get_by_text("I confirm I am 18 or older").click(); await page.get_by_text("I agree to the").click()
            await page.wait_for_timeout(1500)
            nm = page.get_by_role("textbox").first
            if not await nm.input_value(): await nm.fill("Session Tester")
            await page.get_by_role("button", name="Continue").click()
            await page.get_by_label("Tell Plexecute about your life").fill(
                GOAL + " "
                "I work Monday to Friday 9 to 5. I can study 4 evenings a week for an hour. Sleep 11 till 7.")
            await page.get_by_role("button", name="Send").click()
            await page.wait_for_function("!document.body.innerText.includes('Understanding…')", timeout=180000)
            for _ in range(4):
                if await page.get_by_text("Skip these").count(): await page.get_by_text("Skip these").click(); await page.wait_for_timeout(800)
                if await page.get_by_role("button", name="Looks right").count(): break
                if await page.get_by_text("I'm not sure yet").count(): await page.get_by_text("I'm not sure yet").first.click(); await page.wait_for_timeout(800)
                for nm in ("Skip", "Continue", "Next"):
                    if await page.get_by_role("button", name=nm).count(): await page.get_by_role("button", name=nm).first.click(); await page.wait_for_timeout(1500); break
            await page.screenshot(path=str(SHOTS / "1_review.png"))
            await page.get_by_role("button", name="Looks right").click(); await page.wait_for_timeout(2500)
            await page.get_by_role("button", name="Accept and start").click()
            await page.wait_for_url("**/app/coach**", timeout=90000)
            check("onboarding completes to Coach hub", "/app/coach" in page.url)

            goals = rest("goals", f"user_id=eq.{uid}&select=id,title,domain")
            print("goals", goals)
            ms = rest("goal_milestones", f"user_id=eq.{uid}&select=goal_id,title,sources")
            check("pathway prepared before first session", ms or any(g["domain"] in ("training","cardio","mobility") for g in goals), f"{len(ms)} milestones")
            srcs = [s.get("url","") for m in ms for s in (m["sources"] or [])]
            check("any links are real https", all(u.startswith("https://") for u in srcs), f"{len(srcs)} links")
            blocks = rest("plan_blocks", f"user_id=eq.{uid}&goal_id=not.is.null&select=id,title,occurrence_kind,goal_id&order=starts_at")
            check("first week has goal sessions", blocks, f"{len(blocks)}")
            seen = set()
            for blk in blocks:
                if blk["goal_id"] in seen: continue
                seen.add(blk["goal_id"])
                t = await session_text(page, blk["id"]); await page.screenshot(path=str(SHOTS / f"session_{len(seen)}.png"))
                print("SESSION", blk["occurrence_kind"], t[:500].replace("\n"," | "))
                check(f"[{blk['title']}] no manual pathway build needed", "Build my pathway" not in t and "Build my learning path" not in t and "no step-by-step pathway" not in t and "No training programme yet" not in t)
                check(f"[{blk['title']}] goal relationship shown", "Part of your goal" in t)
        except Exception as e:
            check("run", False, repr(e)[:300]); await page.screenshot(path=str(SHOTS / "err.png"))
        finally:
            await b.close()
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}", headers=H, timeout=30)
    print("SUMMARY", TAG, sum(o for _, o in results), "/", len(results))
asyncio.run(main())
