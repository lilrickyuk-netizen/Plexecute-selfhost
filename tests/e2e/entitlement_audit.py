"""Completion item 96: entitlement audit. Calls every paid/free-capped server action directly (bypassing the UI)
as Free, Pro and Execute members and checks the server itself allows or refuses per V3 §5.2-5.5."""
import asyncio, os, uuid, sys, json
import requests
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json","Prefer":"return=representation"}
res=[]
def check(n,ok,d=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ")+n+(f" :: {d}" if d else ""))
def mk(tier):
    e=f"e2e-r96-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"; pw="E2e!"+uuid.uuid4().hex
    r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,timeout=30,json={"email":e,"password":pw,"email_confirm":True,"user_metadata":{"date_of_birth":"1990-05-01"}}); r.raise_for_status(); uid=r.json()["id"]
    requests.patch(f"{URL}/rest/v1/profiles?id=eq.{uid}",headers=H,json={"onboarded":True,"timezone":"Europe/London","display_name":"Ent Tester","wake_time":"06:00","sleep_time":"23:00","work_days":[1,2,3,4,5]},timeout=30).raise_for_status()
    if tier!="free":
        r=requests.patch(f"{URL}/rest/v1/profiles?id=eq.{uid}",headers=H,json={"tier":tier},timeout=30); r.raise_for_status()
    return uid,e,pw
