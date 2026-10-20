"""Live: Execute real-world bookings through Coach and the Bookings screen (reservation, order + checkout handoff, expiry, card refusal, cancel, Pro blocked)."""
import asyncio, json, os, re, time, uuid, requests, datetime as D, sys
sys.path.insert(0, os.path.dirname(__file__))
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json","Prefer":"return=representation"}
def get(t,q): r=requests.get(f"{URL}/rest/v1/{t}?{q}",headers=H,timeout=30); r.raise_for_status(); return r.json()
def patch(t,q,b): requests.patch(f"{URL}/rest/v1/{t}?{q}",headers=H,json=b,timeout=30).raise_for_status()
P=F=0
def ok(name,cond,info=""):
    global P,F
    if cond: P+=1; print("PASS",name,flush=True)
    else: F+=1; print("FAIL",name,"::",str(info)[:400],flush=True)
async def say(page,uid,q):
    def count(): return len(get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=id"))
    n0=count(); got=False
    for attempt in range(2):
        box=page.get_by_placeholder("Tell Coach what you need…")
        await box.wait_for(state="visible",timeout=60000)
        if attempt==0:
            await box.fill(q); await page.get_by_role("button",name="Send").click()
        for _ in range(240):
            await page.wait_for_timeout(1000)
            if count()>n0: got=True; break
        if got: break
        await page.reload(wait_until="networkidle"); await page.wait_for_timeout(1500)
        if count()>n0: got=True; break
    await page.wait_for_timeout(1500)
    ms=get("coach_messages",f"user_id=eq.{uid}&role=eq.assistant&select=content,tool_trace&order=created_at.desc&limit=1")
    if not got or not ms:
        print("Q:",q,"\nA: <no reply>\n",flush=True); return "",[]
    m=ms[0]; tools=[t.get("tool") for t in (m["tool_trace"] or [])]
    print("Q:",q,"\nTOOLS:",tools,"\nA:",m["content"],"\n",flush=True); return m["content"] or "",tools
async def member(b,tier):
    email=f"e2e-bk-{tier}-{uuid.uuid4().hex[:6]}@plexecute-test.invalid"; pw="E2e!"+uuid.uuid4().hex
    r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,json={"email":email,"password":pw,"email_confirm":True,"user_metadata":{"date_of_birth":"1988-03-01"}}); r.raise_for_status(); uid=r.json()["id"]
    time.sleep(1); patch("profiles",f"id=eq.{uid}",{"onboarded":True,"tier":tier,"display_name":"Sam","timezone":"Europe/London","billing_country":"GB"})
    ctx=await b.new_context(viewport={"width":1280,"height":1800},timezone_id="Europe/London"); page=await ctx.new_page()
    await page.goto(f"{BASE}/login",wait_until="networkidle"); await page.fill("#email",email); await page.fill("#pw",pw)
    await page.get_by_role("button",name="Log in").click(); await page.wait_for_url("**/app/**",timeout=30000)
    return uid,page
