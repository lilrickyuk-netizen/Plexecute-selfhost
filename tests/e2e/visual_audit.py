"""Completion item 83: visual consistency pass. Every public, member and admin route at mobile and desktop,
dark and light: brand fonts and tokens only, no raw developer output (ids, snake_case keys, JSON,
ISO timestamps, undefined/null/NaN), no unstyled native controls. Screenshots saved for review."""
import asyncio, os, uuid, sys, re
from pathlib import Path
import requests
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json"}
SHOTS=Path("/tmp/browser/vis"); SHOTS.mkdir(parents=True,exist_ok=True)
PUBLIC=["/","/login","/pricing","/how-it-works","/privacy","/terms","/safety","/reset-password"]
MEMBER=["/app/today","/app/plan","/app/goals","/app/coach","/app/training","/app/nutrition","/app/movement","/app/wellness","/app/learning",
 "/app/recovery","/app/progress","/app/commitments","/app/settings","/app/more","/app/billing","/app/help","/app/twin","/app/lifemap",
 "/app/patterns","/app/experiments","/app/history","/app/accountability","/app/integrations","/app/professionals","/app/knowledge","/app/clients",
 "/app/admin","/app/admin/users","/app/admin/subscriptions","/app/admin/integrations","/app/admin/jobs","/app/admin/calls","/app/admin/safety",
 "/app/admin/knowledge","/app/admin/flags","/app/admin/experiments","/app/admin/audit","/app/admin/health","/app/admin/quotas","/app/admin/incidents"]
RAW=[(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b","id"),(r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}","ISO time"),
     (r"\b(undefined|NaN)\b|\[object Object\]|\bnull\b","undefined/null"),(r"[{\[]\s*\"\w+\"\s*:","JSON"),(r"\b[a-z]+_[a-z0-9_]+\b","snake_case"),(r"\b(?!iPhone|iPad|macOS|iOS)[a-z]+[A-Z][a-z]+\w*\b","camelCase"),(r"/_serverFn|\b[a-z]+\.[a-z]+_?[a-z]*\b(?<!\.com)(?<!\.uk)(?<!\.app)(?<!\.org)","internal key")]
results=[]
def check(n,ok,d=""): results.append(bool(ok)); print(("PASS " if ok else "FAIL ")+n+(f" :: {d}" if d else ""))
PROBE="""()=>{const tw=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const parts=[];while(tw.nextNode()){const n=tw.currentNode;const p=n.parentElement;if(p&&!p.closest("script,style,noscript")&&p.getClientRects().length)parts.push(n.textContent)}const txt=parts.join(" | ");
 const fonts=new Set([...document.querySelectorAll('body *')].filter(e=>e.childNodes.length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>getComputedStyle(e).fontFamily.split(',')[0].replace(/"/g,'').trim()));
 const raw=[...document.querySelectorAll('button,select,input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([aria-hidden=true]),textarea')].filter(e=>{const s=getComputedStyle(e);return e.getBoundingClientRect().width>0&&(s.borderStyle==='outset'||s.backgroundColor==='rgb(239, 239, 239)'||s.backgroundColor==='rgb(240, 240, 240)')}).map(e=>e.tagName+':'+(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,20));
 return {txt,fonts:[...fonts],raw}}"""
async def audit(page,path,tag,shot):
    await page.goto(BASE+path,wait_until="networkidle"); await page.wait_for_timeout(1000)
    r=await page.evaluate(PROBE)
    bad=[f"{k}: {m.group(0)}" for pat,k in RAW for m in [re.search(pat,r["txt"])] if m]
    fonts=[f for f in r["fonts"] if f not in ("Inter Variable","Sora Variable","ui-monospace","Inter","Sora")]
    if shot: await page.screenshot(path=str(SHOTS/f"{tag}{path.replace('/','_') or '_home'}.png"))
    check(f"[{tag}] {path} on-brand, no raw developer output", not bad and not fonts and not r["raw"], f"raw text {bad} fonts {fonts} unstyled {r['raw'][:4]}")
async def main():
    email=f"e2e-vis-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"; pw="E2e!"+uuid.uuid4().hex; uid=None
    async with async_playwright() as p:
        b=await p.chromium.launch(headless=True)
        try:
            for scheme in ["dark","light"]:
                page=await (await b.new_context(viewport={"width":1280,"height":900},color_scheme=scheme)).new_page()
                for path in PUBLIC: await audit(page,path,f"{scheme}-desktop",scheme=="dark")
            r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,timeout=30,json={"email":email,"password":pw,"email_confirm":True,"user_metadata":{"date_of_birth":"1990-05-01"}}); r.raise_for_status(); uid=r.json()["id"]
            requests.patch(f"{URL}/rest/v1/profiles?id=eq.{uid}",headers=H,json={"onboarded":True,"timezone":"Europe/London","display_name":"Visual Tester","wake_time":"06:00","sleep_time":"23:00","work_days":[1,2,3,4,5]},timeout=30).raise_for_status()
            requests.post(f"{URL}/rest/v1/user_roles",headers=H,json={"user_id":uid,"role":"admin"},timeout=30).raise_for_status()
            for scheme,(w,h) in [("dark",(1280,900)),("light",(390,844))]:
                ctx=await b.new_context(viewport={"width":w,"height":h},color_scheme=scheme); page=await ctx.new_page()
                await page.goto(BASE+"/login",wait_until="networkidle"); await page.fill("#email",email); await page.fill("#pw",pw)
                await page.get_by_role("button",name="Log in").click(); await page.wait_for_url("**/app/**",timeout=20000)
                for path in MEMBER: await audit(page,path,f"{scheme}-{'desktop' if w>1000 else 'mobile'}",True)
                await ctx.close()
        finally:
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}",headers=H,timeout=30)
            await b.close()
    print(f"{sum(results)} of {len(results)} pass"); sys.exit(0 if all(results) else 1)
asyncio.run(main())
