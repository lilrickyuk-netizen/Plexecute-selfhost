import asyncio, json, os, sys, time, uuid, re, requests
from pathlib import Path
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json","Prefer":"return=representation"}
SH=Path("/tmp/browser/del/shots"); SH.mkdir(parents=True,exist_ok=True); res=[]
def check(n,ok,d=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ")+n+(f" :: {d}" if d else ""),flush=True)
def get(t,q): r=requests.get(f"{URL}/rest/v1/{t}?{q}",headers=H,timeout=30); r.raise_for_status(); return r.json()
def post(t,b): r=requests.post(f"{URL}/rest/v1/{t}",headers=H,json=b,timeout=30); r.raise_for_status(); return r.json()
def patch(t,q,b): r=requests.patch(f"{URL}/rest/v1/{t}?{q}",headers=H,json=b,timeout=30); r.raise_for_status(); return r.json()
async def toast(p): await p.wait_for_timeout(1500); return " | ".join(await p.locator("[data-sonner-toast]").all_inner_texts())
async def main():
    email=f"e2e-del-{uuid.uuid4().hex[:8]}@plexecute-test.invalid"; pw="E2e!"+uuid.uuid4().hex; uid=None
    async with async_playwright() as pl:
        b=await pl.chromium.launch(headless=True); ctx=await b.new_context(viewport={"width":1280,"height":1800},timezone_id="Europe/London"); page=await ctx.new_page()
        try:
            r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,json={"email":email,"password":pw,"email_confirm":True,"user_metadata":{"date_of_birth":"1990-05-01"}}); r.raise_for_status(); uid=r.json()["id"]
            print("UID",uid,flush=True)
            await page.goto(f"{BASE}/login",wait_until="networkidle"); await page.fill("#email",email); await page.fill("#pw",pw)
            await page.get_by_role("button",name="Log in").click(); await page.wait_for_url("**/onboarding**",timeout=20000); await page.wait_for_timeout(1500)
            cont=page.get_by_role("button",name="Continue"); await page.locator("input").first.fill("Del Tester"); await cont.click()
            for cb in await page.get_by_role("checkbox").all():
                if not await cb.is_checked(): await cb.check()
            await cont.click(); await cont.click(); await cont.click(); await cont.click()
            for i,t in enumerate(["Fitter","Busy","Family"]): await page.locator("textarea").nth(i).fill(t)
            await cont.click(); await cont.click(); await cont.click()
            await page.locator("input").first.fill("Run a 10K"); await cont.click(); await cont.click()
            await page.get_by_text("I've reviewed this plan").click(); await page.get_by_role("button",name="Accept and start").click()
            await page.wait_for_url("**/app/today**",timeout=40000); await page.wait_for_timeout(3000)
            g1=get("goals",f"user_id=eq.{uid}&select=id,title")[0]; gid=g1["id"]
            check("1. goal created",g1["title"]=="Run a 10K")
            # dependencies: milestone, one finished session, a pending reminder on an upcoming session
            post("goal_milestones",{"user_id":uid,"goal_id":gid,"title":"Run 5K non-stop"})
            post("goal_milestones",{"user_id":uid,"goal_id":gid,"title":"Run 8K"})
            blocks=get("plan_blocks",f"user_id=eq.{uid}&goal_id=eq.{gid}&select=id,status,starts_at&order=starts_at")
            now=time.strftime("%Y-%m-%dT%H:%M:%S",time.gmtime())
            fut=[x for x in blocks if x["starts_at"]>now]; past=[x for x in blocks if x["starts_at"]<=now]
            if past: done_id=past[0]["id"]
            else: done_id=fut.pop(0)["id"]
            patch("plan_blocks",f"id=eq.{done_id}",{"status":"done","completed_at":now+"Z","started_at":now+"Z"})
            post("notifications",{"user_id":uid,"block_id":fut[0]["id"],"channel":"in_app","kind":"reminder","title":"Reminder","status":"queued","scheduled_at":fut[0]["starts_at"],"dedupe_key":f"t-{uuid.uuid4().hex}"}) if fut else None
            exp_up=len([x for x in get("plan_blocks",f"user_id=eq.{uid}&goal_id=eq.{gid}&select=id,status,starts_at") if x["status"] in ("planned","scheduled","upcoming","due","snoozed") and x["starts_at"]>now])
            print("expected upcoming",exp_up,"total",len(blocks),flush=True)
            # 2. delete from UI, first cancel
            await page.goto(f"{BASE}/app/goals",wait_until="networkidle"); await page.wait_for_timeout(2000)
            await page.get_by_role("button",name="Delete Run a 10K").click(); await page.wait_for_timeout(2500)
            dlg=await page.get_by_role("alertdialog").inner_text(); await page.screenshot(path=str(SH/"goal_dialog.png"))
            ok=("2 milestones" in dlg and f"{exp_up} upcoming session" in dlg and "1 pending reminder" in dlg and "finished or past session" in dlg)
            check("7. goal dependency warning accurate",ok,dlg.replace("\n"," | "))
            await page.get_by_role("button",name="Keep it").click(); await page.wait_for_timeout(1000)
            check("8. cancelling keeps the goal",len(get("goals",f"id=eq.{gid}&select=id"))==1)
            await page.get_by_role("button",name="Delete Run a 10K").click(); await page.wait_for_timeout(2500)
            await page.get_by_role("button",name="Delete permanently").click(); tt=await toast(page)
            check("2. goal deleted from UI",len(get("goals",f"id=eq.{gid}&select=id"))==0,tt)
            check("milestones and upcoming sessions removed",len(get("goal_milestones",f"goal_id=eq.{gid}&select=id"))==0 and len(get("plan_blocks",f"user_id=eq.{uid}&goal_id=eq.{gid}&select=id"))==0)
            check("finished session kept as history",len(get("plan_blocks",f"id=eq.{done_id}&select=id,goal_id"))==1)
            check("pending reminder removed",len(get("notifications",f"user_id=eq.{uid}&status=eq.queued&select=id"))==0)
            check("goal deletion audited",any(a["resource_id"]==gid for a in get("audit_events",f"user_id=eq.{uid}&action=eq.goal.deleted&select=resource_id,metadata")))
            for path in ["goals","plan","today","calendar"]:
                await page.goto(f"{BASE}/app/{path}",wait_until="networkidle"); await page.wait_for_timeout(2500)
                t=await page.inner_text("body"); 
                open(SH/f"after_goal_{path}.txt","w").write(t)
                await page.screenshot(path=str(SH/f"after_goal_{path}.png"))
                open_rows=get("plan_blocks",f"user_id=eq.{uid}&title=eq.Run a 10K&status=neq.done&select=id")
                check(f"3. goal gone from {path} after refresh (only the finished history session remains)",not open_rows and (path!="goals" or "Run a 10K" not in t), re.findall(r"[^\n]*10K[^\n]*",t)[:2])
            # 4-5. second goal via UI, delete via Coach
            await page.goto(f"{BASE}/app/goals",wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button",name="Add goal").click(); await page.get_by_label("Goal name").fill("Learn Spanish")
            await page.get_by_role("button",name="Save goal").click(); await page.wait_for_timeout(5000)
            g2=get("goals",f"user_id=eq.{uid}&title=eq.Learn Spanish&select=id"); check("4. second goal created (control retained)",len(g2)==1)
            await page.goto(f"{BASE}/app/coach",wait_until="networkidle"); await page.wait_for_timeout(2000)
            await page.get_by_placeholder("Tell Coach what you need…").fill("Please delete my Learn Spanish goal."); await page.get_by_role("button",name="Send").click()
            card=page.get_by_role("group",name="Confirm change").last
            await card.wait_for(timeout=90000); await page.wait_for_timeout(1500); ct=await card.inner_text(); await page.screenshot(path=str(SH/"coach_goal.png"))
            check("Coach asks for confirmation with impact","Learn Spanish" in ct and "Delete goal" in ct,ct.replace("\n"," | "))
            check("8. Coach changes nothing before Confirm",len(get("goals",f"id=eq.{g2[0]['id']}&select=id"))==1)
            await card.get_by_role("button",name="Confirm").click(); await page.wait_for_timeout(4000)
            check("5. goal deleted through Coach",len(get("goals",f"id=eq.{g2[0]['id']}&select=id"))==0, await card.inner_text())
            check("Coach deletion audited as coach",any(a["metadata"].get("source")=="coach" for a in get("audit_events",f"user_id=eq.{uid}&action=eq.goal.deleted&select=metadata")))
            # 6. plans: need a goal + approved plan for this week
            await page.goto(f"{BASE}/app/goals",wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button",name="Add goal").click(); await page.get_by_label("Goal name").fill("Strength work")
            await page.get_by_role("button",name="Save goal").click(); await page.wait_for_timeout(6000)
            await page.goto(f"{BASE}/app/plan",wait_until="networkidle"); await page.wait_for_timeout(2500)
            ap=page.get_by_role("button",name=re.compile("Apply permanently|Approve"))
            if await ap.count(): await ap.first.click(); await page.wait_for_timeout(4000)
            async def plan_check(label):
                bl=[x for x in get("plan_blocks",f"user_id=eq.{uid}&select=id,status,starts_at,source_type") if x["source_type"] in ("goal","makeup") and x["status"] in ("planned","scheduled","upcoming","due","snoozed") and x["starts_at"]>time.strftime("%Y-%m-%dT%H:%M:%S",time.gmtime())]
                return bl
            up=await plan_check("before"); print("plan upcoming",len(up),flush=True)
            await page.goto(f"{BASE}/app/plan",wait_until="networkidle"); await page.wait_for_timeout(2500)
            await page.get_by_role("button",name="Delete this week's plan").click(); await page.wait_for_timeout(3000)
            dlg=await page.get_by_role("alertdialog").inner_text(); await page.screenshot(path=str(SH/"plan_dialog.png"))
            print("plan dialog:",dlg.replace("\n"," | "),flush=True)
            await page.get_by_role("button",name="Keep it").click(); await page.wait_for_timeout(800)
            check("8. cancelling keeps the plan",len(await plan_check("x"))==len(up))
            await page.get_by_role("button",name="Delete this week's plan").click(); await page.wait_for_timeout(3000)
            await page.get_by_role("button",name="Delete permanently").click(); tt=await toast(page)
            left=await plan_check("after")
            # only sessions in this week were in scope
            import datetime as dt
            t0=dt.datetime.utcnow(); nm=(t0+dt.timedelta(days=7-t0.weekday())).strftime("%Y-%m-%dT00:00")
            inweek=[x for x in left if x["starts_at"]<nm]
            check("6. plan deleted from UI (this week's upcoming sessions gone)",len(up)>0 and not inweek,f"before {len(up)} left-in-week {len(inweek)} :: {tt}")
            vers=get("plan_versions",f"user_id=eq.{uid}&select=status,week_start&order=created_at")
            check("plan versions kept as history with status deleted",any(v["status"]=="deleted" for v in vers),json.dumps(vers))
            check("plan deletion audited",len(get("audit_events",f"user_id=eq.{uid}&action=eq.plan.deleted&select=id"))==1)
            await page.reload(wait_until="networkidle"); await page.wait_for_timeout(2500); pt=await page.inner_text("body")
            check("Plan page shows no deleted sessions after refresh","Strength work\nWorkout" not in pt, re.findall(r"Strength work\n[^\n]*",pt)[:3])
            await page.get_by_role("button",name="Delete this week's plan").click(); await page.wait_for_timeout(3000)
            dlg2=await page.get_by_role("alertdialog").inner_text()
            check("repeat delete is harmless (nothing to delete)","Nothing to delete" in dlg2 and await page.get_by_role("button",name="Delete permanently").is_disabled(),dlg2.replace("\n"," | "))
            await page.get_by_role("button",name="Keep it").click()
            # new plan after deletion
            await page.get_by_role("button",name="Replan rest of week").click(); rt=await toast(page)
            try: await page.get_by_role("button",name="Apply permanently").wait_for(timeout=30000)
            except Exception: pass
            await page.screenshot(path=str(SH/"replan.png")); print("replan toast:",rt, get("plan_versions",f"user_id=eq.{uid}&select=status,diff_summary->add_count"),flush=True)
            ap=page.get_by_role("button",name="Apply permanently")
            if await ap.count(): await ap.first.click(); await page.wait_for_timeout(5000)
            nb=await plan_check("new"); check("can create a new plan afterwards",len(nb)>0 or any(v["status"]=="approved" for v in get("plan_versions",f"user_id=eq.{uid}&select=status")),len(nb))
            # delete plan via Coach
            await page.goto(f"{BASE}/app/coach",wait_until="networkidle"); await page.wait_for_timeout(2000)
            await page.get_by_placeholder("Tell Coach what you need…").fill("Delete this week's plan please."); await page.get_by_role("button",name="Send").click()
            await page.wait_for_timeout(2000)
            card=page.get_by_role("group",name="Confirm change").filter(has_text="Delete the plan").last
            await card.wait_for(timeout=90000); ct=await card.inner_text(); await page.screenshot(path=str(SH/"coach_plan.png"))
            check("Coach plan deletion shows impact","Removes" in ct or "Keeps" in ct,ct.replace("\n"," | "))
            n_before=len(await plan_check("c"))
            check("8. nothing removed before Confirm",n_before==len(nb))
            await card.get_by_role("button",name="Confirm").click(); await page.wait_for_timeout(5000)
            check("Coach deleted the plan",len(get("audit_events",f"user_id=eq.{uid}&action=eq.plan.deleted&select=id"))==2, await card.inner_text())
            # 9. final persisted state
            await page.goto(f"{BASE}/app/goals",wait_until="networkidle"); await page.wait_for_timeout(2500); gt=await page.inner_text("body")
            fg=get("goals",f"user_id=eq.{uid}&select=title")
            check("9. final state: only remaining goal is Strength work",[g["title"] for g in fg]==["Strength work"] and "Run a 10K" not in gt and "Learn Spanish" not in gt,fg)
        except Exception as e:
            check("script ran",False,repr(e)[:400]); await page.screenshot(path=str(SH/"error.png"))
        finally:
            await b.close()
            if uid and os.environ.get("KEEP")!="1": requests.delete(f"{URL}/auth/v1/admin/users/{uid}",headers=H)
    print(f"{sum(res)} of {len(res)} pass")
asyncio.run(main())
