"""Completion item 74: critical end-to-end test, NUTRITION.

GOAL -> TARGET CALCULATION -> WEEKLY MEAL PLAN -> SHOPPING/PREP -> FOOD LOGGING -> WEIGHT TREND -> ADAPTATION

Fresh account per run (confirmed via the auth admin API), removed afterwards. Every stage is driven through
the real pages. The adaptive stage needs three weeks of history, which a test cannot wait for: after the
starting target is calculated, its date is moved back 8 days and 21 earlier days of weigh-ins and food totals
are added through the service connection, then today's food and weight are logged through the pages.
"""
import asyncio, os, sys, uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
import requests
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
URL = os.environ["SUPABASE_URL"]; SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": SR, "Authorization": f"Bearer {SR}", "Content-Type": "application/json", "Prefer": "return=representation"}
SHOTS = Path("/tmp/browser/j74"); SHOTS.mkdir(parents=True, exist_ok=True)
TZ = "Europe/London"
results = []
def check(n, ok, d=""): results.append(ok := bool(ok)); print(("PASS " if ok else "FAIL ") + n + (f" :: {d}" if d else ""))
def rest(t, q): r = requests.get(f"{URL}/rest/v1/{t}?{q}", headers=H, timeout=30); r.raise_for_status(); return r.json()
def ins(t, body): r = requests.post(f"{URL}/rest/v1/{t}", headers=H, json=body, timeout=30); assert r.ok, r.text; return r.json()
def patch(t, q, body): r = requests.patch(f"{URL}/rest/v1/{t}?{q}", headers=H, json=body, timeout=30); assert r.ok, r.text

async def log_manual(page, slot, name, kcal, protein, grams):
    sec = page.locator("section", has=page.get_by_role("heading", name=slot, exact=False)).filter(has=page.get_by_role("button", name="Add food")).first
    await sec.get_by_role("button", name="Add food").click()
    await page.get_by_role("tab", name="Manual").click()
    await page.get_by_placeholder("Food name").fill(name); await page.get_by_placeholder("kcal").fill(str(kcal)); await page.get_by_placeholder("Protein").fill(str(protein))
    await page.get_by_role("button", name="Next").click()
    await page.get_by_role("dialog").locator("input[type=number]").fill(str(grams)); await page.get_by_role("button", name="Log", exact=True).click()
    await page.locator("div.mb-1\\.5", has_text=name).first.wait_for(timeout=15000)

