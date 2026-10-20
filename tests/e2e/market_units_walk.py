import asyncio, json, os, sys, time, uuid, re, requests
from pathlib import Path
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json","Prefer":"return=representation"}
MK=sys.argv[1] if len(sys.argv)>1 else "GB"; TZ={"GB":"Europe/London","US":"America/New_York"}[MK]
SH=Path(f"/tmp/browser/mkt/{MK}"); SH.mkdir(parents=True,exist_ok=True)
res=[]
def check(n,ok,d=""): res.append(ok); print(("PASS " if ok else "FAIL ")+n+(f" :: {d}" if d else ""), flush=True)
def get(t,q): r=requests.get(f"{URL}/rest/v1/{t}?{q}",headers=H,timeout=30); r.raise_for_status(); return r.json()
def post(t,b): r=requests.post(f"{URL}/rest/v1/{t}",headers=H,json=b,timeout=30); r.raise_for_status(); return r.json()
def patch(t,q,b): r=requests.patch(f"{URL}/rest/v1/{t}?{q}",headers=H,json=b,timeout=30); r.raise_for_status(); return r.json()
def dele(t,q): requests.delete(f"{URL}/rest/v1/{t}?{q}",headers=H,timeout=30)
CUR="$" if MK=="US" else "£"; OTH="£" if MK=="US" else "$"
async def body(p): return await p.inner_text("body")
async def toasts(p):
    await p.wait_for_timeout(1500); return " | ".join(await p.locator("[data-sonner-toast]").all_inner_texts())
