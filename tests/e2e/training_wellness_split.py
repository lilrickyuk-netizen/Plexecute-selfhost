"""Two sections: TRAINING (strength, bodyweight, cardio, conditioning) and WELLNESS & MOVEMENT
(yoga, mobility, recovery, meditation, breathing), with Coach routing. Fresh account, removed afterwards."""
import asyncio, os, re, sys, uuid, time
from pathlib import Path
import requests
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json","Prefer":"return=representation"}
SH=Path("/tmp/browser/split"); SH.mkdir(parents=True,exist_ok=True); res=[]
def check(n,ok,d=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ")+n+(f" :: {d}" if d else ""),flush=True)
def get(t,q): r=requests.get(f"{URL}/rest/v1/{t}?{q}",headers=H,timeout=30); r.raise_for_status(); return r.json()
def live(u): return requests.get(f"https://www.youtube.com/oembed?url={u}&format=json",timeout=20).ok
async def coach(page,uid,msg):
    await page.goto(f"{BASE}/app/coach",wait_until="networkidle"); await page.wait_for_timeout(1500)
    n0=len(get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=id"))
    t0=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(time.time()-5))
    await page.get_by_placeholder("Tell Coach what you need…").fill(msg); await page.get_by_role("button",name="Send").click()
    m=[]
    for _ in range(90):
        m=get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=content&order=created_at.desc")
        if len(m)>n0: break
        await page.wait_for_timeout(2000)
    tc=[t["tool"] for t in get("coach_tool_calls",f"user_id=eq.{uid}&created_at=gte.{t0}&select=tool")]
    return (m[0]["content"] if len(m)>n0 else ""),tc
async def demo(page,btn):
    await btn.click(); dlg=page.get_by_role("dialog")
    try: await dlg.get_by_role("link",name="Open on YouTube").wait_for(timeout=90000)
    except Exception: pass
    href=await dlg.get_by_role("link",name="Open on YouTube").get_attribute("href") if await dlg.get_by_role("link",name="Open on YouTube").count() else None
    title=await dlg.locator("p.font-medium").inner_text() if await dlg.locator("p.font-medium").count() else (await dlg.inner_text())[:120]
    await page.keyboard.press("Escape"); await page.wait_for_timeout(300)
    return href,title
async def build(page,goal_label=None,equip_label=None,days="3",mins="45"):
    if goal_label: await page.get_by_role("button",name=goal_label,exact=True).click()
    if equip_label: await page.get_by_role("button",name=equip_label).click()
    await page.get_by_label("Days per week").fill(days); await page.get_by_label("Minutes per session").fill(mins)
    await page.get_by_role("button",name="Create programme").click(); await page.wait_for_timeout(3000)
async def main():
    email=f"e2e-split-{uuid.uuid4().hex[:8]}@plexecute-test.invalid"; pw="E2e!"+uuid.uuid4().hex; uid=None
    async with async_playwright() as p:
        b=await p.chromium.launch(headless=True); page=await (await b.new_context(viewport={"width":412,"height":900},is_mobile=True,timezone_id="Europe/London")).new_page()
        try:
            r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,json={"email":email,"password":pw,"email_confirm":True,"user_metadata":{"date_of_birth":"1990-05-01"}},timeout=30); r.raise_for_status(); uid=r.json()["id"]
            requests.patch(f"{URL}/rest/v1/profiles?id=eq.{uid}",headers=H,json={"onboarded":True,"tier":"pro","timezone":"Europe/London","display_name":"Split Tester"}).raise_for_status()
            await page.goto(f"{BASE}/login",wait_until="networkidle"); await page.fill("#email",email); await page.fill("#pw",pw)
            await page.get_by_role("button",name="Log in").click(); await page.wait_for_url("**/app/**",timeout=20000)
            # Navigation
            await page.goto(f"{BASE}/app/more",wait_until="networkidle"); await page.wait_for_timeout(1000)
            body=await page.inner_text("body")
            check("menu shows exactly two sections","Training (strength, bodyweight, cardio, conditioning)" in body and "Wellness & Movement" in body and "Cardio & activity" not in body and "Yoga & mobility" not in body)
            await page.goto(f"{BASE}/app/movement",wait_until="networkidle"); await page.wait_for_timeout(1500)
            check("old Cardio link opens Training > Cardio","/app/training" in page.url and "section=cardio" in page.url,page.url)
            await page.goto(f"{BASE}/app/movement?tab=mobility",wait_until="networkidle"); await page.wait_for_timeout(1500)
            check("old Mobility link opens Wellness & Movement > Mobility","/app/wellness" in page.url and "section=mobility" in page.url,page.url)
            # 1 STRENGTH
            await page.goto(f"{BASE}/app/training",wait_until="networkidle"); await page.wait_for_timeout(1500)
            tabs=[await t.inner_text() for t in await page.get_by_role("tab").all()]
            check("Training shows Strength, Bodyweight, Cardio, Conditioning, Recovery",[t.split("\n")[0] for t in tabs]==["Strength","Bodyweight","Cardio","Conditioning","Recovery"],str(tabs))
            check("no yoga/mobility on Training","Yoga" not in await page.inner_text("main") if await page.locator("main").count() else "Yoga" not in await page.inner_text("body"))
            await build(page)
            pr=get("training_programmes",f"user_id=eq.{uid}&status=eq.active&select=id,goal,equipment")
            check("1. weights workout generated",pr and pr[0]["goal"]=="strength" and pr[0]["equipment"]=="gym",str(pr))
            # 5-7 open demo, complete session, progress
            await page.get_by_role("button",name="Start").first.click(); await page.wait_for_timeout(2500)
            href,title=await demo(page,page.get_by_role("button",name="Watch demonstration").first)
            check("5. exercise demonstration opens a real video",href and live(href),title)
            secs=page.locator("section",has=page.get_by_role("button",name="Log set"))
            for i in range(await secs.count()):
                sec=secs.nth(i); inp=sec.locator("input")
                if await inp.nth(0).is_enabled(): await inp.nth(0).fill("40")
                await inp.nth(1).fill("8"); await inp.nth(2).fill("2"); await sec.get_by_role("button",name="Log set").click(); await page.wait_for_timeout(600)
            await page.get_by_role("button",name="Finish workout").click(); await page.wait_for_timeout(3500)
            ws=get("workout_sessions",f"user_id=eq.{uid}&select=status")
            check("6. training session completed",ws and ws[0]["status"]=="completed")
            check("7. training progress updated (sets + outcome)",len(get("workout_sets",f"user_id=eq.{uid}&select=id"))>=3 and get("outcome_ledger",f"user_id=eq.{uid}&metric=eq.workout_completed&select=id"))
            # 2 BODYWEIGHT
            await page.get_by_role("tab",name=re.compile("^Bodyweight")).click(); await page.wait_for_timeout(1200)
            await page.get_by_role("button",name="Build a bodyweight programme").click(); await page.wait_for_timeout(800)
            await build(page)
            pr=get("training_programmes",f"user_id=eq.{uid}&status=eq.active&select=id,equipment")
            keys=[x["exercise_key"] for x in get("programme_prescriptions",f"programme_id=eq.{pr[0]['id']}&select=exercise_key")]
            check("2. bodyweight workout generated with bodyweight moves",pr[0]["equipment"]=="bodyweight" and all(k in ("bodyweight_squat","glute_bridge","push_up","pike_push_up","towel_row","split_squat","calf_raise","plank","incline_push_up","box_squat") for k in keys),str(sorted(set(keys))))
            check("history kept after switching",len(get("workout_sessions",f"user_id=eq.{uid}&select=id"))==1)
            # 4 CONDITIONING
            await page.get_by_role("tab",name=re.compile("^Conditioning")).click(); await page.wait_for_timeout(1200)
            await page.get_by_role("button",name="Build a conditioning programme").click(); await page.wait_for_timeout(800)
            await build(page,days="3",mins="30")
            pr=get("training_programmes",f"user_id=eq.{uid}&status=eq.active&select=id,goal")
            rest=[x["rest_sec"] for x in get("programme_prescriptions",f"programme_id=eq.{pr[0]['id']}&select=rest_sec")]
            check("4. conditioning workout generated (short rest)",pr[0]["goal"]=="conditioning" and max(rest)<=75,str(rest))
            # 3 CARDIO
            await page.get_by_role("tab",name=re.compile("^Cardio")).click(); await page.wait_for_timeout(2500)
            await page.get_by_role("button",name="Running",exact=True).click(); await page.wait_for_timeout(1500)
            t=await page.inner_text("body")
            check("3. cardio session prescribed in Training",re.search(r"\d+ min",t) and "active minutes" in t and "Yoga" not in t)
            href,title=await demo(page,page.get_by_role("button",name="Watch demonstration").first)
            check("cardio technique video",href and live(href),title)
            before=int(re.search(r"(\d+)\s+of \d+ active minutes",t).group(1))
            await page.get_by_placeholder(re.compile(r"^\d+$")).first.fill("25")
            await page.get_by_role("button",name=re.compile("Save")).first.click(); await page.wait_for_timeout(3000)
            await page.reload(wait_until="networkidle"); await page.wait_for_timeout(2500)
            after=int(re.search(r"(\d+)\s+of \d+ active minutes",await page.inner_text("body")).group(1))
            ms=get("movement_sessions",f"user_id=eq.{uid}&select=kind,modality,duration_min")
            check("cardio logged and weekly active minutes rose",ms and ms[0]["kind"]=="cardio" and after>before,f"{before}->{after} {ms}")
            await page.screenshot(path=str(SH/"cardio.png"))
            # WELLNESS & MOVEMENT
            await page.goto(f"{BASE}/app/wellness",wait_until="networkidle"); await page.wait_for_timeout(1500)
            tabs=[(await t.inner_text()).split("\n")[0] for t in await page.get_by_role("tab").all()]
            check("Wellness & Movement shows Yoga, Mobility, Recovery, Meditation, Breathing",tabs==["Yoga","Mobility","Recovery","Meditation","Breathing"],str(tabs))
            check("no cardio under Wellness","Running" not in await page.inner_text("body"))
            sec=page.get_by_label("Guided yoga and meditation")
            async def pick(foc,mins):
                await sec.get_by_role("button",name=foc,exact=True).click(); await sec.get_by_role("button",name=f"{mins} min",exact=True).click()
                cards=sec.locator("button:has(img)")
                try: await cards.first.wait_for(timeout=90000)
                except Exception: pass
                return await cards.count()
            n=await pick("Back",15); check("8. Yoga → Back → 15 min gives real choices",n>=2,f"{n}")
            await sec.locator("button:has(img)").first.click(); await page.wait_for_timeout(1500)
            check("13. follow-along video embedded",await sec.locator("iframe[src*='youtube-nocookie.com/embed']").count()==1)
            await sec.get_by_role("button",name="Mark complete").click(); await page.wait_for_timeout(3000)
            ys=get("wellness_sessions",f"user_id=eq.{uid}&activity=eq.yoga&select=id,completion_state")
            check("14. wellness session completed",ys and ys[0]["completion_state"]=="completed")
            # 9 Mobility → Hips → 10
            await page.get_by_role("tab",name=re.compile("^Mobility")).click(); await page.wait_for_timeout(2000)
            await page.get_by_role("button",name="Hips",exact=True).first.click(); await page.get_by_role("button",name="10 min",exact=True).first.click(); await page.wait_for_timeout(2000)
            steps=await page.locator("ol li").count()
            href,title=await demo(page,page.get_by_role("button",name="Watch demonstration").first)
            check("9. Mobility → Hips → 10 min with movement demonstrations",steps>=3 and href and live(href),f"{steps} steps · {title}")
            # 10 Recovery → Lower body → 10
            await page.get_by_role("tab",name=re.compile("^Recovery")).click(); await page.wait_for_timeout(2000)
            sec=page.get_by_label("Guided yoga and meditation")
            n=await pick("Lower body",10); check("10. Recovery → Lower body → 10 min videos + stretching sequence",n>=2 and await page.locator("ol li").count()>=3,f"{n}")
            # 11 Meditation → Relaxation → 10
            await page.get_by_role("tab",name=re.compile("^Meditation")).click(); await page.wait_for_timeout(2000)
            sec=page.get_by_label("Guided yoga and meditation")
            n=await pick("Relaxation",10); check("11. Meditation → Relaxation → 10 min",n>=2,f"{n}")
            # 12 Breathing → Calm → 5
            await page.get_by_role("tab",name=re.compile("^Breathing")).click(); await page.wait_for_timeout(1500)
            await page.get_by_role("button",name="Calm-down breathing").click(); await page.get_by_role("button",name="5 min",exact=True).first.click()
            await page.get_by_role("button",name="Start 5-minute session").click(); await page.wait_for_timeout(4500)
            ph=await page.get_by_test_id("breath-pacer").inner_text()
            await page.get_by_role("button",name="Finish now").click(); await page.wait_for_timeout(2500)
            br=get("wellness_sessions",f"user_id=eq.{uid}&session_type=eq.breath&select=id,focus,completion_state")
            check("12. Breathing → Calm → 5 min timed guidance and saved",ph.strip() in ("Breathe in","Breathe out") and br and br[0]["focus"]=="calm",f"{ph} {br}")
            await page.reload(wait_until="networkidle"); await page.wait_for_timeout(2000)
            check("15. wellness progress/history shows sessions",len(get("wellness_sessions",f"user_id=eq.{uid}&select=id"))>=2 and "History" in await page.inner_text("body"))
            await page.screenshot(path=str(SH/"breathing.png"))
            # COACH routing
            for k,(msg,want,avoid) in enumerate([
                ("Give me an upper-body workout.",{"build_workout"},{"find_guided_videos","get_mobility_session"}),
                ("Give me a bodyweight workout.",{"build_workout"},{"find_guided_videos","get_mobility_session"}),
                ("I want to go running.",{"get_cardio_session"},{"find_guided_videos","get_mobility_session"}),
                ("My back is stiff.",{"get_mobility_session","find_guided_videos"},{"build_workout","get_cardio_session"}),
                ("I want to meditate.",{"find_guided_videos","log_wellness","get_wellness"},{"build_workout","get_cardio_session"}),
            ],16):
                reply,tc=await coach(page,uid,msg)
                check(f"{k}. Coach routes '{msg}'",bool(set(tc)&want) and not (set(tc)&avoid),f"{tc} :: {reply.replace(chr(10),' / ')[:200]}")
        finally:
            await b.close()
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}",headers=H,timeout=30)
    print(f"\n{sum(res)} of {len(res)} pass"); sys.exit(0 if all(res) else 1)
asyncio.run(main())
