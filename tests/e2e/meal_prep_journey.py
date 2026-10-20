"""Nutrition meal prep: voice/photo/text inventory -> 7-day plan -> edit -> accept -> log -> Coach questions."""
import asyncio, os, re, sys, uuid, json
from datetime import datetime, timedelta
from pathlib import Path
import requests
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json","Prefer":"return=representation"}
SH=Path("/tmp/browser/mp"); FX=Path(__file__).parent/"fixtures"; SH.mkdir(parents=True,exist_ok=True); WAV=str(FX/"voice.wav"); PHOTO=str(FX/"groceries.jpg"); res=[]
def check(n,ok,d=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ")+n+(f" :: {d}" if d else ""), flush=True)
def get(t,q): r=requests.get(f"{URL}/rest/v1/{t}?{q}",headers=H,timeout=30); r.raise_for_status(); return r.json()
TZ="Europe/London"; TODAY=datetime.now().astimezone().strftime("%Y-%m-%d")
async def coach(page,uid,msg):
    await page.goto(f"{BASE}/app/coach",wait_until="networkidle"); await page.wait_for_timeout(1500)
    n0=len(get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=id"))
    await page.get_by_placeholder("Tell Coach what you need…").fill(msg); await page.get_by_role("button",name="Send").click()
    m=[]
    for _ in range(90):
        m=get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=content&order=created_at.desc")
        if len(m)>n0: break
        await page.wait_for_timeout(2000)
    tc=[t["tool"] for t in get("coach_tool_calls",f"user_id=eq.{uid}&select=tool&order=created_at.desc&limit=6")]
    return (m[0]["content"] if len(m)>n0 else ""),tc
def plan_row(uid,status=None):
    q=f"user_id=eq.{uid}&policy_version=eq.meal-prep-1.0.0&select=id,status,plan&order=created_at.desc"+(f"&status=eq.{status}" if status else "&status=in.(proposed,approved)")
    r=get("meal_plans",q); return r[0] if r else None
async def main():
    email=f"e2e-mp-{uuid.uuid4().hex[:8]}@plexecute-test.invalid"; pw="E2e!"+uuid.uuid4().hex; uid=None
    async with async_playwright() as p:
        b=await p.chromium.launch(headless=True,args=["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream",f"--use-file-for-fake-audio-capture={WAV}%noloop"])
        ctx=await b.new_context(viewport={"width":412,"height":900},is_mobile=True,timezone_id=TZ,permissions=["microphone"]); page=await ctx.new_page()
        try:
            r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,json={"email":email,"password":pw,"email_confirm":True,"user_metadata":{"date_of_birth":"1990-05-01"}},timeout=30); r.raise_for_status(); uid=r.json()["id"]
            requests.patch(f"{URL}/rest/v1/profiles?id=eq.{uid}",headers=H,json={"onboarded":True,"tier":"pro","timezone":TZ,"display_name":"Prep Tester"}).raise_for_status()
            requests.post(f"{URL}/rest/v1/nutrition_targets",headers=H,json={"user_id":uid,"kcal":2200,"protein_g":160,"carbs_g":240,"fat_g":70,"tdee":2600,"confidence":"medium","explanation":"test targets","inputs":{},"method":"formula","status":"applied"}).raise_for_status()
            await page.goto(f"{BASE}/login",wait_until="networkidle"); await page.fill("#email",email); await page.fill("#pw",pw)
            await page.get_by_role("button",name="Log in").click(); await page.wait_for_url("**/app/**",timeout=20000)
            await page.goto(f"{BASE}/app/nutrition",wait_until="networkidle"); await page.get_by_role("tab", name="Meal prep", exact=True).click(); await page.wait_for_timeout(2500)
            # 1-3 VOICE -> structured inventory, quantities needing clarification, confirm
            box=page.get_by_label("Foods you have")
            await page.get_by_label("Say what food you have", exact=True).click(); await page.wait_for_timeout(15000)
            await page.get_by_role("button",name=re.compile("Stop recording")).click()
            for _ in range(60):
                if (await box.input_value()).strip(): break
                await page.wait_for_timeout(1000)
            said=await box.input_value(); check("voice transcribed into the food box",len(said)>20,said[:160])
            await page.get_by_role("button",name="Add foods").click(); await page.wait_for_timeout(3000)
            await page.get_by_role("button",name="Add foods").click(force=True) if await page.get_by_role("button",name="Add foods").is_enabled() else None
            inv=get("food_inventory",f"user_id=eq.{uid}&status=eq.active&select=name,food_key,grams,quantity_status,source")
            keys={i["food_key"] for i in inv}
            check("1. foods structured from speech",{"chicken_breast","eggs","rice","potatoes","oats","greek_yoghurt"}<=keys and all(i["source"]=="voice" for i in inv),str([(i["name"],i["grams"],i["quantity_status"]) for i in inv]))
            check("1b. no duplicate rows from a second tap",len(inv)==len(keys))
            unk=[i["name"] for i in inv if i["quantity_status"]=="unknown"]
            check("2. vague amounts flagged, not invented",len(unk)>=3 and await page.get_by_text("Add amounts for").count()==1,str(unk))
            await page.get_by_label("Potatoes grams").fill("2000"); await page.get_by_label("Potatoes grams").blur(); await page.wait_for_timeout(1500)
            await page.get_by_role("button",name="Use as needed and confirm").click(); await page.wait_for_timeout(2000)
            inv=get("food_inventory",f"user_id=eq.{uid}&status=eq.active&select=name,grams,quantity_status,confirmed_at")
            check("3. member corrects and confirms inventory",all(i["confirmed_at"] for i in inv) and any(i["name"]=="Potatoes" and float(i["grams"])==2000 and i["quantity_status"]=="confirmed" for i in inv))
            # 4-10 PLAN (start today so meals can be logged)
            await page.get_by_label("Plan start").fill(TODAY)
            await page.get_by_role("button",name="Plan my meals").click(); await page.wait_for_timeout(4000)
            await page.screenshot(path=str(SH/"plan.png"))
            row=plan_row(uid); pl=row["plan"] if row else {"days":[]}
            check("4. complete 7-day plan generated",row and len(pl["days"])==7 and all(len(d["meals"])==4 for d in pl["days"]))
            check("5. calories on every meal",all(m["kcal"]>0 for d in pl["days"] for m in d["meals"]) and await page.get_by_test_id("plan-meal").count()==4)
            check("6. macros shown",await page.get_by_text(re.compile(r"P\d+ C\d+ F\d+")).count()>=4)
            dev=[abs(d["totals"]["kcal"]-2200)/2200 for d in pl["days"]]
            check("7. daily totals near the 2,200 target",max(dev)<0.1,str([d["totals"]["kcal"] for d in pl["days"]]))
            ings=[i for d in pl["days"] for m in d["meals"] for i in m["ingredients"]]
            check("8. existing food prioritised",sum(i["have"] for i in ings)/len(ings)>0.6,f"{sum(i['have'] for i in ings)}/{len(ings)} owned")
            buy=await page.get_by_test_id("shopping-buy").inner_text() if await page.get_by_test_id("shopping-buy").count() else ""
            invn={i["name"]:i for i in get("food_inventory",f"user_id=eq.{uid}&status=eq.active&select=name,grams,quantity_status")}
            used={}
            for i in ings: used[i["name"]]=used.get(i["name"],0)+i["grams"]
            lines=[l.split(" · ")[0] for l in buy.split("\n") if l.strip()]
            ok9=bool(lines) and all(n not in invn or (invn[n]["quantity_status"]!="as_needed" and used.get(n,0)>float(invn[n]["grams"] or 0)) for n in lines)
            check("9. shopping list only for missing or short food", ok9 and "Porridge oats" not in lines,buy.replace("\n"," | ")[:300])
            check("10. batch-prep sessions generated",await page.get_by_test_id("prep-session").count()>=1, (await page.get_by_test_id("prep-session").first.inner_text())[:300] if await page.get_by_test_id("prep-session").count() else "")
            # 11-12 EDIT Tuesday dinner
            tue=next(i for i,d in enumerate(pl["days"]) if d["label"]=="Tue"); before=pl["days"][tue]; other=json.dumps(pl["days"][(tue+2)%7])
            await page.get_by_role("tab", name=re.compile(r"^Tue")).click(); await page.wait_for_timeout(500)
            await page.get_by_test_id("plan-meal").filter(has_text="Dinner").click()
            await page.get_by_role("button",name="Something else").click(); await page.wait_for_timeout(2500)
            pl2=plan_row(uid)["plan"]; after=pl2["days"][tue]
            dn=lambda d:next(m for m in d["meals"] if m["slot"]=="dinner")
            check("11. Tuesday dinner edited",dn(after)["name"]!=dn(before)["name"] or dn(after)["ingredients"]!=dn(before)["ingredients"],f"{dn(before)['name']} -> {dn(after)['name']}")
            check("12. totals recalculated, other days untouched",after["totals"]["kcal"]==sum(m["kcal"] for m in after["meals"]) and json.dumps(pl2["days"][(tue+2)%7])==other)
            # 13-14 ACCEPT + PERSIST
            await page.get_by_role("button",name="Accept this plan").click(); await page.wait_for_timeout(2500)
            await page.reload(wait_until="networkidle"); await page.get_by_role("tab", name="Meal prep", exact=True).click(); await page.wait_for_timeout(2500)
            check("13-14. plan accepted and persists after refresh",plan_row(uid,"approved") and await page.get_by_text("Accepted plan").count()==1 and await page.get_by_text("Something else").count()==0)
            # 15-17 planned vs eaten
            rem=await page.get_by_test_id("kcal-remaining").inner_text()
            check("15. planned meals don't count as eaten",len(get("food_entries",f"user_id=eq.{uid}&select=id"))==0 and rem.strip()=="2200",rem)
            bk=next(m for m in pl2["days"][0]["meals"] if m["slot"]=="breakfast")
            btn=page.get_by_role("button",name="Log as eaten").first
            await btn.click(); await page.wait_for_timeout(300)
            if await btn.count() and await btn.is_visible(): await btn.click(force=True)
            await page.wait_for_timeout(3000)
            fe=get("food_entries",f"user_id=eq.{uid}&eaten_on=eq.{TODAY}&select=kcal,source,client_op_id")
            check("16. breakfast logged once into the food log",len(fe)==len(bk["ingredients"]) and all(x["source"]=="mealprep:meal" for x in fe),f"{len(fe)} entries")
            await page.reload(wait_until="networkidle"); await page.get_by_role("tab", name="Meal prep", exact=True).click(); await page.wait_for_timeout(2500)
            rem2=int((await page.get_by_test_id("kcal-remaining").inner_text()).strip())
            check("17. existing calorie counter updated",abs((2200-rem2)-bk["kcal"])<=3 and await page.get_by_text(re.compile("Eaten · ")).count()>=1,f"remaining {rem2}, breakfast {bk['kcal']}")
            await page.screenshot(path=str(SH/"today.png"))
            # 18-20 COACH
            reply,tc=await coach(page,uid,"How many calories have I eaten today?")
            check("18. Coach: calories eaten today","get_nutrition_status" in tc and str(bk["kcal"]) in reply.replace(",",""),reply.replace("\n"," / ")[:250])
            lunch_tmrw=next(m for m in pl2["days"][1]["meals"] if m["slot"]=="lunch")["name"]
            reply,tc=await coach(page,uid,"What have I got for lunch tomorrow?")
            check("19. Coach: tomorrow's lunch",lunch_tmrw.split(" ")[0].lower() in reply.lower(),f"{lunch_tmrw} :: "+reply.replace("\n"," / ")[:250])
            reply,tc=await coach(page,uid,"How many calories have I got left today?")
            check("20. Coach: calories left",str(2200-bk["kcal"]) in reply.replace(",",""),reply.replace("\n"," / ")[:250])
            reply,tc=await coach(page,uid,"Make Friday dinner vegetarian.")
            fri=next(i for i,d in enumerate(pl2["days"]) if d["label"]=="Fri")
            fd=next(m for m in plan_row(uid,"approved")["plan"]["days"][fri]["meals"] if m["slot"]=="dinner")
            check("Coach edits the real plan","edit_meal_prep" in tc and not any(i["key"] in ("chicken_breast","chicken_thigh","beef_mince","turkey_mince","salmon","cod","tuna","prawns") for i in fd["ingredients"]),fd["name"])
            # 19 PHOTO OF ACTUAL MEAL replaces a planned meal (screen)
            await page.goto(f"{BASE}/app/nutrition",wait_until="networkidle"); await page.get_by_role("tab", name="Meal prep", exact=True).click(); await page.wait_for_timeout(2500)
            async with page.expect_file_chooser() as fc:
                await page.get_by_role("button",name="Photo of what I ate").first.click()
            await (await fc.value).set_files(str(FX/"a.jpg"))
            await page.get_by_role("button",name="Log this instead").wait_for(timeout=90000)
            await page.get_by_role("button",name="Log this instead").click(); await page.wait_for_timeout(300)
            if await page.get_by_role("button",name="Log this instead").count(): await page.get_by_role("button",name="Log this instead").click(force=True)
            await page.wait_for_timeout(3500)
            lunch=next(m for m in plan_row(uid,"approved")["plan"]["days"][0]["meals"] if m["slot"]=="lunch")
            le=get("food_entries",f"user_id=eq.{uid}&eaten_on=eq.{TODAY}&meal_slot=eq.lunch&select=kcal,source")
            check("19. photo of actual lunch replaces the planned one",lunch["state"]=="eaten" and le and all("photo" in x["source"] for x in le) and abs(lunch["actual"]["kcal"]-sum(float(x["kcal"]) for x in le))<=40,f"planned {lunch['kcal']} actual {lunch['actual']} entries {len(le)}")
            await page.reload(wait_until="networkidle"); await page.get_by_role("tab", name="Meal prep", exact=True).click(); await page.wait_for_timeout(2000)
            check("19b. no duplicate after double tap and refresh",len(get("food_entries",f"user_id=eq.{uid}&eaten_on=eq.{TODAY}&meal_slot=eq.lunch&select=id"))==len(le) and await page.get_by_role("button",name="Photo of what I ate").count()==2)
            # 19c same through Coach (dinner)
            await page.goto(f"{BASE}/app/coach",wait_until="networkidle"); await page.wait_for_timeout(1500)
            n0=len(get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=id"))
            await page.get_by_label("Attach meal photo").set_input_files(str(FX/"d.jpg")); await page.wait_for_timeout(1000)
            await page.get_by_placeholder("Tell Coach what you need…").fill("This is what I actually had for dinner instead of my planned dinner. Log it in place of the planned dinner.")
            await page.get_by_role("button",name="Send").click()
            for _ in range(90):
                if len(get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=id"))>n0: break
                await page.wait_for_timeout(2000)
            await page.wait_for_timeout(2500)
            card=page.get_by_role("button",name="Confirm").last
            # Locked Coach rule: "Log it" is the member's confirmation, so Coach logs without a second Confirm.
            okc=await card.count()==0
            dinner=next(m for m in plan_row(uid,"approved")["plan"]["days"][0]["meals"] if m["slot"]=="dinner")
            de=get("food_entries",f"user_id=eq.{uid}&eaten_on=eq.{TODAY}&meal_slot=eq.dinner&select=source")
            await page.screenshot(path=str(SH/"coach_photo.png"))
            check("19c. Coach photo replaces planned dinner on the member's instruction",okc and dinner["state"]=="eaten" and de and all("photo" in x["source"] for x in de),f"state {dinner['state']} entries {[x['source'] for x in de]}")
            # 32 PHOTO + 33 MANUAL into the same inventory
            await page.goto(f"{BASE}/app/nutrition",wait_until="networkidle"); await page.get_by_role("tab", name="Meal prep", exact=True).click(); await page.wait_for_timeout(2000)
            await page.get_by_role("button",name="Clear list").click(); await page.wait_for_timeout(1500)
            await page.set_input_files('input[aria-label="Grocery photo"]',PHOTO)
            for _ in range(40):
                if get("food_inventory",f"user_id=eq.{uid}&status=eq.active&source=eq.photo&select=id"): break
                await page.wait_for_timeout(1500)
            await page.wait_for_timeout(2000)
            ph=get("food_inventory",f"user_id=eq.{uid}&status=eq.active&select=name,food_key,grams,quantity_status,source")
            pk={i["food_key"] for i in ph}
            check("32. photo identifies visible foods",len(pk & {"chicken_breast","eggs","rice","potatoes","peppers","broccoli","oats","greek_yoghurt"})>=6,str([(i["name"],i["grams"],i["quantity_status"]) for i in ph]))
            chick=[i for i in ph if i["food_key"]=="chicken_breast"]
            check("32b. chicken amount not fabricated (unknown unless read from the label)",chick and (chick[0]["quantity_status"]=="unknown" or 250<=float(chick[0]["grams"] or 0)<=1500),str(chick))
            await page.get_by_role("button",name="Use as needed and confirm").click(); await page.wait_for_timeout(1500)
            await page.get_by_role("button",name="Rebuild meal plan").click(); await page.wait_for_timeout(4000)
            check("32c. plan generated from photo inventory",(plan_row(uid,"proposed") or {}).get("plan",{}).get("days") and True)
            await page.get_by_role("button",name="Clear list").click(); await page.wait_for_timeout(1500)
            await page.get_by_label("Foods you have").fill("Chicken 1.2kg, Rice 1kg, Eggs 12, Potatoes 2kg, Oats 1 bag, Greek yoghurt 2 tubs")
            await page.get_by_role("button",name="Add foods").click(); await page.wait_for_timeout(2500)
            mi=get("food_inventory",f"user_id=eq.{uid}&status=eq.active&select=food_key,grams,source")
            check("33. typed foods use the same inventory",len(mi)==6 and all(i["source"]=="text" and i["grams"] for i in mi),str(mi))
            await page.screenshot(path=str(SH/"final.png"))
        finally:
            await b.close()
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}",headers=H,timeout=30)
    print(f"\n{sum(res)} of {len(res)} pass"); sys.exit(0 if all(res) else 1)
asyncio.run(main())
