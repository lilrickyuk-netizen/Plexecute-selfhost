"""Live: Coach uses the saved 5-year Life Direction (read, prioritise, pathway, edit/remove freshness, not-sure, none)."""
import asyncio, json, os, re, time, uuid, requests
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json","Prefer":"return=representation"}
def get(t,q): r=requests.get(f"{URL}/rest/v1/{t}?{q}",headers=H,timeout=30); r.raise_for_status(); return r.json()
def post(t,b): r=requests.post(f"{URL}/rest/v1/{t}",headers=H,json=b,timeout=30); r.raise_for_status(); return r.json()
OBJ=[("career","Run my own construction company"),("home","Own my own home"),("money","Improve my financial position"),("health","Stay fit"),("family","Spend more protected time with family"),("education","Complete further qualifications")]
async def say(page,uid,q):
    n0=len(get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=id"))
    await page.get_by_placeholder("Tell Coach what you need…").fill(q); await page.get_by_role("button",name="Send").click()
    for _ in range(180):
        await page.wait_for_timeout(1000)
        if len(get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=id"))>n0: break
    await page.wait_for_timeout(1500)
    m=get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=content,tool_trace&order=created_at.desc&limit=1")[0]
    tools=[t.get("tool") for t in (m["tool_trace"] or [])]
    print("Q:",q,"\nTOOLS:",tools,"\nA:",m["content"],"\n",flush=True); return m["content"],tools
async def member(b,kind):
    email=f"e2e-ld-{kind}-{uuid.uuid4().hex[:6]}@plexecute-test.invalid"; pw="E2e!"+uuid.uuid4().hex
    r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,json={"email":email,"password":pw,"email_confirm":True,"user_metadata":{"date_of_birth":"1988-03-01"}}); r.raise_for_status(); uid=r.json()["id"]
    time.sleep(1); requests.patch(f"{URL}/rest/v1/profiles?id=eq.{uid}",headers=H,json={"onboarded":True,"tier":"execute","display_name":"Sam","timezone":"Europe/London","work_days":[1,2,3,4,5],"work_start":"07:30","work_end":"16:30"})
    if kind!="none":
        post("goals",{"user_id":uid,"title":"Save a £3,000 emergency fund","domain":"finance","status":"active","weekly_minutes":30,"session_minutes":30})
        post("goals",{"user_id":uid,"title":"Run three times a week","domain":"training","status":"active","weekly_minutes":90,"session_minutes":30})
        post("goals",{"user_id":uid,"title":"Learn guitar","domain":"learning","status":"active","weekly_minutes":60,"session_minutes":30})
    if kind=="full": val={"summary":"Running my own construction firm, in my own home, fit and with time for family.","objectives":[{"area":a,"text":t} for a,t in OBJ]}
    elif kind=="unsure": val={"summary":None,"objectives":[]}
    else: val=None
    if val is not None: post("life_twin_facts",{"user_id":uid,"domain":"identity","fact_key":"five_year_vision","fact_value":val,"source":"USER_ASSERTED","source_ref":"onboarding","confidence":1,"version":1})
    ctx=await b.new_context(viewport={"width":1280,"height":1800},timezone_id="Europe/London"); page=await ctx.new_page()
    await page.goto(f"{BASE}/login",wait_until="networkidle"); await page.fill("#email",email); await page.fill("#pw",pw)
    await page.get_by_role("button",name="Log in").click(); await page.wait_for_url("**/app/**",timeout=30000)
    return uid,page
async def coach(page): await page.goto(f"{BASE}/app/coach",wait_until="networkidle"); await page.wait_for_timeout(1500)
async def main():
    uids=[]
    async with async_playwright() as pl:
        b=await pl.chromium.launch(headless=True)
        try:
            uid,page=await member(b,"full"); uids.append(uid); await coach(page)
            await say(page,uid,"Where did I say I want my life to be in 5 years?")
            await say(page,uid,"What should I focus on this year if I want to reach my 5-year goals?")
            await say(page,uid,"Help me start working towards running my own company.")
            await say(page,uid,"I'm a qualified bricklayer with 8 years' experience in England. I'd like to have my own company running within 3 years, and I can put aside £300 a month.")
            print("GOALS AFTER 3",json.dumps(get("goals",f"user_id=eq.{uid}&select=title,status")),flush=True)
            await say(page,uid,"What am I doing right now that supports where I want to be in five years?")
            # edit + remove via the real Goals UI
            await page.goto(f"{BASE}/app/goals",wait_until="networkidle"); await page.wait_for_timeout(2000)
            sec=page.locator("section",has_text="Life direction · 5 years")
            await sec.get_by_role("button",name="Edit").click()
            await sec.get_by_label("Objective 2").fill("Own a house with a big garden near the coast")
            await sec.get_by_role("button",name="Remove Complete further qualifications").click()
            await sec.get_by_role("button",name="Save").click(); await page.wait_for_timeout(2500)
            await page.screenshot(path="/tmp/browser/ld/goals_after_edit.png")
            print("FACTS",json.dumps(get("life_twin_facts",f"user_id=eq.{uid}&fact_key=eq.five_year_vision&select=version,valid_until,fact_value&order=version")),flush=True)
            await coach(page)
            await say(page,uid,"I updated my life direction. What did I say about my home now?")
            await say(page,uid,"Is getting further qualifications still part of my 5-year direction?")
            uid2,p2=await member(b,"unsure"); uids.append(uid2); await coach(p2)
            await say(p2,uid2,"Where did I say I want my life to be in 5 years?")
            await say(p2,uid2,"What should I focus on this year?")
            uid3,p3=await member(b,"none"); uids.append(uid3); await coach(p3)
            await say(p3,uid3,"What should I focus on this week?")
            await say(p3,uid3,"Add a dentist appointment next Tuesday at 10am for 45 minutes.")
            print("C3 COMMITS",json.dumps(get("commitments",f"user_id=eq.{uid3}&select=title,on_date,start_time")))
        finally:
            await b.close()
            for u in uids: requests.delete(f"{URL}/auth/v1/admin/users/{u}",headers=H)
if __name__=="__main__": asyncio.run(main())