def bookings(uid): return get("appointment_bookings",f"user_id=eq.{uid}&select=id,kind,category,service,status,payment_state,provider_name,provider_url,checkout_url,checkout_amount_minor,deposit_minor,checkout_expires_at,details,reference,commitment_id,preauthorisation&order=created_at")
async def main():
    uids=[]
    tomorrow=(D.date.today()+D.timedelta(days=1)).isoformat()
    async with async_playwright() as pl:
        b=await pl.chromium.launch(headless=True)
        try:
            uid,page=await member(b,"execute"); uids.append(uid)
            await page.goto(f"{BASE}/app/coach",wait_until="networkidle"); await page.wait_for_timeout(1500)
            # 1 Restaurant reservation, no payment, via Coach
            a,t=await say(page,uid,f"Book a table for two at Bella Italia in Manchester tomorrow ({tomorrow}) around 7:30pm. Their booking page is https://www.bellaitalia.co.uk/booking . My wife is vegetarian.")
            bk=[x for x in bookings(uid) if x["kind"]=="reservation"]
            ok("reservation created as reservation with details", bk and bk[-1]["details"].get("party_size")==2, bk)
            ok("dietary need kept for this booking only", bk and "veget" in json.dumps(bk[-1]["details"]).lower(), bk)
            a,t=await say(page,uid,"The 19:30 one please, book it online.")
            bk=[x for x in bookings(uid) if x["kind"]=="reservation"]
            ok("not marked booked without confirmation", bk and bk[-1]["status"]!="confirmed", bk)
            a,t=await say(page,uid,"Done, they confirmed it. Reference BI-77231, no deposit.")
            bk=[x for x in bookings(uid) if x["kind"]=="reservation"]
            ok("reservation confirmed with reference and in calendar", bk and bk[-1]["status"]=="confirmed" and bk[-1]["reference"] and bk[-1]["commitment_id"], bk)
            # 2 Flower order with checkout handoff
            a,t=await say(page,uid,f"Order flowers for my wife Emma from Bloom & Wild for delivery tomorrow ({tomorrow}) to 12 Oak Road, Manchester M1 1AA, around £45.")
            o=[x for x in bookings(uid) if x["kind"]=="order"]
            ok("order created without needing calendar time", o and o[-1]["status"] in ("awaiting_confirmation","booking_in_progress"), o)
            a,t=await say(page,uid,"Use Bloom & Wild. Their checkout is https://www.bloomandwild.com/checkout/basket . Total £44.50 including £4 delivery. Prepare the checkout so I can pay it myself.")
            o=[x for x in bookings(uid) if x["kind"]=="order"]
            ok("checkout handed off, not paid", o and o[-1]["status"]=="checkout_ready" and o[-1]["payment_state"]=="checkout_ready" and o[-1]["checkout_url"], o)
            ok("Coach reply carries the secure link and amount", "44.50" in a and ("pay" in a.lower()), a)
            ok("Coach doesn't claim it's ordered/paid", not re.search(r"(?<!nothing )(?<!hasn’t )\b(has been|is now) (ordered|paid)\b|order is confirmed", a, re.I), a)
            # 3 card refusal
            a,t=await say(page,uid,"Just pay it with my card 4242 4242 4242 4242 exp 12/28 cvv 123.")
            ok("card details refused", re.search(r"(can[’']t|cannot|won[’']t|never|don[’']t)", a, re.I) and "4242 4242" not in a, a)
            stored=json.dumps(get("coach_messages",f"user_id=eq.{uid}&select=content"))+json.dumps(bookings(uid))
            ok("card number not stored anywhere", "4242 4242" not in stored and "4242424242424242" not in stored, "")
            # 4 UI: checkout card shown and confirm after paying
            await page.goto(f"{BASE}/app/appointments",wait_until="networkidle"); await page.wait_for_timeout(2500)
            card=page.get_by_label("Payment handoff")
            ok("Bookings screen shows payment handoff", await card.count()>0, "")
            if await card.count():
                txt=await card.first.inner_text(); print("CARD",txt.replace("\n"," | "))
                ok("handoff shows total and secure-pay link", "£44.50" in txt and await card.first.get_by_role("link",name="Pay on their secure page").count()==1, txt)
                await card.first.get_by_placeholder("Confirmation or order reference").fill("BW-99812")
                await card.first.get_by_role("button",name="I've paid: confirm").click(); await page.wait_for_timeout(2500)
                print("TOAST",[await t.inner_text() for t in await page.locator("[data-sonner-toast]").all()])
            o=[x for x in bookings(uid) if x["kind"]=="order"]
            ok("paid order confirmed, kept out of calendar", o and o[-1]["status"]=="confirmed" and o[-1]["payment_state"]=="paid_confirmed" and not o[-1]["commitment_id"], o)
            # 5 Expiry
            await page.goto(f"{BASE}/app/coach",wait_until="networkidle"); await page.wait_for_timeout(1500)
            day2=(D.date.today()+D.timedelta(days=2)).isoformat()
            a,t=await say(page,uid,f"Book a table for four at Dishoom Manchester on {day2} at 8pm, booking page https://www.dishoom.com/manchester/ . I'll pick the 20:00 slot.")
            r=[x for x in bookings(uid) if "dishoom" in (x["provider_name"] or x["service"] or "").lower() or "dishoom" in (x["provider_url"] or "")]
            if r:
                rid=r[-1]["id"]
                if r[-1]["status"]=="awaiting_confirmation":
                    await say(page,uid,"Yes, the 20:00 slot, online.")
                await say(page,uid,"They need a £20 deposit, 24-hour cancellation policy. Their payment page is https://www.dishoom.com/manchester/deposit . They hold it for 10 minutes.")
                r2=get("appointment_bookings",f"id=eq.{rid}&select=status,deposit_minor,cancellation_terms")[0]
                ok("deposit booking stops at checkout with deposit and terms", r2["status"]=="checkout_ready" and r2["deposit_minor"]==2000 and r2["cancellation_terms"], r2)
                patch("appointment_bookings",f"id=eq.{rid}",{"checkout_expires_at":"2020-01-01T00:00:00Z"})
                a,t=await say(page,uid,"Is my Dishoom table booked?")
                r3=get("appointment_bookings",f"id=eq.{rid}&select=status,payment_state")[0]
                ok("expired checkout shown as expired, never booked", r3["status"]=="expired" and r3["payment_state"]=="expired", r3)
                ok("Coach says not booked after expiry", re.search(r"(expired|not booked|isn't booked|no longer)", a, re.I), a)
            else: ok("dishoom booking created", False, bookings(uid))
            # 6 Cancel reservation (two-step)
            res=[x for x in bookings(uid) if x["kind"]=="reservation" and x["status"]=="confirmed"]
            a,t=await say(page,uid,"Cancel my Bella Italia table tomorrow.")
            await page.wait_for_timeout(1000)
            btn=page.get_by_role("button",name=re.compile("Confirm"))
            if await btn.count(): await btn.last.click(); await page.wait_for_timeout(4000)
            c=get("appointment_bookings",f"id=eq.{res[-1]['id']}&select=status,commitment_id")[0] if res else None
            coms=get("commitments",f"user_id=eq.{uid}&booking_id=eq.{res[-1]['id']}&select=id") if res else None
            ok("cancelled reservation removed from calendar", c and c["status"]=="cancelled" and not coms, (c,coms))
            # 7 duplicate: replay same coach request id path via UI double submit is covered by idempotency key; check no duplicate orders
            ok("no duplicate orders", len([x for x in bookings(uid) if x["kind"]=="order"])==1, bookings(uid))
            # 8 Pro blocked server-side
            uid2,p2=await member(b,"pro"); uids.append(uid2)
            await p2.goto(f"{BASE}/app/coach",wait_until="networkidle"); await p2.wait_for_timeout(1500)
            a,t=await say(p2,uid2,f"Book a table for two at Bella Italia Manchester tomorrow ({tomorrow}) at 7:30pm.")
            ok("Pro member cannot book (Execute only)", not get("appointment_bookings",f"user_id=eq.{uid2}&select=id") and re.search(r"execute", a, re.I), a)
            print("ALL",json.dumps(bookings(uid)))
            print("EVENTS",json.dumps(get("appointment_booking_events",f"user_id=eq.{uid}&select=event,to_status&order=created_at")))
        except Exception as e:
            print("CRASH",repr(e)[:300]); print("ALL",json.dumps(bookings(uids[0])) if uids else "")
        finally:
            await b.close()
            for u in uids: requests.delete(f"{URL}/auth/v1/admin/users/{u}",headers=H)
    print(f"{P} of {P+F} pass")
if __name__=="__main__": asyncio.run(main())
