"""Tap-answer onboarding: new members answer the multiple-choice questionnaire, review, accept the first plan.
Real AI, real planner, real records. Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Accounts deleted afterwards."""
import asyncio, os, sys, time, uuid, re
from pathlib import Path
import requests
from playwright.async_api import async_playwright

BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json"}
SHOTS=Path("/tmp/browser/tap/shots"); SHOTS.mkdir(parents=True,exist_ok=True)
results=[]
def check(n,ok,d=""): results.append(bool(ok)); print(("PASS " if ok else "FAIL ")+n+(f" :: {d}" if d else ""),flush=True)
def rest(t,q): r=requests.get(f"{URL}/rest/v1/{t}?{q}",headers=H,timeout=30); r.raise_for_status(); return r.json()

P=[
 {"k":"A","mobile":False,"goal":"Write my first novel","answers":[["Creative projects","Business and entrepreneurship"],"Monday to Friday, 9am to 5pm","7:00am","11:00pm","3 sessions a week","45 minutes",["Weekday evenings"],["None"],["Not knowing where to start"],"Evening",["A completed creative ambition"]],"unsure":False},
 {"k":"B","mobile":True,"goal":"Learn Spanish","answers":[["Learning a skill or language","Money and financial security"],"Retired","8:00am","11:00pm","2 sessions a week","30 minutes",["Weekday mornings"],["None"],["Staying consistent"],"Late morning",["I'm not sure yet"]],"unsure":True},
]

async def run(p,pw):
    email=f"e2e-tap-{p['k'].lower()}-{uuid.uuid4().hex[:8]}@plexecute-test.invalid"; pwd="E2e!"+uuid.uuid4().hex
    r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,timeout=30,json={"email":email,"password":pwd,"email_confirm":True,"user_metadata":{"date_of_birth":"1990-05-01"}}); r.raise_for_status(); uid=r.json()["id"]
    b=await pw.chromium.launch(headless=True)
    vp={"width":390,"height":844} if p["mobile"] else {"width":1280,"height":1800}
    ctx=await b.new_context(viewport=vp,timezone_id="Europe/London"); page=await ctx.new_page(); tag=f"[{p['k']}]"
    page.on("pageerror",lambda e: print(tag,"pageerror",str(e)[:200]))
    try:
        await page.goto(f"{BASE}/login",wait_until="networkidle")
        await page.fill("#email",email); await page.fill("#pw",pwd); await page.get_by_role("button",name="Log in").click()
        await page.wait_for_url("**/onboarding**",timeout=30000); await page.wait_for_timeout(1200)
        await page.get_by_role("textbox").first.fill(f"Tester {p['k']}")
        await page.get_by_text("I confirm I am 18 or older").click(); await page.get_by_text("I agree to the").click()
        await page.get_by_role("button",name="Continue").click()
        qn=page.get_by_test_id("onboarding-questionnaire"); await qn.wait_for(timeout=30000)
        t0=time.time()
        for a in p["answers"]:
            if isinstance(a,list):
                for o in a: await qn.get_by_role("button",name=o,exact=True).click()
            else: await qn.get_by_role("button",name=a,exact=True).click()
            await qn.get_by_role("button",name="Next",exact=True).click()
            await page.wait_for_timeout(350)
        await page.get_by_label("Main goal").fill(p["goal"])
        await page.screenshot(path=str(SHOTS/f"{p['k']}_q.png"))
        await page.get_by_role("button",name="Review my answers").click()
        for _ in range(120):
            body=await page.inner_text("body")
            if "Looks right" in body or "sessions placed" in body: break
            await page.wait_for_timeout(1000)
        check(f"{tag} questionnaire reaches review without typing follow-ups","Looks right" in body or "sessions placed" in body,f"{time.time()-t0:.0f}s")
        lr=page.get_by_role("button",name="Looks right")
        if await lr.count():
            if await lr.is_disabled():
                await page.get_by_text("Use sensible defaults I can change").click(); await page.wait_for_timeout(300)
            await lr.click(); await page.wait_for_timeout(1500)
        pt=await page.inner_text("body"); await page.screenshot(path=str(SHOTS/f"{p['k']}_plan.png"))
        check(f"{tag} first plan preview shown","sessions placed" in pt,pt[pt.find("Your first week"):][:160].replace("\n"," | "))
        await page.get_by_role("button",name="Accept and start").click()
        await page.wait_for_url(re.compile(r".*/app/(today|coach).*"),timeout=90000)
        check(f"{tag} accepted -> member app",True,f"{time.time()-t0:.0f}s total")
        gs=rest("goals",f"user_id=eq.{uid}&select=title"); pv=rest("plan_versions",f"user_id=eq.{uid}&select=status")
        bl=rest("plan_blocks",f"user_id=eq.{uid}&select=id"); prof=rest("profiles",f"id=eq.{uid}&select=onboarded")[0]
        check(f"{tag} main goal saved",any(p["goal"].split()[-1].lower() in g["title"].lower() for g in gs),[g["title"] for g in gs])
        check(f"{tag} plan approved and sessions placed",any(v["status"]=="approved" for v in pv) and len(bl)>0,len(bl))
        check(f"{tag} marked onboarded",prof["onboarded"])
        if p["unsure"]:
            vf=[f for f in rest("life_twin_facts",f"user_id=eq.{uid}&select=fact_key,fact_value") if f["fact_key"]=="five_year_vision"]
            check(f"{tag} 'not sure yet' vision kept as unsure, not invented",not vf or not (vf[0]["fact_value"] or {}).get("objectives"),vf[:1])
    finally:
        await b.close(); requests.delete(f"{URL}/auth/v1/admin/users/{uid}",headers=H,timeout=30)

async def main():
    async with async_playwright() as pw:
        for p in P:
            try: await run(p,pw)
            except Exception as e: check(f"[{p['k']}] completed without error",False,repr(e)[:300])
    print(f"\n{sum(results)} of {len(results)} pass"); sys.exit(0 if all(results) else 1)
asyncio.run(main())
