"""Live: pre-authorised booking, barber + MOT appointments, reschedule, phone path honesty, journey/reminder after booking, Pro blocked."""
import asyncio, json, re, datetime as D, sys, os
sys.path.insert(0, os.path.dirname(__file__))
import real_world_bookings as R
from playwright.async_api import async_playwright
async def main():
    uids=[]; d3=(D.date.today()+D.timedelta(days=3)).isoformat(); d4=(D.date.today()+D.timedelta(days=4)).isoformat()
    async with async_playwright() as pl:
        b=await pl.chromium.launch(headless=True)
        try:
            uid,page=await R.member(b,"execute"); uids.append(uid)
            await page.goto(f"{R.BASE}/app/coach",wait_until="networkidle"); await page.wait_for_timeout(1500)
            a,t=await R.say(page,uid,f"Pre-authorised: book any barber haircut at Ted's Grooming Room Manchester (https://www.tedsgroomingroom.com/book) on {d3} between 10:00 and 12:00, under £30. Just pick the first free time.")
            bk=[x for x in R.bookings(uid) if "barber" in x["service"].lower() or "hair" in x["service"].lower() or "ted" in (x["provider_name"] or "").lower()]
            R.ok("pre-authorisation recorded with the member's words", bk and bk[-1]["preauthorisation"] and bk[-1]["preauthorisation"].get("text"), bk)
            R.ok("barber is an appointment", bk and bk[-1]["kind"]=="appointment", bk)
            if bk and bk[-1]["status"]=="awaiting_confirmation": a,t=await R.say(page,uid,"Go ahead online.")
            a,t=await R.say(page,uid,"Booked: reference TGR-4410, 10:00, £25.")
            bk=[x for x in R.bookings(uid) if x["id"]==bk[-1]["id"]] if bk else []
            R.ok("barber confirmed into calendar", bk and bk[0]["status"]=="confirmed" and bk[0]["commitment_id"], bk)
            a,t=await R.say(page,uid,f"Move my haircut to {d4} same morning window.")
            a,t=await R.say(page,uid,"The 10:00 one, online.")
            a,t=await R.say(page,uid,"Done, new reference TGR-4477 at 10:00.")
            allb=R.bookings(uid)
            old=[x for x in allb if x["reference"]=="TGR-4410"]; new=[x for x in allb if x["reference"]=="TGR-4477"]
            coms=R.get("commitments",f"user_id=eq.{uid}&select=title,on_date,booking_id")
            R.ok("reschedule: new confirmed, old retired, one calendar entry", new and new[0]["status"]=="confirmed" and old and old[0]["status"]=="cancelled" and len([c for c in coms if "Travel" not in c["title"]])==1, (old,new,coms))
            a,t=await R.say(page,uid,f"I need an MOT for my Ford Focus at Kwik Fit Manchester on {d3} afternoon. Please book it by phone: their number is +44 161 555 0100.")
            m=[x for x in R.bookings(uid) if "mot" in x["service"].lower()]
            R.ok("MOT booking created with vehicle detail", m and "focus" in json.dumps(m[-1]["details"]).lower(), m)
            btn=page.get_by_role("button",name=re.compile("Confirm"))
            if await btn.count(): await btn.last.click(); await page.wait_for_timeout(5000)
            else: a,t=await R.say(page,uid,"Yes, the first time, call them.")
            if await btn.count(): await btn.last.click(); await page.wait_for_timeout(5000)
            m=R.get("appointment_bookings",f"id=eq.{m[-1]['id']}&select=status,failure_reason")[0] if m else None
            R.ok("phone path honest when calling isn't switched on (never 'booked')", m and m["status"]!="confirmed", m)
            print("MOT",m)
            a,t=await R.say(page,uid,"Remind me an hour before my haircut.")
            calls=R.get("scheduled_calls",f"user_id=eq.{uid}&select=purpose,call_at,status")
            nots=R.get("notifications",f"user_id=eq.{uid}&select=intent,status")
            print("REMINDERS",calls,nots[:5])
            R.ok("reminder attached after booking", calls or any("remind" in (n["intent"] or "") for n in nots) or re.search(r"remind", a, re.I), a)
            a,t=await R.say(page,uid,"Plan my journey to my haircut, driving from Manchester Piccadilly station. Ted's is at 1 Deansgate, Manchester M3 1AZ.")
            if re.search(r"which (origin|one|destination)", a, re.I): a,t=await R.say(page,uid,"Manchester Piccadilly railway station.")
            js=R.get("journeys",f"user_id=eq.{uid}&select=status,appointment_id,leave_at,arrive_by,duration_min")
            print("JOURNEYS",js)
            R.ok("journey planned and linked to the booked haircut", js and any(j.get("appointment_id") for j in js), (js,a))
            uid2,p2=await R.member(b,"pro"); uids.append(uid2)
            await p2.goto(f"{R.BASE}/app/coach",wait_until="networkidle"); await p2.wait_for_timeout(3000)
            a,t=await R.say(p2,uid2,f"Book a table for two at Bella Italia Manchester on {d3} at 7:30pm.")
            R.ok("Pro member cannot book (Execute only)", not R.get("appointment_bookings",f"user_id=eq.{uid2}&select=id") and re.search(r"execute", a, re.I), a)
        except Exception as e:
            print("CRASH",repr(e)[:300])
        finally:
            await b.close()
            for u in uids: R.requests.delete(f"{R.URL}/auth/v1/admin/users/{u}",headers=R.H)
    print(f"{R.P} of {R.P+R.F} pass")
asyncio.run(main())
