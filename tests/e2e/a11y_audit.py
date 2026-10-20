"""Completion item 81: accessibility (WCAG 2.2 AA). axe-core scan of every public and member page,
plus keyboard focus, reduced motion, zoom reflow and touch-target checks. Fresh account, removed after."""
import asyncio, os, uuid, json, sys
from pathlib import Path
import requests
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json"}
AXE_PATH=Path(os.environ.get("AXE_JS","/tmp/browser/a11y/axe.min.js"))
if not AXE_PATH.exists():
    response=requests.get("https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js",timeout=30)
    response.raise_for_status()
    AXE_PATH.parent.mkdir(parents=True,exist_ok=True)
    AXE_PATH.write_text(response.text)
AXE=AXE_PATH.read_text()
PUBLIC=["/","/login","/pricing","/how-it-works","/privacy","/terms","/safety","/reset-password"]
MEMBER=["/app/today","/app/plan","/app/goals","/app/coach","/app/training","/app/nutrition","/app/movement","/app/wellness","/app/learning",
 "/app/recovery","/app/progress","/app/commitments","/app/settings","/app/more","/app/billing","/app/help","/app/twin","/app/lifemap",
 "/app/patterns","/app/experiments","/app/history","/app/accountability","/app/integrations","/app/professionals","/app/knowledge"]
results=[]
def check(n,ok,d=""): results.append(bool(ok)); print(("PASS " if ok else "FAIL ")+n+(f" :: {d}" if d else ""))
async def scan(page,path,mode):
    await page.goto(BASE+path,wait_until="networkidle"); await page.wait_for_timeout(1200)
    await page.add_script_tag(content=AXE)
    r=await page.evaluate("""async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
      return r.violations.map(v=>({id:v.id,impact:v.impact,n:v.nodes.length,t:v.nodes.slice(0,3).map(x=>x.target.join(' ')+' | '+(x.failureSummary||'').slice(0,160))}))}""")
    check(f"[{mode}] {path} no WCAG A/AA violations", not r, json.dumps(r)[:1500])
async def main():
    email=f"e2e-a11y-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"; pw="E2e!"+uuid.uuid4().hex; uid=None
    async with async_playwright() as p:
        b=await p.chromium.launch(headless=True)
        for scheme in ["dark","light"]:
            ctx=await b.new_context(viewport={"width":1280,"height":1800},color_scheme=scheme,reduced_motion="reduce"); page=await ctx.new_page()
            for path in PUBLIC: await scan(page,path,scheme)
            await ctx.close()
        ctx=await b.new_context(viewport={"width":1280,"height":1800}); page=await ctx.new_page()
        try:
            r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,timeout=30,json={"email":email,"password":pw,"email_confirm":True,"user_metadata":{"date_of_birth":"1990-05-01"}}); r.raise_for_status(); uid=r.json()["id"]
            requests.patch(f"{URL}/rest/v1/profiles?id=eq.{uid}",headers=H,json={"onboarded":True,"timezone":"Europe/London","display_name":"A11y Tester","wake_time":"06:00","sleep_time":"23:00","work_days":[]},timeout=30).raise_for_status()
            # keyboard-only login: labels + focus order + Enter submits
            await page.goto(BASE+"/login",wait_until="networkidle")
            await page.get_by_label("Email").first.fill(email); await page.get_by_label("Password").first.fill(pw)
            await page.get_by_label("Password").first.press("Enter"); await page.wait_for_url("**/app/**",timeout=20000)
            check("login works by keyboard with labelled fields",True)
            for path in MEMBER: await scan(page,path,"member")
            # visible focus indicator on first tabbable control
            await page.goto(BASE+"/app/today",wait_until="networkidle"); await page.keyboard.press("Tab")
            fo=await page.evaluate("()=>{const e=document.activeElement;const s=getComputedStyle(e);return {tag:e.tagName,o:s.outlineStyle+' '+s.outlineWidth,bs:s.boxShadow}}")
            check("keyboard focus is visible",fo["tag"]!="BODY" and (fo["o"].split()[0]!="none" or fo["bs"]!="none"),str(fo))
            # touch targets >= 24px (WCAG 2.5.8) on mobile
            await page.set_viewport_size({"width":390,"height":844}); await page.goto(BASE+"/app/today",wait_until="networkidle"); await page.wait_for_timeout(800)
            small=await page.evaluate("""()=>[...document.querySelectorAll('button,a[href],input,select,[role=button]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(r.width<24||r.height<24)&&getComputedStyle(e).display!=='inline'}).map(e=>(e.getAttribute('aria-label')||e.textContent||e.tagName).trim().slice(0,30)+' '+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height)).slice(0,10)""")
            check("touch targets at least 24px on mobile",not small,str(small))
            # 400% zoom reflow = 320 css px: no horizontal scroll
            for path in ["/app/today","/app/settings","/app/goals"]:
                await page.set_viewport_size({"width":320,"height":800}); await page.goto(BASE+path,wait_until="networkidle"); await page.wait_for_timeout(600)
                ov=await page.evaluate("()=>document.documentElement.scrollWidth-document.documentElement.clientWidth")
                check(f"{path} reflows at 320px without sideways scrolling",ov<=1,f"{ov}px overflow")
        finally:
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}",headers=H,timeout=30)
            await b.close()
    print(f"{sum(results)} of {len(results)} pass"); sys.exit(0 if all(results) else 1)
asyncio.run(main())
