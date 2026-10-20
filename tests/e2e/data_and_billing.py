"""Step 72 critical flows: data download and plan prices (download writes only an audit/export record). Run: python3 tests/e2e/data_and_billing.py"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright
BASE = os.environ.get("BASE_URL", "http://localhost:8080"); res = []
def check(n, ok, i=""): res.append(ok); print(("PASS " if ok else "FAIL ") + n, i)
async def main():
    s = __import__("_member").session_file()
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True); c = await b.new_context(viewport={"width": 1280, "height": 1800}, accept_downloads=True)
        for k in s["cookies"]: k["url"] = BASE
        await c.add_cookies(s["cookies"]); pg = await c.new_page()
        await pg.goto(BASE); await pg.evaluate(f"localStorage.setItem({json.dumps(s['storage_key'])}, {json.dumps(json.dumps(s['session']))})")
        await pg.goto(BASE + "/app/privacy", wait_until="networkidle")
        async with pg.expect_download(timeout=30000) as d:
            await pg.get_by_role("button", name="Download a copy of my data").click()
        f = await (await d.value).path(); data = json.load(open(f)); txt = json.dumps(data)
        uid = s["session"]["user"]["id"]
        check("data download is valid JSON with tables", isinstance(data, dict) and len(txt) > 100, f"{len(txt)} bytes")
        import re
        others = set(re.findall(r'"user_id":\s*"([0-9a-f-]{36})"', txt)) - {uid}
        check("download holds only this member's records", not others, str(len(others)))
        check("download has no secret fields", not re.search(r'service_role|access_token|refresh_token|key_hash|secret', txt, re.I))
        await pg.goto(BASE + "/app/billing", wait_until="networkidle"); t = await pg.inner_text("body")
        check("Execute monthly price £59.99 shown", "59.99" in t)
        await b.close()
    sys.exit(0 if all(res) else 1)
asyncio.run(main())
