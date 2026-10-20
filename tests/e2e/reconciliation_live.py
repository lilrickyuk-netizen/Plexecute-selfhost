"""Item 101 reconciliation: live signed-in checks for items whose matrix row still said
"live check pending" and no earlier journey covered — 20 yoga/mobility, 30 coaching styles.
Fresh account per run, removed afterwards."""
import asyncio, os, sys, uuid
from pathlib import Path
import requests
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json","Prefer":"return=representation"}
SHOTS=Path("/tmp/browser/r101"); SHOTS.mkdir(parents=True,exist_ok=True); res=[]
def check(n,ok,d=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ")+n+(f" :: {d}" if d else ""))
def rest(t,q): r=requests.get(f"{URL}/rest/v1/{t}?{q}",headers=H,timeout=30); r.raise_for_status(); return r.json()
async def main():
    email=f"e2e-rec-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"; pw="E2e!"+uuid.uuid4().hex; uid=None
    async with async_playwright() as p:
        b=await p.chromium.launch(headless=True); page=await (await b.new_context(viewport={"width":1280,"height":1800})).new_page()
        try:
            r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,timeout=30,json={"email":email,"password":pw,"email_confirm":True,"user_metadata":{"date_of_birth":"1990-05-01"}}); r.raise_for_status(); uid=r.json()["id"]
            requests.patch(f"{URL}/rest/v1/profiles?id=eq.{uid}",headers=H,json={"onboarded":True,"timezone":"Europe/London","display_name":"Rec Tester","wake_time":"06:00","sleep_time":"23:00","work_days":[]}).raise_for_status()
            await page.goto(f"{BASE}/login",wait_until="networkidle"); await page.fill("#email",email); await page.fill("#pw",pw)
            await page.get_by_role("button",name="Log in").click(); await page.wait_for_url("**/app/**",timeout=20000)
            # 20 mobility
            await page.goto(f"{BASE}/app/wellness?section=mobility",wait_until="networkidle"); await page.wait_for_timeout(1500)
            body=await page.inner_text("main")
            check("mobility session prescribed with steps",("Level 1" in body) and ("Easier:" in body),body[:200])
            await page.get_by_role("button",name="knee",exact=True).click(); await page.wait_for_timeout(2000)
            await page.screenshot(path=str(SHOTS/"mobility.png"))
            await page.get_by_role("button",name="About right").click()
            await page.get_by_role("button",name="Save session").click(); await page.wait_for_timeout(3000)
            ms=rest("movement_sessions",f"user_id=eq.{uid}&kind=eq.mobility&select=level,tolerance,completed,policy_version")
            check("mobility session saved",len(ms)==1 and ms[0]["tolerance"]=="right",str(ms))
            ol=rest("outcome_ledger",f"user_id=eq.{uid}&domain=eq.mobility&select=id"); check("mobility outcome recorded",len(ol)==1)
            # 30 coaching styles
            styles={}
            for st in ["supportive","disciplined"]:
                requests.patch(f"{URL}/rest/v1/profiles?id=eq.{uid}",headers=H,json={"coaching_style":st}).raise_for_status()
                await page.goto(f"{BASE}/app/coach",wait_until="networkidle"); await page.wait_for_timeout(1500)
                box=page.get_by_placeholder("Tell Coach what you need…"); await box.fill("I skipped my workout today. What should I do?"); await box.press("Enter")
                for _ in range(45):
                    await page.wait_for_timeout(1000)
                    m=rest("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=content&order=created_at.desc&limit=1")
                    if len(rest("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=id"))>len(styles): break
                styles[st]=m[0]["content"] if m else ""
            await page.screenshot(path=str(SHOTS/"coach.png"))
            check("coach replies in both styles",all(len(v)>20 for v in styles.values()),str({k:v[:80] for k,v in styles.items()}))
            check("styles produce different replies",styles["supportive"]!=styles["disciplined"])
            print("SUPPORTIVE:",styles["supportive"][:300]); print("DISCIPLINED:",styles["disciplined"][:300])
        finally:
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}",headers=H,timeout=30)
            await b.close()
    print(f"{sum(res)}/{len(res)} pass"); sys.exit(0 if all(res) else 1)
asyncio.run(main())
