import asyncio, json, os, re, time, uuid, requests, datetime as D
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json","Prefer":"return=representation"}
def get(t,q): r=requests.get(f"{URL}/rest/v1/{t}?{q}",headers=H,timeout=30); r.raise_for_status(); return r.json()
async def say(page,uid,q):
    n0=len(get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=id"))
    await page.get_by_placeholder("Tell Coach what you need…").fill(q); await page.get_by_role("button",name="Send").click()
    for _ in range(200):
        await page.wait_for_timeout(1000)
        if len(get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=id"))>n0: break
    m=get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=content,tool_trace&order=created_at.desc&limit=1")[0]
    print("Q:",q,"\nTOOLS:",[t["tool"] for t in m["tool_trace"] or []],"\nA:",m["content"],"\n",flush=True)
async def main():
    email=f"e2e-est-{uuid.uuid4().hex[:8]}@plexecute-test.invalid"; pw="E2e!"+uuid.uuid4().hex; uid=None
    async with async_playwright() as pl:
        b=await pl.chromium.launch(headless=True); ctx=await b.new_context(viewport={"width":1280,"height":1800},timezone_id="Europe/London"); page=await ctx.new_page()
        try:
            r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,json={"email":email,"password":pw,"email_confirm":True,"user_metadata":{"date_of_birth":"1990-05-01"}}); r.raise_for_status(); uid=r.json()["id"]
            time.sleep(1); requests.patch(f"{URL}/rest/v1/profiles?id=eq.{uid}",headers=H,json={"onboarded":True,"tier":"pro","display_name":"Est","timezone":"Europe/London"})
            g=requests.post(f"{URL}/rest/v1/goals",headers=H,json={"user_id":uid,"title":"Get stronger","domain":"training","status":"active","weekly_minutes":180,"session_minutes":60}).json()[0]
            now=D.datetime.now(D.timezone.utc); bl=[]
            for d in [2,4,6,9,11]:
                t=(now-D.timedelta(days=d)).replace(hour=17,minute=30,second=0,microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
                bl.append({"user_id":uid,"goal_id":g["id"],"title":"Gym: strength","domain":"training","duration_min":60,"starts_at":t,"status":"done" if d==9 else "expired","completed_at":t if d==9 else None})
            for d in [1,3,5]:
                t=(now+D.timedelta(days=d)).replace(hour=17,minute=30,second=0,microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
                bl.append({"user_id":uid,"goal_id":g["id"],"title":"Gym: strength","domain":"training","duration_min":60,"starts_at":t,"status":"planned","completed_at":None})
            requests.post(f"{URL}/rest/v1/plan_blocks",headers=H,json=bl).raise_for_status()
            await page.goto(f"{BASE}/login",wait_until="networkidle"); await page.fill("#email",email); await page.fill("#pw",pw)
            await page.get_by_role("button",name="Log in").click(); await page.wait_for_url("**/app/**",timeout=30000)
            await page.goto(f"{BASE}/app/coach",wait_until="networkidle"); await page.wait_for_timeout(1500)
            print("BEFORE",json.dumps(get("plan_blocks",f"user_id=eq.{uid}&status=eq.planned&select=starts_at,plan_version_id")),flush=True)
            await say(page,uid,"I keep missing my gym sessions.")
            await say(page,uid,"Yes, move the upcoming ones to 7am before work please.")
            await page.wait_for_timeout(1500)
            print("BEFORE APPROVE",json.dumps(get("plan_blocks",f"user_id=eq.{uid}&status=eq.planned&select=starts_at,plan_version_id")),flush=True)
            card=page.get_by_role("group",name="Confirm change")
            if await card.count():
                print("CARD",(await card.last.inner_text()).replace("\n"," | "))
                await card.last.get_by_role("button",name=re.compile("Confirm|Approve")).click(); await page.wait_for_timeout(8000)
            print("AFTER",json.dumps(get("plan_blocks",f"user_id=eq.{uid}&status=in.(planned,rescheduled)&select=starts_at,status,plan_version_id,source_type&order=starts_at")))
            print("PV",json.dumps(get("plan_versions",f"user_id=eq.{uid}&select=id,version,status,trigger,explanation")))
        finally:
            await b.close()
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}",headers=H)
asyncio.run(main())
