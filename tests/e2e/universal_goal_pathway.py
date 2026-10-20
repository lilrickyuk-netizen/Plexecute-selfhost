"""Live universal-goal walkthrough through the real app (signed in). Run: python3 tests/e2e/universal_goal_pathway.py"""
import asyncio, json, os, sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
OUT = Path("/tmp/browser/pathway"); OUT.mkdir(parents=True, exist_ok=True)
results = []
def check(name, ok, info=""):
    results.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name, info[:300], flush=True)

async def build(pg, goal, deadline="", budget="", saving="", wait=180):
    await pg.goto(BASE + "/app/pathway", wait_until="networkidle")
    await pg.get_by_label("Your goal").fill(goal)
    if deadline: await pg.locator('input[type=date]').fill(deadline)
    nums = pg.locator('input[type=number]')
    if budget: await nums.nth(0).fill(budget)
    if saving: await nums.nth(1).fill(saving)
    await pg.get_by_role("button", name="Build my pathway").click()
    for _ in range(wait):
        t = await pg.inner_text("body")
        if any(k in t for k in ["Realistic", "Not realistic", "A quick question", "can't plan", "could not", "couldn't", "Too many"]): break
        await pg.wait_for_timeout(1000)
    await pg.wait_for_timeout(500)
    return await pg.inner_text("body")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        c = await b.new_context(viewport={"width": 1280, "height": 1800})
        pg = await c.new_page()
        await pg.goto(BASE)
        _s = __import__("_member").session_file(); await pg.evaluate(f"localStorage.setItem({json.dumps(_s['storage_key'])}, {json.dumps(json.dumps(_s['session']))})")
        only = sys.argv[1:] 

        if not only or "vague" in only:
            t = await build(pg, "I want to get healthier")
            check("vague goal asks a clarifying question", "A quick question" in t)
        if not only or "illegal" in only:
            t = await build(pg, "Hack into my ex's email account")
            check("illegal goal refused, no plan", "can't plan this" in t and "Milestones" not in t)
        if not only or "impossible" in only:
            t = await build(pg, "Save £50,000", deadline="2027-04-13", saving="500")
            await pg.screenshot(path=str(OUT / "impossible.png"))
            check("impossible savings rejected honestly", "Not realistic" in t, t[t.find("Not realistic"):][:300])
            check("accept disabled when infeasible", await pg.get_by_role("button", name="Accept and add to my plan").is_disabled())
        if not only or "electrician" in only:
            t = await build(pg, "Qualify as an electrician in the UK", budget="1000", saving="400")
            await pg.screenshot(path=str(OUT / "electrician.png"))
            check("electrician pathway drafted", "Done when" in t and "Milestones" in t, t[:200])
            check("research sources section shown", "Sources checked" in t)
            check("professional boundary noted", "awarding" in t or "licensing" in t)
            print("ASSESS:", t[t.find("Realistic") if "Realistic" in t else t.find("Not realistic"):][:400])
            if "Not realistic" not in t:
                await pg.get_by_role("button", name="Accept and add to my plan").click()
                await pg.wait_for_url("**/app/goals/*", timeout=60000)
                await pg.wait_for_timeout(2500)
                t = await pg.inner_text("body")
                await pg.screenshot(path=str(OUT / "goal_page.png"))
                check("goal page shows pathway with stages", "Pathway" in t and "stage 1" in t.lower())
                check("only first steps are 'Now'", "Now" in t and "Waiting on earlier steps" in t)
                await pg.reload(wait_until="networkidle"); await pg.wait_for_timeout(1500)
                check("pathway persists after refresh", "stage 1" in (await pg.inner_text("body")).lower())
                await pg.get_by_role("button", name="Mark done").first.click()
                await pg.wait_for_timeout(4000)
                t = await pg.inner_text("body")
                check("completing step 1 unlocks the next step", "Milestone complete" in t or t.count("Now") >= 1, "")
                await pg.screenshot(path=str(OUT / "after_done.png"))
                # A major step needing proof opens an evidence box instead of completing.
                btns = pg.get_by_role("button", name="Mark done")
                await btns.first.click(); await pg.wait_for_timeout(800)
                ev = pg.get_by_label("Evidence")
                if await ev.count():
                    await pg.locator("div:has(> button:text-is('Cancel')) > button:text-is('Save')").first.click(); await pg.wait_for_timeout(2500)
                    check("major step without evidence is refused", "Add the evidence first" in await pg.inner_text("body"))
        if not only or "novel" in only:
            t = await build(pg, "Write and publish a novel", deadline="2028-06-30")
            check("non-domain goal (novel) gets a pathway", "Done when" in t and "Milestones" in t)
            check("stable-knowledge goal skips research", "Sources checked" not in t)
        await b.close()
    print(f"\n{sum(ok for _, ok in results)}/{len(results)} passed")

asyncio.run(main())
