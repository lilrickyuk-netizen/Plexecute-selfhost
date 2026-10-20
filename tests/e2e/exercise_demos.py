"""Training exercise demonstrations: optional videos alongside the engine-generated workout."""
import asyncio, os, re, sys, uuid
from pathlib import Path
import requests
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json","Prefer":"return=representation"}
SH=Path("/tmp/browser/demo"); SH.mkdir(parents=True,exist_ok=True); res=[]
def check(n,ok,d=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ")+n+(f" :: {d}" if d else ""))
def get(t,q): r=requests.get(f"{URL}/rest/v1/{t}?{q}",headers=H,timeout=30); r.raise_for_status(); return r.json()
def patch(t,q,b): requests.patch(f"{URL}/rest/v1/{t}?{q}",headers=H,json=b,timeout=30).raise_for_status()
def live(u): return requests.get(f"https://www.youtube.com/oembed?url={u}&format=json",timeout=20).ok
async def workout(page,prog,watch):
    await page.get_by_role("button",name="Start").first.click(); await page.wait_for_timeout(2500)
    secs=page.locator("section",has=page.get_by_role("button",name="Log set"))
    n=await secs.count(); demos=await page.get_by_role("button",name="Watch demonstration").count()
    opened=[]
    if watch:
        for i in range(min(3,n)):
            await secs.nth(i).get_by_role("button",name="Watch demonstration").click()
            dlg=page.get_by_role("dialog"); await dlg.get_by_role("link",name="Open on YouTube").wait_for(timeout=90000)
            opened.append((await dlg.locator("h2").inner_text(), await dlg.get_by_role("link",name="Open on YouTube").get_attribute("href"), await dlg.locator("iframe").count()))
            await page.screenshot(path=str(SH/f"demo{i}.png")); await page.keyboard.press("Escape"); await page.wait_for_timeout(400)
    s=get("workout_sessions","status=eq.in_progress&programme_id=eq."+prog+"&select=day_index")[0]
    rxs=get("programme_prescriptions",f"programme_id=eq.{prog}&day_index=eq.{s['day_index']}&select=sets,rep_max,rir_target,load_kg&order=order_index")
    for i,rx in enumerate(rxs):
        sec=secs.nth(i)
        for k in range(rx["sets"]):
            inp=sec.locator("input")
            if await inp.nth(0).is_enabled(): await inp.nth(0).fill("40")
            await inp.nth(1).fill(str(rx["rep_max"])); await inp.nth(2).fill(str(rx["rir_target"]))
            await sec.get_by_role("button",name="Log set").click(); await page.wait_for_timeout(600)
            if i==0 and k==0 and watch:
                await page.reload(wait_until="networkidle"); await page.wait_for_timeout(2500)
                check("11. refresh mid-workout keeps workout and logged set",await secs.count()==n and await page.get_by_text("Set 1:").count()>=1)
    await page.get_by_role("button",name="Finish workout").click(); await page.wait_for_timeout(3500)
    return n,demos,opened
async def coach(page,uid,msg):
    await page.goto(f"{BASE}/app/coach",wait_until="networkidle"); await page.wait_for_timeout(1500)
    n0=len(get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=id"))
    await page.get_by_placeholder("Tell Coach what you need…").fill(msg); await page.get_by_role("button",name="Send").click()
    for _ in range(90):
        m=get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=content&order=created_at.desc")
        if len(m)>n0: break
        await page.wait_for_timeout(2000)
    tc=[t["tool"] for t in get("coach_tool_calls",f"user_id=eq.{uid}&select=tool&order=created_at.desc&limit=6")]
    return (m[0]["content"] if len(m)>n0 else ""),tc
async def main():
    email=f"e2e-demo-{uuid.uuid4().hex[:8]}@plexecute-test.invalid"; pw="E2e!"+uuid.uuid4().hex; uid=None
    async with async_playwright() as p:
        b=await p.chromium.launch(headless=True); page=await (await b.new_context(viewport={"width":412,"height":900},is_mobile=True)).new_page()
        try:
            r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,json={"email":email,"password":pw,"email_confirm":True,"user_metadata":{"date_of_birth":"1990-05-01"}},timeout=30); r.raise_for_status(); uid=r.json()["id"]
            patch("profiles",f"id=eq.{uid}",{"onboarded":True,"tier":"pro","timezone":"Europe/London","display_name":"Demo Tester"})
            await page.goto(f"{BASE}/login",wait_until="networkidle"); await page.fill("#email",email); await page.fill("#pw",pw)
            await page.get_by_role("button",name="Log in").click(); await page.wait_for_url("**/app/**",timeout=20000)
            await page.goto(f"{BASE}/app/training",wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button",name="Full gym").click()
            await page.get_by_label("Days per week").fill("3"); await page.get_by_label("Minutes per session").fill("45")
            await page.get_by_role("button",name="Create programme").click(); await page.wait_for_timeout(3000)
            prog=get("training_programmes",f"user_id=eq.{uid}&select=id,experience,equipment")[0]
            keys={x["exercise_key"] for x in get("programme_prescriptions",f"programme_id=eq.{prog['id']}&select=exercise_key")}
            cache={c["exercise_key"]:c["candidates"] for c in get("exercise_demo_cache","select=exercise_key,candidates")}
            check("1. beginner gym programme still generated by the engine",prog["experience"]=="novice" and len(keys)>=5,str(keys))
            n,demos,opened=await workout(page,prog["id"],watch=True)
            check("1b. every prescribed exercise offers an optional demonstration",demos==n and n>0,f"{demos}/{n}")
            check("6. opened demonstrations work and show the named exercise",len(opened)==3 and all(live(u) and f for _,u,f in opened),str(opened))
            s=get("workout_sessions",f"user_id=eq.{uid}&select=id,status&order=started_at")
            check("8. watched + completed: normal completion",len(s)==1 and s[0]["status"]=="completed")
            await page.goto(f"{BASE}/app/training",wait_until="networkidle"); await page.wait_for_timeout(1500)
            await workout(page,prog["id"],watch=False)
            s=get("workout_sessions",f"user_id=eq.{uid}&select=id,status&order=started_at")
            check("7. completed without watching works identically",len(s)==2 and all(x["status"]=="completed" for x in s))
            ev=get("progression_events",f"user_id=eq.{uid}&select=id"); led=get("outcome_ledger",f"user_id=eq.{uid}&metric=eq.workout_completed&select=id")
            check("12. completions feed training progress and history (no duplicates)",len(ev)>=1 and len(led)==2,f"ev {len(ev)} ledger {len(led)}")
            nxt=get("workout_sessions",f"user_id=eq.{uid}&select=day_index&order=started_at.desc&limit=1")
            reply,tc=await coach(page,uid,"How do I do exercise 2?")
            names=[e for e in ["squat","bench","row","deadlift","press","pulldown","lunge","split","plank","curl"] if e in reply.lower()]
            check("9. Coach knows the current workout's exercise 2","explain_exercise" in tc and names,reply.replace("\n"," / ")[:350])
            reply,tc=await coach(page,uid,"Show me how to do a Romanian deadlift.")
            u=re.findall(r"https://(?:www\.)?youtube\.com/watch\?v=[\w-]{11}",reply)
            cached=[c["url"] for c in cache.get("romanian_deadlift",[])]
            check("10. Coach explains RDL with the checked demonstration","explain_exercise" in tc and "romanian" in reply.lower() and u and u[0] in cached and live(u[0]),reply.replace("\n"," / ")[:350])
            reply,tc=await coach(page,uid,"Give me a 30-minute upper-body workout.")
            check("Coach builds workouts with the engine, not a video search","build_workout" in tc and "find_guided_videos" not in tc,reply.replace("\n"," / ")[:300])
            await page.screenshot(path=str(SH/"coach.png"))
        finally:
            await b.close()
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}",headers=H,timeout=30)
    print(f"\n{sum(res)} of {len(res)} pass"); sys.exit(0 if all(res) else 1)
asyncio.run(main())
