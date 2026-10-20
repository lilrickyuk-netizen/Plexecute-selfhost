"""Step 70 signed-in smoke suite. Needs a session file from `lovable auth-session --json`. Run: python3 tests/e2e/signed_in_smoke.py"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright
BASE = os.environ.get("BASE_URL", "http://localhost:8080")
PAGES = ["/app/today", "/app/plan", "/app/training", "/app/nutrition", "/app/coach", "/app/integrations", "/app/help", "/app/settings", "/app/billing"]
async def main():
    s = __import__("_member").session_file()
    fails = []
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True); c = await b.new_context(viewport={"width": 1280, "height": 1800})
        for k in s["cookies"]: k["url"] = BASE
        await c.add_cookies(s["cookies"]); pg = await c.new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(BASE); await pg.evaluate(f"localStorage.setItem({json.dumps(s['storage_key'])}, {json.dumps(json.dumps(s['session']))})")
        for path in PAGES:
            errs.clear(); r = await pg.goto(BASE + path, wait_until="networkidle")
            body = await pg.inner_text("body")
            ok = r and r.status < 400 and "/auth" not in pg.url and not errs and "Something went wrong" not in body
            print(("PASS " if ok else "FAIL ") + path, pg.url, errs[:1]); ok or fails.append(path)
        await b.close()
    sys.exit(1 if fails else 0)
asyncio.run(main())