async def main():
    email = f"e2e-nutri-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"; pw = "E2e!" + uuid.uuid4().hex; uid = None
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        page = await (await b.new_context(viewport={"width": 1280, "height": 1800}, timezone_id=TZ)).new_page()
        page.on("dialog", lambda d: asyncio.ensure_future(d.dismiss() if d.type == "confirm" else d.accept(d.default_value)))
        try:
            r = requests.post(f"{URL}/auth/v1/admin/users", headers=H, timeout=30, json={"email": email, "password": pw, "email_confirm": True, "user_metadata": {"date_of_birth": "1990-05-01"}})
            r.raise_for_status(); uid = r.json()["id"]
            patch("profiles", f"id=eq.{uid}", {"onboarded": True, "timezone": TZ, "display_name": "Nutrition Tester", "date_of_birth": "1990-05-01"})
            await page.goto(f"{BASE}/login", wait_until="networkidle")
            await page.fill("#email", email); await page.fill("#pw", pw)
            await page.get_by_role("button", name="Log in").click(); await page.wait_for_url("**/app/**", timeout=20000)

            # GOAL (Settings: body details + nutrition goal)
            await page.goto(f"{BASE}/app/profile", wait_until="networkidle"); await page.wait_for_timeout(2000)
            def field(label): return page.locator("div.space-y-2", has=page.get_by_text(label, exact=True))
            await page.get_by_role("combobox", name="Sex (for nutrition estimates)", exact=True).select_option("male")
            await field("Height (cm)").locator("input").fill("180")
            await page.get_by_role("combobox", name="Activity level", exact=True).select_option("moderate")
            await page.get_by_role("combobox", name="Nutrition goal", exact=True).select_option("lose")
            await page.get_by_role("button", name="Save", exact=True).first.click(); await page.wait_for_timeout(2000)
            prof = rest("profiles", f"id=eq.{uid}&select=sex,height_cm,nutrition_goal")[0]
            check("nutrition goal and body details saved", prof["nutrition_goal"] == "lose" and prof["sex"] == "male" and float(prof["height_cm"]) == 180, str(prof))

            # First weigh-in on Today, then TARGET CALCULATION on Nutrition
            await page.goto(f"{BASE}/app/today", wait_until="networkidle"); await page.wait_for_timeout(2000)
            ql = page.locator("section,div", has=page.get_by_text("Quick log", exact=True)).filter(has=page.locator("input")).last
            await ql.locator("input").first.fill("90"); await ql.get_by_role("button", name="Save").click(); await page.wait_for_timeout(1500)
            await page.goto(f"{BASE}/app/nutrition", wait_until="networkidle"); await page.wait_for_timeout(3500)
            t1 = rest("nutrition_targets", f"user_id=eq.{uid}&select=id,kcal,protein_g,tdee,method,status,inputs")
            check("starting target calculated by the engine", len(t1) == 1 and t1[0]["status"] == "applied" and t1[0]["method"] == "initial_estimate" and t1[0]["kcal"] < t1[0]["tdee"], str([(x["kcal"], x["tdee"], x["method"]) for x in t1]))
            body = await page.inner_text("body")
            check("target shown on Nutrition", t1 and f"{int(t1[0]['kcal']):,}" in body and "Starting estimate" in body)

            # FOOD LOGGING (server works out nutrients) + saved meals for the plan
            await log_manual(page, "breakfast", "E2E porridge", 150, 5, 300)
            await log_manual(page, "lunch", "E2E chicken rice", 180, 12, 450)
            await log_manual(page, "dinner", "E2E salmon pasta", 200, 10, 450)
            fe = rest("food_entries", f"user_id=eq.{uid}&select=name,kcal,protein_g,grams")
            por = next((x for x in fe if x["name"].startswith("E2E porridge")), None)
            check("food logged with server-calculated nutrients", len(fe) == 3 and por and round(float(por["kcal"])) == 450 and round(float(por["protein_g"])) == 15, str(fe)[:200])
            for slot in ("breakfast", "lunch", "dinner"):
                sec = page.locator("section", has=page.get_by_role("heading", name=slot, exact=False)).filter(has=page.get_by_role("button", name="Save as meal")).first
                await sec.get_by_role("button", name="Save as meal").click(); await page.wait_for_timeout(1200)
            meals = rest("saved_meals", f"user_id=eq.{uid}&select=id,name")
            check("meals saved from logged food", len(meals) == 3, str(meals))

            # WEEKLY MEAL PLAN + SHOPPING/PREP
            await page.reload(wait_until="networkidle"); await page.wait_for_timeout(2500)
            await page.get_by_role("tab", name="Meal planning").click(); await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Build plan").click(); await page.wait_for_timeout(4000)
            await page.screenshot(path=str(SHOTS / "mealplan.png"))
            mp = rest("meal_plans", f"user_id=eq.{uid}&select=id,status,plan,prep_minutes")
            plan = mp[0]["plan"] if mp else {}
            check("weekly meal plan built from saved meals", mp and mp[0]["status"] == "proposed" and len(plan.get("days", [])) >= 1, f"{len(plan.get('days', []))} days")
            body = await page.inner_text("body")
            check("shopping list shown", plan.get("shopping") and "Shopping list" in body, str(plan.get("shopping"))[:150])
            check("batch prep shown", plan.get("prep") and "Batch prep" in body)
            await page.locator("div", has=page.get_by_role("button", name="Reject")).get_by_role("button", name="Approve").last.click(); await page.wait_for_timeout(2500)
            check("member approved the meal plan", rest("meal_plans", f"id=eq.{mp[0]['id']}&select=status")[0]["status"] == "approved")
            prep = rest("goals", f"user_id=eq.{uid}&domain=eq.meal_prep&select=title,weekly_minutes,status")
            check("prep becomes a goal for the planner", len(prep) == 1 and prep[0]["status"] == "active" and prep[0]["weekly_minutes"] > 0, str(prep))
            await page.goto(f"{BASE}/app/plan", wait_until="networkidle"); await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Replan").first.click(); await page.wait_for_timeout(4000)
            await page.get_by_role("button", name="Apply permanently").click(); await page.wait_for_timeout(3500)
            pb = rest("plan_blocks", f"user_id=eq.{uid}&occurrence_kind=eq.meal_prep&select=id,starts_at")
            check("prep scheduled in the approved plan", len(pb) >= 1, f"{len(pb)} prep sessions")

            # Three weeks pass (history added; see module docstring)
            patch("nutrition_targets", f"id=eq.{t1[0]['id']}", {"created_at": (datetime.utcnow() - timedelta(days=8)).isoformat() + "Z"})
            today = datetime.now(ZoneInfo(TZ)).date()
            patch("profiles", f"id=eq.{uid}", {})
            for d in range(1, 22):
                day = (today - timedelta(days=d)).isoformat()
                ins("daily_logs", {"user_id": uid, "kind": "weight", "value": round(90 - (21 - d) * 0.0, 1), "log_date": day})
                ins("food_entries", {"user_id": uid, "name": "History day", "meal_slot": "dinner", "eaten_on": day, "kcal": 3200, "protein_g": 150, "carbs_g": 350, "fat_g": 110, "source": "manual"})

            # WEIGHT TREND: today's weigh-in through the page
            await page.goto(f"{BASE}/app/today", wait_until="networkidle"); await page.wait_for_timeout(2000)
            n_before = len(rest("daily_logs", f"user_id=eq.{uid}&kind=eq.weight&select=id"))
            ql = page.locator("section,div", has=page.get_by_text("Quick log", exact=True)).filter(has=page.locator("input")).last
            await ql.locator("input").first.fill("90"); await ql.get_by_role("button", name="Save").click(); await page.wait_for_timeout(1500)
            check("weigh-in logged", len(rest("daily_logs", f"user_id=eq.{uid}&kind=eq.weight&select=id")) == n_before + 1)
            await page.goto(f"{BASE}/app/nutrition", wait_until="networkidle"); await page.wait_for_timeout(4000)
            await page.screenshot(path=str(SHOTS / "adapt.png"))
            body = await page.inner_text("body")
            check("weight trend shown", "Trend " in body and "kg" in body, body[body.find("Trend "):][:120])

            # ADAPTATION: logs show maintenance is higher than estimated -> proposed change awaits approval
            tg = rest("nutrition_targets", f"user_id=eq.{uid}&select=id,kcal,tdee,method,status,inputs&order=created_at")
            prop = [x for x in tg if x["status"] == "proposed"]
            check("adaptive change proposed, not applied automatically", len(prop) == 1 and prop[0]["method"] == "adaptive" and prop[0]["kcal"] - t1[0]["kcal"] > 150, str([(x["kcal"], x["method"], x["status"]) for x in tg]))
            check("proposal explained on Nutrition", "150 kcal automatic limit" in body)
            check("starting target still in force before approval", any(x["id"] == t1[0]["id"] and x["status"] == "applied" for x in tg))
            await page.get_by_role("button", name="Approve").first.click(); await page.wait_for_timeout(2500)
            tg2 = {x["id"]: x["status"] for x in rest("nutrition_targets", f"user_id=eq.{uid}&select=id,status")}
            check("member approved the new target; old one kept as history", prop and tg2.get(prop[0]["id"]) == "applied" and tg2.get(t1[0]["id"]) == "superseded", str(tg2))
            aud = rest("audit_events", f"user_id=eq.{uid}&action=eq.nutrition.target_approved&select=id")
            check("approval audited", len(aud) == 1)
            await page.reload(wait_until="networkidle"); await page.wait_for_timeout(3000)
            body = await page.inner_text("body")
            check("new target shown as adaptive", prop and f"{int(prop[0]['kcal']):,}" in body and "Adaptive estimate" in body)
        finally:
            await b.close()
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}", headers=H, timeout=30)
    print(f"\n{sum(results)} of {len(results)} pass"); sys.exit(0 if all(results) else 1)
asyncio.run(main())
