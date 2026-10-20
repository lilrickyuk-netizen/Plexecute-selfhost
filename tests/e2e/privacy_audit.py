"""Completion item 98: privacy audit. Consent, withdrawal, export, delete, retention, integration revocation,
professional sharing/revoke, analytics privacy and AI/privacy boundaries, exercised signed in against the real
server functions and database. Run: python3 tests/e2e/privacy_audit.py"""
import asyncio, os, uuid, sys, json, datetime
import requests
from playwright.async_api import async_playwright
BASE = "http://localhost:8080"; URL = os.environ["SUPABASE_URL"]; SR = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": SR, "Authorization": f"Bearer {SR}", "Content-Type": "application/json", "Prefer": "return=representation"}
res = []
def check(n, ok, d=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + n + (f" :: {str(d)[:200]}" if d and not ok else ""))
def rest(m, path, body=None): r = requests.request(m, f"{URL}/rest/v1/{path}", headers=H, json=body, timeout=30); return r.json() if r.text else None
def mk(tier="pro"):
    e = f"e2e-r98-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"; pw = "E2e!" + uuid.uuid4().hex
    r = requests.post(f"{URL}/auth/v1/admin/users", headers=H, timeout=30, json={"email": e, "password": pw, "email_confirm": True, "user_metadata": {"date_of_birth": "1990-05-01"}}); r.raise_for_status(); uid = r.json()["id"]
    rest("PATCH", f"profiles?id=eq.{uid}", {"onboarded": True, "timezone": "Europe/London", "display_name": "Privacy Tester", "wake_time": "06:00", "sleep_time": "23:00", "work_days": [1, 2, 3, 4, 5], "tier": tier})
    return uid, e, pw
CALL = """async ([mod, fn, data]) => { try { const m = await import(mod); const r = await m[fn](data === null ? undefined : { data }); return { ok: true, r: typeof r === 'string' ? r : JSON.stringify(r ?? null) }; } catch (e) { return { ok: false, r: String(e && e.message || e).slice(0,300) }; } }"""
async def login(b, e, pw):
    ctx = await b.new_context(viewport={"width": 1280, "height": 900}); page = await ctx.new_page()
    await page.goto(BASE + "/login", wait_until="networkidle"); await page.fill("#email", e); await page.fill("#pw", pw)
    await page.get_by_role("button", name="Log in").click(); await page.wait_for_url("**/app/**", timeout=20000)
    return ctx, page
async def call(page, mod, fn, data=None): return await page.evaluate(CALL, [f"/src/lib/{mod}.functions.ts", fn, data])
def consents(uid, purpose): return rest("GET", f"consent_records?user_id=eq.{uid}&purpose=eq.{purpose}&select=action,scope,provider&order=occurred_at") or []

