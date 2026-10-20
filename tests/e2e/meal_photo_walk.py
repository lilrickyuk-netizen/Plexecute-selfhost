import asyncio, json, os, time, uuid, requests
from pathlib import Path
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json","Prefer":"return=representation"}
IMG=Path(__file__).parent/"fixtures"; SH=Path("/tmp/browser/meal/shots"); SH.mkdir(parents=True,exist_ok=True); res=[]
def check(n,ok,d=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ")+n+(f" :: {d}" if d else ""),flush=True)
def get(t,q): r=requests.get(f"{URL}/rest/v1/{t}?{q}",headers=H,timeout=30); r.raise_for_status(); return r.json()
def patch(t,q,b): r=requests.patch(f"{URL}/rest/v1/{t}?{q}",headers=H,json=b,timeout=30); r.raise_for_status(); return r.json()
def est(uid): return get("meal_photo_estimates",f"user_id=eq.{uid}&select=id,status,estimate,corrections&order=created_at.desc")
def foods(uid): return get("food_entries",f"user_id=eq.{uid}&select=id,name,kcal,grams,source,estimated,client_op_id")
async def toast(p): await p.wait_for_timeout(1200); return " | ".join(await p.locator("[data-sonner-toast]").all_inner_texts())

async def open_photo(page):
    await page.goto(f"{BASE}/app/nutrition",wait_until="networkidle"); await page.wait_for_timeout(1500)
    await page.get_by_role("button",name="Add food").first.click(); await page.wait_for_timeout(800)
    await page.screenshot(path=str(SH/"dlg.png")); await page.get_by_role("tab",name="Photo").click(timeout=8000); await page.wait_for_timeout(500)

async def shoot(page,name,uid):
    n0=len(est(uid))
    await page.get_by_role("dialog").get_by_test_id("meal-photo-upload").set_input_files(str(IMG/f"{name}.jpg"))
    for _ in range(90):
        await page.wait_for_timeout(1000)
        if len(est(uid))>n0 or await page.locator("[data-sonner-toast]").count(): break
    await page.wait_for_timeout(1500); await page.screenshot(path=str(SH/f"{name}.png"))
    rows=est(uid); return rows[0] if len(rows)>n0 else None, await page.locator("[role=dialog]").inner_text()

async def main():
    email=f"e2e-meal-{uuid.uuid4().hex[:8]}@plexecute-test.invalid"; pw="E2e!"+uuid.uuid4().hex; uid=None
    async with async_playwright() as pl:
        b=await pl.chromium.launch(headless=True); ctx=await b.new_context(viewport={"width":1280,"height":1800},timezone_id="Europe/London"); page=await ctx.new_page()
        try:
            r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,json={"email":email,"password":pw,"email_confirm":True,"user_metadata":{"date_of_birth":"1990-05-01"}}); r.raise_for_status(); uid=r.json()["id"]
            time.sleep(1); patch("profiles",f"id=eq.{uid}",{"onboarded":True,"tier":"pro","display_name":"Meal Tester"})
            await page.goto(f"{BASE}/login",wait_until="networkidle"); await page.fill("#email",email); await page.fill("#pw",pw)
            await page.get_by_role("button",name="Log in").click(); await page.wait_for_url("**/app/**",timeout=30000)
            # A clear meal
            await open_photo(page); a,txt=await shoot(page,"a",uid)
            items=" ".join(i.get("name","") for i in (a or {}).get("estimate",{}).get("items",[])).lower() if a else ""
            check("A. clear meal estimated with items",a and "chicken" in items and "rice" in items,items)
            check("A. calories shown as a range","kcal" in txt and "–" in txt, txt[:300].replace("\n"," | "))
            check("raw photo not stored (estimate is JSON only)",a and "data:image" not in json.dumps(a))
            check("nothing logged before confirmation",len(foods(uid))==0)
            # F/G correction
            k0=txt
            await page.get_by_label("Correct the estimate").fill("The chicken was 250 g"); await page.get_by_role("button",name="Update").click()
            await page.wait_for_timeout(15000); a2=est(uid)[0]; t2=await page.locator("[role=dialog]").inner_text(); await page.screenshot(path=str(SH/"a_fixed.png"))
            ch=[i for i in a2["estimate"]["items"] if "chicken" in i["name"].lower()]
            check("F/G. correction updates portion and totals",a2["corrections"] and ch and abs(ch[0]["grams_low"]-250)<=10 and ch[0]["grams_high"]==ch[0]["grams_low"] and t2!=k0,json.dumps(ch)[:200])
            # H confirm + J double tap
            await page.get_by_label("Meal",exact=True).last.select_option("lunch")
            btn=page.get_by_role("button",name="Log meal"); await btn.dblclick(); tt=await toast(page); await page.wait_for_timeout(2000)
            f=foods(uid); n_items=len(a2["estimate"]["items"])
            check("H. confirmed meal logged through calorie counter",len(f)==n_items and all(x["estimated"] for x in f),tt)
            check("J. double tap made no duplicates",len({x["client_op_id"] for x in f})==len(f)==n_items)
            check("estimate marked logged",est(uid)[0]["status"]=="logged")
            await page.reload(wait_until="networkidle"); await page.wait_for_timeout(2500); body=await page.inner_text("body")
            check("H. meal visible on Nutrition after refresh",any(x["name"].split(" ")[0] in body for x in f))
            # I cancel; B/C/D/E
            for name,label in [("b","B. multi-item"),("c","C. oily/sauce"),("d","D. takeaway"),("e","E. obscured")]:
                await open_photo(page); e,t=await shoot(page,name,uid)
                es=(e or {}).get("estimate",{}); its=es.get("items",[])
                if name=="e":
                    check(label+" handled honestly",(not its) or es.get("confidence") in ("low",) or "clear" in t.lower() or "can't" in t.lower(),t[:250].replace("\n"," | "))
                else:
                    wide=any(i["grams_high"]>i["grams_low"] for i in its) if its else False
                    check(label+" estimated with ranges",len(its)>=(3 if name=="b" else 1) and wide,", ".join(i["name"] for i in its))
                if e and e["status"]=="pending" and es.get("status")!="unclear":
                    n=len(foods(uid)); await page.get_by_role("button",name="Cancel").click(); await page.wait_for_timeout(1500)
                    check(label+" I. cancel logs nothing",len(foods(uid))==n and est(uid)[0]["status"]=="cancelled")
                await page.keyboard.press("Escape")
            # K Coach
            n=len(foods(uid))
            await page.goto(f"{BASE}/app/coach",wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_label("Attach meal photo").set_input_files(str(IMG/"a.jpg")); await page.wait_for_timeout(1000)
            await page.get_by_placeholder("Tell Coach what you need…").fill("How many calories are in this?"); await page.get_by_role("button",name="Send").click()
            await page.wait_for_timeout(45000); body=await page.inner_text("body"); await page.screenshot(path=str(SH/"coach1.png"))
            check("K. Coach answers with a calorie range","kcal" in body.lower() or "calorie" in body.lower(),body[-500:].replace("\n"," | "))
            await page.get_by_placeholder("Tell Coach what you need…").fill("The rice was about 200 g. Log it as dinner."); await page.get_by_role("button",name="Send").click()
            # Locked Coach rule: the member's own "Log it" instruction is the confirmation, so no second Confirm.
            ok=False
            for _ in range(45):
                await page.wait_for_timeout(2000)
                if len(foods(uid))>n: ok=True; break
            await page.screenshot(path=str(SH/"coach2.png"))
            check("K. Coach logs on the member's instruction without a second confirmation",ok and await page.get_by_role("group",name="Confirm change").count()==0,(await page.inner_text("body"))[-400:])
            if ok:
                await page.wait_for_timeout(8000); f2=foods(uid); new=len(f2)-n
                rice=[x for x in f2 if "rice" in x["name"].lower() and x["client_op_id"].startswith("mealphoto:"+est(uid)[0]["id"])]
                check("K. Coach log uses canonical counter + correction applied",new>0 and rice and abs(float(rice[0]["grams"])-200)<=15,json.dumps(rice)[:200])
                await page.get_by_placeholder("Tell Coach what you need…").fill("Log it again please."); await page.get_by_role("button",name="Send").click(); await page.wait_for_timeout(40000)
                c2=page.get_by_role("group",name="Confirm change")
                if await c2.count()>0:
                    try: await c2.last.get_by_role("button",name="Confirm").click(timeout=3000); await page.wait_for_timeout(5000)
                    except Exception: pass
                check("J. Coach repeat makes no duplicate",len(foods(uid))==len(f2))
            # L manual regression
            await page.goto(f"{BASE}/app/nutrition",wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button",name="Add food").first.click(); await page.get_by_role("tab",name="Manual").click(); await page.wait_for_timeout(500)
            await page.screenshot(path=str(SH/"manual.png"))
            usage=get("usage_events",f"user_id=eq.{uid}&select=*")
            ph=[u for u in usage if str(u.get("feature","")).startswith("food_photo") and u.get("unit")=="requests"]
            print("USAGE",json.dumps(ph),flush=True)
            check("usage metered per photo call",len(ph)>=5)
        finally:
            await b.close()
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}",headers=H)
    print(f"\n{sum(res)}/{len(res)} passed")
asyncio.run(main())
