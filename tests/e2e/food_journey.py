"""Step 80: full signed-in food journey through the real page: manual food 200 kcal/100 g, 150 g logged -> server stores 300 kcal; entry appears, is removed again. Run: python3 tests/e2e/food_journey.py"""
import asyncio, json, os, sys, re
from playwright.async_api import async_playwright
m = __import__("_member").session_file()
NAME = "E2E check oats"
res = []
def check(n, ok, i=""): res.append(ok); print(("PASS " if ok else "FAIL ") + n, i)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True); c = await b.new_context(viewport={"width": 1280, "height": 1800})
        cs = m["cookies"]; [x.__setitem__("url", "http://localhost:8080") for x in cs]; await c.add_cookies(cs)
        pg = await c.new_page(); await pg.goto("http://localhost:8080")
        await pg.evaluate(f"localStorage.setItem({json.dumps(m['storage_key'])}, {json.dumps(json.dumps(m['session']))})")
        await pg.goto("http://localhost:8080/app/nutrition"); await pg.get_by_role("button", name="Add food").first.click()
        await pg.get_by_role("tab", name="Manual").click()
        await pg.get_by_placeholder("Food name").fill(NAME); await pg.get_by_placeholder("kcal").fill("200"); await pg.get_by_placeholder("Protein").fill("10")
        await pg.get_by_role("button", name="Next").click()
        await pg.get_by_role("dialog").locator('input[type=number]').fill("150"); await pg.get_by_role("button", name="Log", exact=True).click()
        row = pg.locator("div.mb-1\\.5", has_text=NAME).first
        await row.wait_for(timeout=15000); t = await row.inner_text()
        await pg.screenshot(path="/tmp/browser/s80/logged.png")
        check("logged entry shows on the page", NAME in t, t.replace("\n", " "))
        check("server calculated 300 kcal from 150 g", bool(re.search(r"\b300 kcal", t)))
        check("server calculated 15 g protein", "P15" in t)
        await row.get_by_role("button", name="Remove").click()
        await pg.wait_for_timeout(2000); await pg.reload(); await pg.wait_for_timeout(3000)
        check("entry removed and stays removed after reload", await pg.locator("div.mb-1\\.5", has_text=NAME).count() == 0)
        await b.close()
asyncio.run(main()); sys.exit(0 if all(res) else 1)
