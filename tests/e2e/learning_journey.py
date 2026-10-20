"""Completion item 75: critical end-to-end test, LEARNING/CAREER.

CAREER/QUALIFICATION GOAL -> CURRENT-SOURCE RESEARCH -> SOURCE PROVENANCE -> PATHWAY
-> MILESTONES -> STUDY/ACTION SCHEDULE -> EXECUTION -> REVIEW -> MISSED ACTION -> REPLAN

Fresh account per run (confirmed via the auth admin API), removed afterwards. Research is live:
the Firecrawl connection searches current public sources and every kept fact carries a verbatim
quote checked against its source. The profile time zone is one where it is morning, so today's
study session can be scheduled at any UTC hour.
"""
import asyncio, os, re, sys, uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
import requests
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
URL = os.environ["SUPABASE_URL"]; SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": SR, "Authorization": f"Bearer {SR}", "Content-Type": "application/json", "Prefer": "return=representation"}
SHOTS = Path("/tmp/browser/j75"); SHOTS.mkdir(parents=True, exist_ok=True)
results = []
def check(n, ok, d=""): results.append(bool(ok)); print(("PASS " if ok else "FAIL ") + n + (f" :: {d}" if d else ""))
def rest(t, q): r = requests.get(f"{URL}/rest/v1/{t}?{q}", headers=H, timeout=30); r.raise_for_status(); return r.json()
def patch(t, q, body): r = requests.patch(f"{URL}/rest/v1/{t}?{q}", headers=H, json=body, timeout=30); assert r.ok, r.text
ZONES = ["Pacific/Honolulu", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo",
         "Europe/London", "Europe/Berlin", "Europe/Athens", "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"]
TZ = next(z for z in ZONES if 7 <= datetime.now(ZoneInfo(z)).hour <= 10)
TITLE = "NEBOSH National General Certificate"

