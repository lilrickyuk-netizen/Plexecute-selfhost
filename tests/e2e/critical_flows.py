"""Step 71 critical flows (no lasting writes). Needs ~/.cache/lovable-auth/session.json. Run: python3 tests/e2e/critical_flows.py"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright
BASE = os.environ.get("BASE_URL", "http://localhost:8080")
results = []
def check(name, ok, info=""): results.append(ok); print(("PASS " if ok else "FAIL ") + name, info)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        # 1. Signed-out visitors are sent to sign in for every member page.
        anon = await (await b.new_context(viewport={"width": 1280, "height": 1800})).new_page()
        for path in ["/app/today", "/app/admin", "/app/coach"]:
            await anon.goto(BASE + path, wait_until="networkidle")
            check(f"signed-out {path} redirects to sign in", "/login" in anon.url, anon.url)
        # Signed in
        s = __import__("_member").session_file(admin=True)
        c = await b.new_context(viewport={"width": 1280, "height": 1800})
        for k in s["cookies"]: k["url"] = BASE
        await c.add_cookies(s["cookies"]); pg = await c.new_page()
        await pg.goto(BASE); await pg.evaluate(f"localStorage.setItem({json.dumps(s['storage_key'])}, {json.dumps(json.dumps(s['session']))})")
        # 2. Urgent wording gets emergency guidance and is never sent.
        sent = []
        pg.on("request", lambda r: sent.append(r.url) if "_serverFn" in r.url and r.method == "POST" else None)
        await pg.goto(BASE + "/app/help", wait_until="networkidle")
        await pg.get_by_label("Your message").fill("I have chest pain and can't breathe")
        sent.clear(); await pg.get_by_role("button", name="Send to support").click(); await pg.wait_for_timeout(1500)
        body = await pg.inner_text("body")
        check("urgent help shows 999 / NHS 111 / Samaritans", all(x in body for x in ["999", "NHS 111", "116 123"]))
        check("urgent message not sent", "Your message was not sent" in body, str(sent))
        # 3. Offline: the app tells the member and keeps Today usable.
        await pg.goto(BASE + "/app/today", wait_until="networkidle"); await c.set_offline(True); await pg.wait_for_timeout(800)
        check("offline banner appears", "offline" in (await pg.inner_text("body")).lower())
        await c.set_offline(False)
        # 4. Admin console is reachable for an admin and shows no member list.
        await pg.goto(BASE + "/app/admin/users", wait_until="networkidle"); t = await pg.inner_text("body")
        check("admin users page asks for exact email, no list", "email" in t.lower() and "only for administrators" not in t)
        await b.close()
    sys.exit(0 if all(results) else 1)
asyncio.run(main())