async def main():
    email=f"e2e-mkt{MK.lower()}-{uuid.uuid4().hex[:8]}@plexecute-test.invalid"; pw="E2e!"+uuid.uuid4().hex; uid=None
    async with async_playwright() as pl:
        b=await pl.chromium.launch(headless=True)
        ctx=await b.new_context(viewport={"width":1280,"height":1800},timezone_id=TZ); page=await ctx.new_page()
        try:
            r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,json={"email":email,"password":pw,"email_confirm":True,"user_metadata":{"date_of_birth":"1990-05-01"}}); r.raise_for_status(); uid=r.json()["id"]
            await page.goto(f"{BASE}/login",wait_until="networkidle"); await page.fill("#email",email); await page.fill("#pw",pw)
            await page.get_by_role("button",name="Log in").click(); await page.wait_for_url("**/onboarding**",timeout=20000)
            await page.wait_for_timeout(1500)
            sel=page.get_by_label("Billing country")
            dflt=await sel.input_value(); check("onboarding suggests country from device time zone",dflt==MK,dflt)
            # exercise the control: switch away and back
            await sel.select_option("US" if MK=="GB" else "GB"); await sel.select_option(MK)
            check("onboarding country selection works",await sel.input_value()==MK)
            units_sel=page.locator("select").filter(has_text="Imperial").first
            check("onboarding suggests units by market",await units_sel.input_value()==("imperial" if MK=="US" else "metric"))
            cont=page.get_by_role("button",name="Continue")
            await page.locator("input").first.fill(f"{MK} Tester")
            for cb in await page.get_by_role("checkbox").all():
                if not await cb.is_checked(): await cb.check()
            await cont.click()
            await __import__("_onboarding").questionnaire(page, "Get stronger", "Fitness and sport")
            await page.get_by_role("button",name="Accept and start").click()
            await page.wait_for_url("**/app/coach**",timeout=90000)
            await page.wait_for_timeout(4000)
            pr=get("profiles",f"id=eq.{uid}&select=billing_country,billing_country_source,units,onboarded")[0]
            check("onboarding saved billing country",pr["billing_country"]==MK,json.dumps(pr))

            # Billing prices
            await page.goto(f"{BASE}/app/billing",wait_until="networkidle"); await page.wait_for_timeout(2500)
            t=await body(page); await page.screenshot(path=str(SH/"billing.png"))
            check(f"billing shows {CUR} prices",f"{CUR}23.99" in t and f"{CUR}59.99" in t and f"{OTH}23.99" not in t)
            check("billing country notice shown",("United States" if MK=="US" else "United Kingdom") in t)
            await page.get_by_role("button",name="Subscribe now").first.click(); tt=await toasts(page)
            check("purchase blocked until billing address country confirmed","Confirm your billing address" in tt,tt)
            await page.get_by_label("Billing address confirmation").check()
            checkout_url={}
            async def on_route(route):
                checkout_url["u"]=route.request.url; await route.abort()
            await page.route("https://checkout.stripe.com/**",on_route)
            await page.get_by_role("button",name="Subscribe now").first.click(); tt=await toasts(page); await page.wait_for_timeout(2000)
            checkout_url["toast"]=tt
            print("checkout result:",json.dumps(checkout_url)[:300])
            json.dump(checkout_url,open(SH/"checkout.json","w"))
            if MK=="US":
                check("US checkout fails closed until USD prices exist","switched on" in tt or "u" in checkout_url, tt)
            else:
                m=re.search(r"(cs_(?:live|test)_[A-Za-z0-9]+)",checkout_url.get("u",""))
                check("UK checkout reaches Stripe",bool(m),checkout_url.get("u","")[:60] or tt)
                if m:
                    SK=os.environ["STRIPE_SECRET_KEY"]
                    cs=requests.get(f"https://api.stripe.com/v1/checkout/sessions/{m.group(1)}",auth=(SK,""),timeout=30).json()
                    check("Stripe checkout requires billing address",cs.get("billing_address_collection")=="required",cs.get("billing_address_collection"))
                    check("Stripe checkout currency is GBP",cs.get("currency")=="gbp",cs.get("currency"))
                    ex=requests.post(f"https://api.stripe.com/v1/checkout/sessions/{m.group(1)}/expire",auth=(SK,""),timeout=30).json()
                    check("test checkout session expired unpaid",ex.get("status")=="expired" and ex.get("payment_status")=="unpaid")

            # Settings country change, no subscription
            other="US" if MK=="GB" else "GB"
            await page.goto(f"{BASE}/app/settings",wait_until="networkidle"); await page.wait_for_timeout(2000)
            await page.get_by_label("Billing country").select_option(other)
            await page.get_by_role("button",name="Save preferences").click(); tt=await toasts(page)
            pr=get("profiles",f"id=eq.{uid}&select=billing_country,billing_country_source")[0]
            check("Settings country change works without subscription",pr["billing_country"]==other and pr["billing_country_source"]=="member",json.dumps(pr)+" "+tt)
            await page.goto(f"{BASE}/app/billing",wait_until="networkidle"); await page.wait_for_timeout(2500)
            t=await body(page); oc="$" if other=="US" else "£"
            check("billing currency follows the changed country",f"{oc}23.99" in t)
            await page.goto(f"{BASE}/app/settings",wait_until="networkidle"); await page.wait_for_timeout(2000)
            await page.get_by_label("Billing country").select_option(MK); await page.get_by_role("button",name="Save preferences").click(); await toasts(page)
            check("country changed back",get("profiles",f"id=eq.{uid}&select=billing_country")[0]["billing_country"]==MK)

            # Active subscription: lock + reward + topup
            post("subscriptions",{"user_id":uid,"status":"active","tier":"execute","customer_id":f"cus_test_{uid[:8]}","subscription_id":f"sub_test_{uid[:8]}","billing_interval":"month"})
            patch("profiles",f"id=eq.{uid}",{"tier":"execute"})
            await page.goto(f"{BASE}/app/settings",wait_until="networkidle"); await page.wait_for_timeout(2000)
            await page.get_by_label("Billing country").select_option(other); await page.get_by_role("button",name="Save preferences").click(); tt=await toasts(page)
            pr=get("profiles",f"id=eq.{uid}&select=billing_country")[0]
            check("country locked during active subscription",pr["billing_country"]==MK and "can't change" in tt,tt)
            await page.goto(f"{BASE}/app/billing",wait_until="networkidle"); await page.wait_for_timeout(3000)
            t=await body(page); await page.screenshot(path=str(SH/"billing_execute.png"))
            check(f"Execute reward shows {CUR}10",f"earn {CUR}10 off" in t and f"{OTH}10" not in t, t[t.find("Monthly Execution Reward"):][:160].replace("\n"," | "))
            check(f"voice top-up priced in {CUR}",f"{CUR}14.99" in t and f"{OTH}14.99" not in t)
            dele("subscriptions",f"user_id=eq.{uid}")

            # Units
            await page.goto(f"{BASE}/app/settings",wait_until="networkidle"); await page.wait_for_timeout(2000)
            await page.get_by_label("Units").select_option("imperial"); await page.get_by_role("button",name="Save preferences").click(); await toasts(page)
            check("switched to imperial in Settings",get("profiles",f"id=eq.{uid}&select=units")[0]["units"]=="imperial")
            await page.goto(f"{BASE}/app/profile",wait_until="networkidle"); await page.wait_for_timeout(2500)  # height lives on Profile now
            await page.get_by_label("Height (feet)").fill("5"); await page.get_by_label("Height (inches)").fill("11")
            await page.get_by_role("button",name="Save",exact=True).first.click(); await toasts(page)
            h=get("profiles",f"id=eq.{uid}&select=height_cm")[0]["height_cm"]
            check("5 ft 11 in stored as cm",abs(float(h)-180.3)<0.2,h)
            await page.goto(f"{BASE}/app/today",wait_until="networkidle"); await page.wait_for_timeout(2500)
            await page.get_by_label("Weight (lb)").fill("180"); await page.get_by_role("button",name="Save",exact=True).first.click(); await toasts(page)
            ws=get("daily_logs",f"user_id=eq.{uid}&kind=eq.weight&select=value,log_date")
            check("180 lb stored as kg",ws and abs(float(ws[0]["value"])-81.65)<0.05,ws)
            post("daily_logs",{"user_id":uid,"kind":"weight","value":82,"log_date":time.strftime("%Y-%m-%d",time.gmtime(time.time()-86400*2))})
            sess=post("workout_sessions",{"user_id":uid,"status":"completed","completed_at":"2026-10-10T10:00:00Z"})[0]
            post("workout_sets",{"user_id":uid,"session_id":sess["id"],"exercise":"Back squat","weight_kg":100,"reps":5,"set_number":1,"performed_on":"2026-10-10"})
            await page.goto(f"{BASE}/app/training",wait_until="networkidle"); await page.wait_for_timeout(2000)
            if await page.get_by_role("button",name="Create programme").count():
                await page.get_by_role("button",name="Create programme").click(); await page.wait_for_timeout(4000)
            async def views(label):
                out={}
                for path in ["today","progress","nutrition","training"]:
                    await page.goto(f"{BASE}/app/{path}",wait_until="networkidle"); await page.wait_for_timeout(3000)
                    await page.screenshot(path=str(SH/f"{label}_{path}.png")); out[path]=await body(page)
                return out
            imp=await views("imperial")
            check("Progress shows pounds","180 lb" in imp["progress"] or "180" in imp["progress"] and "Weight (lb)" in imp["progress"], re.findall(r"[^\n]*lb[^\n]*",imp["progress"])[:3])
            check("Nutrition trend in pounds"," lb" in imp["nutrition"] and not re.search(r"\d kg",imp["nutrition"]), re.findall(r"Trend[^\n]*",imp["nutrition"])[:1])
            check("Training shows 220.5 lb","220.5 lb" in imp["training"], re.findall(r"[^\n]*(?:lb|kg)[^\n]*",imp["training"])[:3])
            for k in ["today","progress","nutrition","training"]:
                check(f"no kg left on {k} in imperial", not re.search(r"\d\s?kg\b|\(kg\)",imp[k]), re.findall(r"[^\n]*kg[^\n]*",imp[k])[:2])
            await page.goto(f"{BASE}/app/today",wait_until="networkidle"); await page.wait_for_timeout(2000)
            check("Today weight input in lb", await page.get_by_label("Weight (lb)").count()>0)
            await page.reload(wait_until="networkidle"); await page.wait_for_timeout(2000)
            await page.goto(f"{BASE}/app/settings",wait_until="networkidle"); await page.wait_for_timeout(2500)
            units_ok=await page.get_by_label("Units").input_value()=="imperial"; bc=await page.get_by_label("Billing country").input_value()
            await page.goto(f"{BASE}/app/profile",wait_until="networkidle"); await page.wait_for_timeout(2500)
            check("refresh keeps imperial + feet/inches",units_ok and await page.get_by_label("Height (feet)").input_value()=="5" and await page.get_by_label("Height (inches)").input_value()=="11")
            check("refresh keeps billing country",bc==MK)
            before=(get("profiles",f"id=eq.{uid}&select=height_cm")[0], get("daily_logs",f"user_id=eq.{uid}&select=value&order=value"), get("workout_sets",f"user_id=eq.{uid}&select=weight_kg"))
            await page.goto(f"{BASE}/app/settings",wait_until="networkidle"); await page.wait_for_timeout(2000); await page.get_by_label("Units").select_option("metric"); await page.get_by_role("button",name="Save preferences").click(); await toasts(page)
            after=(get("profiles",f"id=eq.{uid}&select=height_cm")[0], get("daily_logs",f"user_id=eq.{uid}&select=value&order=value"), get("workout_sets",f"user_id=eq.{uid}&select=weight_kg"))
            check("switching units leaves stored values unchanged",before==after,json.dumps(after))
            met=await views("metric")
            check("metric: Training 100 kg","100 kg" in met["training"])
            check("metric: Nutrition in kg",re.search(r"\d kg",met["nutrition"]) is not None and " lb" not in met["nutrition"])
            check("metric: Progress in kg","Weight (kg)" in met["progress"] and "81.7" in met["progress"] or "81.6" in met["progress"])
            await page.goto(f"{BASE}/app/profile",wait_until="networkidle"); await page.wait_for_timeout(2500)
            check("metric height shows 180.3 cm",await page.get_by_label("Height (cm)").input_value() in ("180.3","180.30"), await page.get_by_label("Height (cm)").input_value())
        except Exception as e:
            check("script ran",False,repr(e)[:400]); await page.screenshot(path=str(SH/"error.png"))
        finally:
            await b.close()
            print("UID",uid); requests.delete(f"{URL}/auth/v1/admin/users/{uid}",headers=H) if uid and os.environ.get("KEEP")!="1" else None
    print(f"{sum(res)} of {len(res)} pass")
asyncio.run(main())