async def main():
    users = []
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        try:
            a, ae, apw = mk("pro"); pro, pe, ppw = mk("free"); other, _, _ = mk("free"); users += [a, pro, other]
            rest("POST", "goals", {"user_id": other, "title": "OTHER-USER-SECRET-GOAL", "domain": "fitness", "status": "active"})
            ctx, page = await login(b, ae, apw)

            # 1. Consent: granting health access records a consent with its exact scope
            r = await call(page, "health", "connectHealth", {"platform": "apple_health", "categories": ["steps", "sleep"]})
            conn = json.loads(r["r"]) if r["ok"] else {}
            c = consents(a, "health_data")
            check("consent recorded when health access granted, with categories", r["ok"] and c and c[-1]["action"] == "granted" and set(c[-1]["scope"]) == {"steps", "sleep"}, c or r["r"])
            now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
            ing = lambda kind: requests.post(BASE + "/api/public/health/ingest", timeout=30, headers={"Authorization": f"Bearer {conn.get('key','')}"}, json={"source": "apple_health", "samples": [{"kind": kind, "value": 5000, "recorded_at": now, "provider_event_id": uuid.uuid4().hex}]})
            r1 = ing("steps"); check("granted category accepted", r1.status_code == 200, r1.text)
            r2 = ing("weight_kg"); stored_w = rest("GET", f"health_samples?user_id=eq.{a}&kind=eq.weight_kg&select=id") or []
            check("category never granted is not stored", not stored_w, r2.text)

            # 2. Withdrawal: narrowing then revoking stops ingestion at once and can delete the data
            await call(page, "health", "updateHealthPermissions", {"id": conn["id"], "categories": ["sleep"]})
            ing("steps"); n_steps = len(rest("GET", f"health_samples?user_id=eq.{a}&kind=eq.steps&select=id") or [])
            check("withdrawn category stops being accepted", n_steps == 1, n_steps)
            r = await call(page, "health", "revokeHealth", {"id": conn["id"], "deleteData": True})
            r3 = ing("steps"); left = rest("GET", f"health_samples?user_id=eq.{a}&source=eq.apple_health&select=id") or []
            check("revoked key refused immediately", r3.status_code == 401, r3.status_code)
            check("revoke with delete removes that source's readings", r["ok"] and not left, left)
            check("withdrawal recorded as a consent event", consents(a, "health_data")[-1]["action"] == "withdrawn", consents(a, "health_data")[-1])

            # 3. Integration revocation: wearable tokens are destroyed on disconnect
            wc = rest("POST", "wearable_connections", {"user_id": a, "provider": "oura", "status": "active"})[0]
            rest("POST", "wearable_credentials", {"connection_id": wc["id"], "user_id": a, "access_token": "enc:x", "refresh_token": "enc:y"})
            rest("POST", "health_samples", {"user_id": a, "source": "oura", "kind": "steps", "value": 1, "recorded_at": now, "connection_id": None})
            r = await call(page, "wearables", "disconnectWearableFn", {"id": wc["id"], "deleteData": True})
            creds = rest("GET", f"wearable_credentials?connection_id=eq.{wc['id']}&select=connection_id") or []
            st = (rest("GET", f"wearable_connections?id=eq.{wc['id']}&select=status") or [{}])[0].get("status")
            check("wearable disconnect destroys stored tokens", r["ok"] and not creds, r["r"])
            check("wearable connection marked revoked/disconnected", st in ("revoked", "disconnected"), st)
            check("wearable readings deleted on request", not (rest("GET", f"health_samples?user_id=eq.{a}&source=eq.oura&select=id") or []))
            tok = await page.evaluate("async()=>{const m=await import('/src/integrations/supabase/client.ts');return (await m.supabase.auth.getSession()).data.session.access_token}")
            pk = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY")
            UH = {"apikey": pk, "Authorization": f"Bearer {tok}"}
            for t in ["wearable_credentials", "calendar_credentials", "phone_numbers"]:
                rr = requests.get(f"{URL}/rest/v1/{t}?select=*", headers=UH, timeout=30)
                check(f"member's own browser cannot read {t}", rr.status_code >= 400 or rr.json() == [], rr.status_code)

            # 4. Professional sharing and revoke
            r = await call(page, "professional", "createShare", {"name": "Coach Sam", "role": "COACH", "userAsserted": True, "permissions": ["VIEW_SELECTED_PLAN", "VIEW_SELECTED_PROGRESS"], "healthConsent": []})
            share = json.loads(r["r"]) if r["ok"] else {}
            pc = consents(a, "professional_sharing"); check("share created with consent record", r["ok"] and pc and pc[-1]["action"] == "granted", r["r"])
            pctx, ppage = await login(b, pe, ppw)
            r = await call(ppage, "professional", "acceptInvite", {"token": share.get("token", "")})
            check("professional accepts invitation", r["ok"] and '"ok":true' in r["r"], r["r"])
            r = await call(ppage, "professional", "getClientView", {"id": share["id"]}); view = r["r"]
            check("professional sees only granted sections", r["ok"] and '"progress"' in view and '"nutrition"' not in view and '"recovery"' not in view and '"training"' not in view, view)
            check("professional view never includes email or other members", ae not in view and "OTHER-USER-SECRET-GOAL" not in view)
            r = await call(ppage, "professional", "acceptInvite", {"token": share.get("token", "")})
            check("invitation link works only once", '"ok":false' in r["r"] or not r["ok"], r["r"])
            await call(page, "professional", "updateSharePermissions", {"id": share["id"], "permissions": ["VIEW_SELECTED_PLAN"], "healthConsent": []})
            r = await call(ppage, "professional", "getClientView", {"id": share["id"]})
            check("narrowed permission takes effect on next view", '"progress"' not in r["r"], r["r"])
            await call(page, "professional", "revokeShare", {"id": share["id"]})
            r = await call(ppage, "professional", "getClientView", {"id": share["id"]})
            check("revoked professional loses access at once", not r["ok"] or '"plan"' not in r["r"], r["r"])
            views = rest("GET", f"audit_events?user_id=eq.{a}&action=eq.professional.view&select=id") or []
            check("every professional view is logged for the member", len(views) >= 2, len(views))
            await pctx.close()

            # 5. AI/privacy boundaries: restriction stops every AI feature and automatic plan changes
            await call(page, "privacy", "setProcessingRestriction", {"restricted": True, "reason": "audit"})
            r = await call(page, "coach", "sendCoachMessage", {"message": "Hi"})
            check("restricted: coach does not send data to AI", '"restricted"' in r["r"] or not r["ok"], r["r"])
            r = await call(page, "research", "runResearch", {"goalId": None, "query": "best time of day to study", "jurisdiction": "United Kingdom"})
            check("restricted: research refused before AI", not r["ok"] and "paused AI processing" in r["r"], r["r"])
            r = await call(page, "nutrition", "parseFoodText", {"text": "two eggs"})
            check("restricted: AI food logging refused", not r["ok"] and "paused AI processing" in r["r"], r["r"])
            await call(page, "privacy", "setProcessingRestriction", {"restricted": False})
            check("restriction lift recorded", any(x["action"] == "processing.restriction_lifted" for x in rest("GET", f"audit_events?user_id=eq.{a}&select=action") or []))

            # 6. Export: complete, own data only, no secrets
            rest("POST", "goals", {"user_id": a, "title": "MY-EXPORT-GOAL", "domain": "fitness", "status": "active"})
            r = await call(page, "privacy", "exportMyData", {"kind": "portability"}); ex = r["r"]
            check("export contains own data", r["ok"] and "MY-EXPORT-GOAL" in ex, ex[:200])
            check("export contains no other member's data", "OTHER-USER-SECRET-GOAL" not in ex)
            bad = [k for k in ["enc:x", "token_hash", "invite_token_hash", "access_token", "calendar_token", "health_token", conn.get("key", "zz")] if k in ex]; check("export contains no tokens or key hashes", not bad, [ex[max(0,ex.find(k)-120):ex.find(k)+40] for k in bad])
            check("export includes consent history and retention policy", '"consent_records"' in ex and '"retention_policy"' in ex)

            # 7. Retention: old records are removed by the daily job, recent ones kept
            old = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=400)).isoformat()
            rest("POST", "coach_messages", [{"user_id": a, "role": "user", "content": "OLD-MSG", "created_at": old}, {"user_id": a, "role": "user", "content": "NEW-MSG", "created_at": now}])
            rr = requests.post(f"{URL}/rest/v1/rpc/apply_retention", headers=H, json={}, timeout=60)
            msgs = [m["content"] for m in rest("GET", f"coach_messages?user_id=eq.{a}&select=content") or []]
            check("retention removes coach messages past 12 months", rr.ok and "OLD-MSG" not in msgs and "NEW-MSG" in msgs, msgs)
            r = await call(page, "privacy", "runRetentionNow", None)
            check("members cannot trigger retention runs", not r["ok"] or '"ok":true' not in r["r"], r["r"])
            # member can delete own conversation
            rr = requests.delete(f"{URL}/rest/v1/coach_messages?user_id=eq.{a}", headers=UH, timeout=30)
            check("member can delete their coach conversation", not (rest("GET", f"coach_messages?user_id=eq.{a}&select=id") or []), rr.status_code)

            # 8. Analytics privacy: client error reports are scrubbed before storage
            r = await call(page, "observability", "reportClientError", {"message": f"boom for {ae} token=abc123secretvalue", "route": "/app/today?email=" + ae})
            ev = rest("GET", "error_events?select=message,route&order=created_at.desc&limit=1") or []
            blob = json.dumps(ev)
            check("error reports never store email addresses or tokens", ae not in blob and "abc123secretvalue" not in blob, blob[:300])

            # 9. Delete: full account deletion removes data and sign-in, keeps an anonymous record
            r = await call(page, "billing", "deleteMyAccount", None)
            gone = all(not (rest("GET", f"{t}?user_id=eq.{a}&select=user_id&limit=1") or []) for t in ["goals", "health_connections", "consent_records", "professional_shares", "audit_events", "wearable_connections"])
            prof = rest("GET", f"profiles?id=eq.{a}&select=id") or []
            au = requests.get(f"{URL}/auth/v1/admin/users/{a}", headers=H, timeout=30)
            check("account deletion removes personal data", r["ok"] and gone and not prof, r["r"])
            check("account deletion removes sign-in", au.status_code == 404, au.status_code)
            jobs = rest("GET", "deletion_jobs?select=status,subject_ref&order=requested_at.desc&limit=1") or []
            check("deletion job completed with only a one-way reference", isinstance(jobs, list) and jobs and jobs[0]["status"] == "completed" and a not in json.dumps(jobs), jobs)
            await ctx.close()
        finally:
            for u in users: requests.delete(f"{URL}/auth/v1/admin/users/{u}", headers=H, timeout=30)
            await b.close()
    print(f"{sum(res)} of {len(res)} pass"); sys.exit(0 if all(res) else 1)
asyncio.run(main())
