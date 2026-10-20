import asyncio, os, re, time, uuid, requests
from pathlib import Path
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json","Prefer":"return=representation"}
SH=Path("/tmp/browser/gv/shots"); SH.mkdir(parents=True,exist_ok=True); res=[]
def check(n,ok,d=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ")+n+(f" :: {d}" if d else ""),flush=True)
def get(t,q): r=requests.get(f"{URL}/rest/v1/{t}?{q}",headers=H,timeout=30); r.raise_for_status(); return r.json()
def post(t,b): r=requests.post(f"{URL}/rest/v1/{t}",headers=H,json=b,timeout=30); r.raise_for_status(); return r.json()
def patch(t,q,b): r=requests.patch(f"{URL}/rest/v1/{t}?{q}",headers=H,json=b,timeout=30); r.raise_for_status(); return r.json()
def live(url):
    o=requests.get("https://www.youtube.com/oembed",params={"url":url,"format":"json"},timeout=20)
    return o.ok and o.json().get("title")
COMBOS=[("Yoga","Back",10),("Yoga","Full body",20),("Yoga","Upper body",15),("Yoga","Mobility",10),("Yoga","Beginner yoga",30),
        ("Meditation","Relaxation",10),("Meditation","Focus",5),("Meditation","Sleep",20),("Meditation","Motivation",10),("Meditation","Mindfulness",15)]
FOCUS_WORDS={"Back":r"back|spine","Full body":r"full|total|whole|body|beginner|everyday|daily","Upper body":r"upper|shoulder|arm|chest|spine|neck","Mobility":r"mobil|joint|stiff","Beginner yoga":r"beginner|basic|easy|gentle|first",
  "Relaxation":r"relax|calm|peace|unwind|rest","Focus":r"focus|concentr|clarity|productiv|study|work","Sleep":r"sleep|bed|night","Motivation":r"motivat|energ|inspir|drive|positive|uplift|goal","Mindfulness":r"mindful|present|aware|breath|body scan"}
async def main():
    email=f"e2e-gv-{uuid.uuid4().hex[:8]}@plexecute-test.invalid"; pw="E2e!"+uuid.uuid4().hex; uid=None
    async with async_playwright() as pl:
        b=await pl.chromium.launch(headless=True); ctx=await b.new_context(viewport={"width":412,"height":900},timezone_id="Europe/London",is_mobile=True,has_touch=True); page=await ctx.new_page()
        try:
            r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,json={"email":email,"password":pw,"email_confirm":True,"user_metadata":{"date_of_birth":"1990-05-01"}}); r.raise_for_status(); uid=r.json()["id"]
            patch("profiles",f"id=eq.{uid}",{"onboarded":True,"tier":"pro","timezone":"Europe/London"})
            await page.goto(f"{BASE}/login",wait_until="networkidle"); await page.fill("#email",email); await page.fill("#pw",pw)
            await page.get_by_role("button",name="Log in").click(); await page.wait_for_url("**/app/**",timeout=30000)
            sec=page.get_by_role("region",name="Guided yoga and meditation")
            for i,(act,foc,mins) in enumerate(COMBOS,1):
                # Yoga and Meditation are their own Wellness & Movement sections now.
                await page.goto(f"{BASE}/app/wellness?section={act.lower()}",wait_until="networkidle"); await page.wait_for_timeout(800)
                await sec.get_by_role("button",name=foc,exact=True).click()
                await sec.get_by_role("button",name=f"{mins} min",exact=True).click()
                cards=sec.locator("button:has(img)")
                try: await cards.first.wait_for(timeout=90000)
                except Exception: pass
                n=await cards.count(); txt=[await cards.nth(k).inner_text() for k in range(n)]
                await page.screenshot(path=str(SH/f"combo{i}.png"))
                lens=[int(re.search(r"(\d+) min · YouTube",t).group(1)) for t in txt]
                fits=all(max(1.5,mins*0.65)-0.5<=l<=mins*1.2+1.5 for l in lens)
                topical=all(re.search(FOCUS_WORDS[foc],t.split("\n")[0],re.I) for t in txt) if foc!="Full body" else True
                check(f"{i}. {act} → {foc} → {mins} min: {n} real choices, right length and topic", n>=2 and fits and topical, " || ".join(t.replace("\n"," / ") for t in txt))
            cache=get("guided_video_cache","select=key,candidates")
            urls=[]
            for c in cache:
                if c["key"] in ("yoga:back:10","meditation:relaxation:10"): urls+= [x["url"] for x in c["candidates"][:3]]
            okl=[bool(live(u)) for u in urls]
            check("15. recommended links open and point to the video",urls and all(okl),f"{sum(okl)}/{len(urls)}")
            # cached: second run of the same combo is served without a new search
            before=len(get("usage_events",f"user_id=eq.{uid}&feature=eq.wellness_videos&select=id"))
            await page.goto(f"{BASE}/app/wellness?activity=yoga&focus=back&minutes=10",wait_until="networkidle"); await sec.locator("button:has(img)").first.wait_for(timeout=60000)
            after=len(get("usage_events",f"user_id=eq.{uid}&feature=eq.wellness_videos&select=id"))
            check("14. repeated combination served from cache (no extra search)",after==before,f"{before}->{after}")
            # pick, complete, feedback, double tap
            await sec.locator("button:has(img)").first.click(); await page.wait_for_timeout(1500)
            check("embedded original player shown",await sec.locator("iframe[src*='youtube-nocookie.com/embed']").count()==1)
            mc=sec.get_by_role("button",name="Mark complete"); await mc.dblclick(); await page.wait_for_timeout(3000)
            rows=get("wellness_sessions",f"user_id=eq.{uid}&select=id,activity,focus,video,completion_state,planned_minutes")
            check("completion recorded once with activity, focus, video, duration",len(rows)==1 and rows[0]["activity"]=="yoga" and rows[0]["focus"]=="back" and rows[0]["video"]["url"].startswith("https://www.youtube.com/watch") and rows[0]["planned_minutes"]==10,str(rows))
            await sec.get_by_role("button",name="Not for me").click(); await page.wait_for_timeout(1500)
            check("feedback saved",get("wellness_sessions",f"id=eq.{rows[0]['id']}&select=feedback")[0]["feedback"]=="not_for_me")
            await page.goto(f"{BASE}/app/wellness?activity=yoga&focus=back&minutes=10",wait_until="networkidle"); await sec.locator("button:has(img)").first.wait_for(timeout=60000)
            t2=await sec.inner_text()
            check("disliked video no longer suggested",rows[0]["video"]["title"] not in t2)
            # planning: add practice from UI, then scheduled blocks open directly
            await page.goto(f"{BASE}/app/wellness?activity=meditation&focus=relaxation&minutes=10",wait_until="networkidle"); await sec.locator("button:has(img)").first.wait_for(timeout=60000)
            await sec.get_by_role("button",name="Make this a regular part of my plan").click(); await sec.get_by_label("Time of day").select_option("morning")
            await sec.get_by_role("button",name="Add to plan").click(); await page.wait_for_timeout(2500)
            g=get("goals",f"user_id=eq.{uid}&domain=eq.wellness&select=id,title,session_minutes,preferred_time")
            check("13a. meditation added to plan as a real goal",any(x["title"]=="Meditation: Relaxation · 10 min" and x["preferred_time"]=="morning" for x in g),str(g))
            # planner run
            await page.goto(f"{BASE}/app/plan",wait_until="networkidle"); await page.wait_for_timeout(2000)
            gid=[x for x in g if x["title"].startswith("Meditation:")][0]["id"]
            yg=post("goals",{"user_id":uid,"title":"Yoga: Back · 15 min","domain":"wellness","weekly_minutes":45,"session_minutes":15,"priority":3,"status":"active","preferred_time":"evening"})[0]
            soon=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(time.time()+600))
            mb=post("plan_blocks",{"user_id":uid,"goal_id":gid,"title":"Meditation: Relaxation · 10 min","domain":"wellness","starts_at":soon,"duration_min":10,"status":"planned","occurrence_kind":"meditation","source_type":"goal"})[0]
            yb=post("plan_blocks",{"user_id":uid,"goal_id":yg["id"],"title":"Yoga: Back · 15 min","domain":"wellness","starts_at":soon,"duration_min":15,"status":"planned","occurrence_kind":"meditation","source_type":"goal","source_ref":"y"})[0]
            await page.goto(f"{BASE}/app/today",wait_until="networkidle"); await page.wait_for_timeout(2500)
            await page.screenshot(path=str(SH/"today.png"))
            await page.goto(f"{BASE}/app/wellness?block={mb['id']}",wait_until="networkidle"); await sec.locator("button:has(img)").first.wait_for(timeout=60000)
            h=await sec.inner_text()
            check("13. scheduled meditation opens straight on matching choices","Meditation · Relaxation · 10 min" in h and "from your plan" in h.lower(),h[:120])
            await page.goto(f"{BASE}/app/wellness?block={yb['id']}",wait_until="networkidle"); await sec.locator("button:has(img)").first.wait_for(timeout=90000)
            h=await sec.inner_text(); check("scheduled yoga opens on Yoga · Back · 15 min","Yoga · Back · 15 min" in h,h[:120])
            await sec.locator("button:has(img)").first.click(); await sec.get_by_role("button",name="Mark complete").click(); await page.wait_for_timeout(3500)
            blk=get("plan_blocks",f"id=eq.{yb['id']}&select=status"); ev=get("plan_block_events",f"block_id=eq.{yb['id']}&select=event_type")
            ws=get("wellness_sessions",f"block_id=eq.{yb['id']}&select=id")
            check("14. yoga completion enters execution history (block done + event + session)",blk[0]["status"]=="done" and any(e["event_type"]=="completed" for e in ev) and len(ws)==1,f"{blk} {ev}")
            await page.reload(wait_until="networkidle"); await page.wait_for_timeout(2500)
            check("refresh keeps completed sessions",len(get("wellness_sessions",f"user_id=eq.{uid}&completion_state=eq.completed&select=id"))==2)
            # existing scripted session still works
            await page.goto(f"{BASE}/app/wellness?section=meditation",wait_until="networkidle"); await page.wait_for_timeout(1500)
            check("existing guided script and settings still present",await page.get_by_role("button",name="Start session").count()==1 and await page.get_by_text("Your wellness settings").count()==1)
            # Coach
            for k,(msg,act) in enumerate([("I've got 15 minutes and want yoga for my back.","yoga"),("Give me a 10-minute meditation to relax.","meditation")],11):
                await page.goto(f"{BASE}/app/coach",wait_until="networkidle"); await page.wait_for_timeout(1500)
                n0=len(get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=id"))
                await page.get_by_placeholder("Tell Coach what you need…").fill(msg); await page.get_by_role("button",name="Send").click()
                for _ in range(90):
                    m=get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=content&order=created_at.desc")
                    if len(m)>n0: break
                    await page.wait_for_timeout(2000)
                await page.wait_for_timeout(2500); reply=m[0]["content"] if len(m)>n0 else ""
                await page.screenshot(path=str(SH/f"coach{k}.png"))
                tc=get("coach_tool_calls",f"user_id=eq.{uid}&select=tool&order=created_at.desc&limit=5")
                link=await page.get_by_role("link",name=f"Open {act} choices").count()
                yturls=re.findall(r"https://www\.youtube\.com/watch\?v=[\w-]{11}",reply)
                check(f"{k}. Coach gives real {act} choices",any(t["tool"]=="find_guided_videos" for t in tc) and link>0 and (len(yturls)>=1 and all(live(u) for u in yturls[:3]) or len(re.findall(r"\d+ ?min",reply))>=2),reply.replace("\n"," / ")[:400])
                if k==11 and link:
                    await page.get_by_role("link",name="Open yoga choices").last.click(); await page.wait_for_timeout(2000)
                    await sec.locator("button:has(img)").first.wait_for(timeout=60000)
                    check("Coach link opens the same choices in Wellness","Yoga · Back · 15 min" in await sec.inner_text())
        finally:
            await b.close()
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}",headers=H)
    print(f"{sum(res)}/{len(res)} passed")
asyncio.run(main())