CALL="""async ([mod, fn, data]) => { try { const m = await import(mod); const r = await m[fn]({ data }); return { ok: true, r: JSON.stringify(r ?? null).slice(0,200) }; } catch (e) { return { ok: false, r: String(e && e.message || e).slice(0,200) }; } }"""
EXP={"question":"Does an early walk help focus?","hypothesis":"","metric":"focus","variantA":"Walk","variantB":"No walk","confounders":"","days":28}
SHARE={"name":"Coach Sam","role":"COACH","userAsserted":True,"permissions":["VIEW_SELECTED_PLAN"],"healthConsent":[]}
async def call(page,mod,fn,data=None): return await page.evaluate(CALL,[mod,fn,data])
def refused(r,word): return (not r["ok"]) or ('"ok":false' in r["r"] and word.lower() in r["r"].lower())
async def main():
    users=[]
    async with async_playwright() as p:
        b=await p.chromium.launch(headless=True)
        try:
            for tier in ["free","pro","execute"]:
                uid,e,pw=mk(tier); users.append(uid)
                ctx=await b.new_context(viewport={"width":1280,"height":900}); page=await ctx.new_page()
                await page.goto(BASE+"/login",wait_until="networkidle"); await page.fill("#email",e); await page.fill("#pw",pw)
                await page.get_by_role("button",name="Log in").click(); await page.wait_for_url("**/app/**",timeout=20000)
                await page.goto(BASE+"/app/more",wait_until="networkidle")
                paid=tier!="free"
                # tier itself cannot be self-granted
                r=requests.patch(f"{URL}/rest/v1/profiles?id=eq.{uid}",timeout=30,headers={"apikey":os.environ.get("SUPABASE_PUBLISHABLE_KEY",""),"Authorization":"Bearer x"},json={"tier":"execute"})
                tok=await page.evaluate("async()=>{const m=await import('/src/integrations/supabase/client.ts');const s=(await m.supabase.auth.getSession()).data.session;return s.access_token}")
                pk=os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY")
                requests.patch(f"{URL}/rest/v1/profiles?id=eq.{uid}",timeout=30,headers={"apikey":pk,"Authorization":f"Bearer {tok}","Content-Type":"application/json"},json={"tier":"execute"})
                t=requests.get(f"{URL}/rest/v1/profiles?id=eq.{uid}&select=tier",headers=H,timeout=30).json()[0]["tier"]
                check(f"[{tier}] member cannot change own plan directly", t==tier, t)
                r=await call(page,"/src/lib/experiments.functions.ts","createExperiment",EXP)
                check(f"[{tier}] Personal Experiments {'allowed' if paid else 'refused'} by server", (r["ok"] if paid else refused(r,"Pro")), r["r"])
                r=await call(page,"/src/lib/professional.functions.ts","createShare",SHARE)
                check(f"[{tier}] Professional Connect {'allowed' if paid else 'refused'}", (r["ok"] if paid else refused(r,"Pro")), r["r"])
                r=await call(page,"/src/lib/wearables.functions.ts","startWearableConnect",{"provider":"oura"})
                check(f"[{tier}] fitness tracker connect {'allowed' if paid else 'refused'}", (r["ok"] if paid else refused(r,"Pro")), r["r"])
                r=await call(page,"/src/lib/behaviour.functions.ts","getBehaviourModel")
                check(f"[{tier}] Behaviour Model {'allowed' if paid else 'refused'}", (r["ok"] if paid else refused(r,"Pro")), r["r"])
                r=await call(page,"/src/lib/planning.functions.ts","proposeDayRepair",{"reason":"overran","blockedUntil":None})
                check(f"[{tier}] Recovery Mode {'allowed' if paid else 'refused'}", (r["ok"] if paid else refused(r,"Pro")), r["r"])
                r=await call(page,"/src/lib/planning.functions.ts","proposeRecoveryAdaptation")
                check(f"[{tier}] recovery adaptation {'allowed' if paid else 'refused'}", (r["ok"] if paid else refused(r,"Pro")), r["r"])
                r=await call(page,"/src/lib/calling.functions.ts","callMeNow",{"origin":BASE})
                check(f"[{tier}] call me now: no call placed for free", True if paid else ('"ok":false' in r["r"] or not r["ok"]), r["r"])
                print("   callMeNow", tier, r["r"])
                r=await call(page,"/src/lib/calling.functions.ts","saveExecuteCallPolicy",{"call_morning_enabled":True,"call_morning_time":"07:00","call_due_enabled":True,"call_missed_enabled":True,"call_evening_enabled":False,"call_evening_time":"20:00","call_max_attempts":3})
                check(f"[{tier}] persistent calling {'allowed' if tier=='execute' else 'refused'}", ('"ok":true' in r["r"]) if tier=="execute" else refused(r,"Execute"), r["r"])
                # replans: first plan + 2 replans free; 3rd refused; "system" relabel cannot dodge
                outs=[await call(page,"/src/lib/planning.functions.ts","proposeWeekPlan",{"trigger":t}) for t in ["onboarding","manual","goal_change","manual","system","onboarding"]]
                if paid: check(f"[{tier}] unlimited replans", all(o["ok"] for o in outs), str([o["r"][:60] for o in outs]))
                else:
                    check("[free] first plan + 2 replans allowed", all(o["ok"] for o in outs[:3]), str([o["r"][:80] for o in outs[:3]]))
                    check("[free] 3rd replan in 7 days refused", refused(outs[3],"2 full replans"), outs[3]["r"])
                    check("[free] relabelled 'system' replan refused too", refused(outs[4],"2 full replans"), outs[4]["r"])
                    check("[free] relabelled 'onboarding' replan refused too", refused(outs[5],"2 full replans"), outs[5]["r"])
                # AI food: free 1/day
                f1=await call(page,"/src/lib/nutrition.functions.ts","parseFoodText",{"text":"two boiled eggs"})
                f2=await call(page,"/src/lib/nutrition.functions.ts","parseFoodText",{"text":"one banana"})
                if paid: check(f"[{tier}] AI food logs not capped at 1", f1["ok"] and f2["ok"], f1["r"]+" | "+f2["r"])
                else: check("[free] 1st AI food log allowed, 2nd refused", f1["ok"] and refused(f2,"one AI food log"), f1["r"][:80]+" | "+f2["r"])
                # goals: free max 3 active (DB trigger)
                if not paid:
                    tokh={"apikey":pk,"Authorization":f"Bearer {tok}","Content-Type":"application/json","Prefer":"return=representation"}
                    oks=[requests.post(f"{URL}/rest/v1/goals",headers=tokh,timeout=30,json={"user_id":uid,"title":f"Goal {i}","domain":"fitness","status":"active"}).ok for i in range(4)]
                    check("[free] 4th active goal refused by database", oks==[True,True,True,False], str(oks))
                await ctx.close()
        finally:
            for u in users: requests.delete(f"{URL}/auth/v1/admin/users/{u}",headers=H,timeout=30)
            await b.close()
    print(f"{sum(res)} of {len(res)} pass"); sys.exit(0 if all(res) else 1)
asyncio.run(main())