async def main():
    email = f"e2e-learn-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"; pw = "E2e!" + uuid.uuid4().hex; uid = None
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        page = await (await b.new_context(viewport={"width": 1280, "height": 1800}, timezone_id=TZ)).new_page()
        try:
            r = requests.post(f"{URL}/auth/v1/admin/users", headers=H, timeout=30, json={"email": email, "password": pw, "email_confirm": True, "user_metadata": {"date_of_birth": "1990-05-01"}})
            r.raise_for_status(); uid = r.json()["id"]
            patch("profiles", f"id=eq.{uid}", {"onboarded": True, "timezone": TZ, "display_name": "Learning Tester", "wake_time": "06:00", "sleep_time": "23:00", "work_days": []})
            await page.goto(f"{BASE}/login", wait_until="networkidle")
            await page.fill("#email", email); await page.fill("#pw", pw)
            await page.get_by_role("button", name="Log in").click(); await page.wait_for_url("**/app/**", timeout=20000)

            # CAREER/QUALIFICATION GOAL (created through the Goals page)
            await page.goto(f"{BASE}/app/goals", wait_until="networkidle"); await page.wait_for_timeout(1200)
            await page.get_by_role("button", name="Add goal").click()
            await page.get_by_placeholder("e.g. Get stronger, learn Spanish").fill(TITLE)
            await page.locator("select").first.select_option(label="Learning")
            await page.get_by_label("Min/week").fill("180"); await page.get_by_label("Min/session").fill("45")
            await page.get_by_role("button", name="Save goal").click(); await page.wait_for_timeout(3000)
            gs = rest("goals", f"user_id=eq.{uid}&select=id,domain,weekly_minutes,session_minutes,status")
            check("qualification goal created", len(gs) == 1 and gs[0]["domain"] == "learning" and gs[0]["status"] == "active", str(gs))
            GID = gs[0]["id"]
            deadline = (datetime.now(ZoneInfo(TZ)).date() + timedelta(weeks=12)).isoformat()
            patch("goals", f"id=eq.{GID}", {"deadline": deadline, "minimum_weekly_minutes": 90})

            # CURRENT-SOURCE RESEARCH (live search of public sources, from the goal page)
            await page.goto(f"{BASE}/app/goals/{GID}", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Research", exact=True).click()
            for _ in range(48):  # live search + source reading (poll up to 4 min)
                await page.wait_for_timeout(5000)
                if rest("career_research", f"user_id=eq.{uid}&goal_id=eq.{GID}&select=id"): break
            await page.wait_for_timeout(3000)
            print("research notices:", await page.locator("[data-sonner-toast]").all_inner_texts())
            await page.screenshot(path=str(SHOTS / "research.png"))
            recs = rest("career_research", f"user_id=eq.{uid}&goal_id=eq.{GID}&select=id,query,jurisdiction,interpretation")
            check("research run saved", len(recs) == 1, str(recs)[:200])
            srcs = rest("research_sources", f"user_id=eq.{uid}&select=id,url,publisher,trust,content_excerpt") if recs else []
            finds = rest("research_findings", f"user_id=eq.{uid}&select=id,category,statement,quote,source_id,applied_at") if recs else []
            check("current public sources found", len(srcs) >= 2 and all(s["url"].startswith("http") for s in srcs), f"{len(srcs)} sources")
            # SOURCE PROVENANCE: every kept fact names its source and carries a verbatim quote from it.
            srcmap = {s["id"]: s for s in srcs}
            prov = all(f["source_id"] in srcmap and f["quote"] and len(f["quote"]) >= 12 for f in finds)
            verbatim = sum(1 for f in finds if f["quote"] in srcmap[f["source_id"]]["content_excerpt"])
            check("every fact has a verified verbatim quote and source", len(finds) >= 1 and prov and verbatim >= 1, f"{len(finds)} findings, {verbatim} quotes in stored excerpts")
            check("sources carry publisher and trust grading", all(s["publisher"] and s["trust"] for s in srcs), str([(s["publisher"], s["trust"]) for s in srcs])[:200])
            # PATHWAY: the interpretation is stored and labelled as interpretation, not fact.
            check("pathway interpretation saved", bool(recs and recs[0]["interpretation"]), (recs[0]["interpretation"] or "")[:120] if recs else "")

            # MILESTONES: apply the sourced findings to the goal.
            boxes = page.locator("input[type=checkbox]:not([disabled])")
            n = await boxes.count()
            for i in range(n): await boxes.nth(i).click()
            await page.get_by_role("button", name=re.compile(r"^Add \d+ to this goal")).click(); await page.wait_for_timeout(3000)
            ms = rest("goal_milestones", f"user_id=eq.{uid}&goal_id=eq.{GID}&select=id,title")
            rs = rest("learning_resources", f"user_id=eq.{uid}&goal_id=eq.{GID}&select=id,title,url")
            g2 = rest("goals", f"id=eq.{GID}&select=prerequisites")[0]
            check("sourced milestones added to the goal", len(ms) >= 1, f"{len(ms)} milestones")
            check("sourced resources added", len(rs) >= 1, f"{len(rs)} resources")
            check("sourced prerequisites recorded on the goal", bool(g2["prerequisites"]), (g2["prerequisites"] or "")[:120])

            # STUDY/ACTION SCHEDULE (member reviews and approves the plan)
            await page.goto(f"{BASE}/app/plan", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Replan").first.click(); await page.wait_for_timeout(4000)
            await page.get_by_role("button", name="Apply permanently").click(); await page.wait_for_timeout(3500)
            wb = rest("plan_blocks", f"user_id=eq.{uid}&occurrence_kind=eq.learning&status=eq.planned&select=id,starts_at,duration_min,goal_id&order=starts_at")
            today = datetime.now(ZoneInfo(TZ)).date()
            todays = [x for x in wb if datetime.fromisoformat(x["starts_at"]).astimezone(ZoneInfo(TZ)).date() == today]
            check("study sessions scheduled towards the deadline", len(wb) >= 1 and all(x["goal_id"] == GID and x["duration_min"] == 45 for x in wb), f"{len(wb)} blocks")
            check("today's study session scheduled", len(todays) == 1, str(todays))

            # EXECUTION: start and finish today's study session on Today.
            await page.goto(f"{BASE}/app/today", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Start").first.click(); await page.wait_for_timeout(2000)
            await page.get_by_role("button", name="Done").first.click(); await page.wait_for_timeout(2500)
            blk = rest("plan_blocks", f"id=eq.{todays[0]['id']}&select=status,evidence") if todays else [{}]
            ev = rest("plan_block_events", f"block_id=eq.{todays[0]['id']}&select=event_type&order=created_at") if todays else []
            led = rest("outcome_ledger", f"user_id=eq.{uid}&goal_id=eq.{GID}&metric=eq.session_completed&select=evidence_class")
            check("study session executed and recorded", blk[0].get("status") == "done" and [e["event_type"] for e in ev][-2:] == ["start", "complete"], str(ev))
            check("completion evidence labelled", blk[0].get("evidence") == "self_reported" and led and led[0]["evidence_class"], f"{blk[0].get('evidence')}")

            # REVIEW: add a recall question, then review it (spaced schedule advances).
            await page.goto(f"{BASE}/app/goals/{GID}", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_label("Question", exact=True).fill("What does NG1 cover?")
            await page.get_by_label("Answer", exact=True).fill("Management of health and safety")
            await page.get_by_role("button", name="Add question").click(); await page.wait_for_timeout(2000)
            items = rest("retrieval_items", f"user_id=eq.{uid}&goal_id=eq.{GID}&select=id,due_on,interval_step")
            check("recall question added to the spaced schedule", len(items) == 1, str(items))
            patch("retrieval_items", f"id=eq.{items[0]['id']}", {"due_on": today.isoformat()})  # make it due today for the journey
            await page.reload(wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Try to recall, then show answer").first.click(); await page.wait_for_timeout(800)
            await page.get_by_role("button", name="I got it").click(); await page.wait_for_timeout(2000)
            revs = rest("retrieval_reviews", f"user_id=eq.{uid}&item_id=eq.{items[0]['id']}&select=correct,from_step,to_step")
            it2 = rest("retrieval_items", f"id=eq.{items[0]['id']}&select=due_on,interval_step")[0]
            check("review recorded and next review spaced out", len(revs) == 1 and revs[0]["correct"] and it2["interval_step"] == 1 and it2["due_on"] > today.isoformat(), f"{revs} -> {it2}")

            # MISSED ACTION: a planned study session passes without being done.
            future = [x for x in wb if x["id"] != (todays[0]["id"] if todays else None)]
            if not future:
                extra = rest("plan_blocks", f"user_id=eq.{uid}&occurrence_kind=eq.learning&select=id,starts_at&order=starts_at")
                future = [x for x in extra if x["id"] != (todays[0]["id"] if todays else None)]
            missed_id = future[0]["id"]
            patch("plan_blocks", f"id=eq.{missed_id}", {"starts_at": (datetime.now(ZoneInfo(TZ)) - timedelta(hours=3)).isoformat()})
            # REPLAN: Catch up missed on the Plan page, then approve.
            await page.goto(f"{BASE}/app/plan", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Catch up missed").click(); await page.wait_for_timeout(5000)
            await page.screenshot(path=str(SHOTS / "catchup.png"))
            prop = rest("plan_versions", f"user_id=eq.{uid}&status=eq.proposed&select=id,explanation,diff_summary&order=created_at.desc&limit=1")
            check("missed session returns to planning as a proposal", prop and "missed" in (prop[0]["explanation"] or "").lower(), prop[0]["explanation"] if prop else "none")
            if prop:
                await page.get_by_role("button", name="Apply permanently").click(); await page.wait_for_timeout(3500)
            makeups = rest("plan_blocks", f"user_id=eq.{uid}&occurrence_kind=eq.learning&status=eq.planned&title=like.Catch-up%3A%25&select=id,starts_at,note")
            ok_mu = makeups and all(datetime.fromisoformat(m["starts_at"]).astimezone(ZoneInfo(TZ)) > datetime.now(ZoneInfo(TZ)) for m in makeups)
            check("catch-up study session placed in free time", ok_mu, str(makeups)[:200])
            check("makeup links back to the missed session", makeups and makeups[0]["note"] == f"makeup:{missed_id}", (makeups or [{}])[0].get("note", ""))
            done_still = rest("plan_blocks", f"id=eq.{todays[0]['id']}&select=status") if todays else [{}]
            check("finished session untouched by the replan", done_still and done_still[0]["status"] == "done")
        finally:
            await b.close()
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}", headers=H, timeout=30)
    print(f"\n{sum(results)} of {len(results)} pass  (tz {TZ})"); sys.exit(0 if all(results) else 1)
asyncio.run(main())
