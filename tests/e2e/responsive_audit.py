"""Completion item 82: responsive UX. Every critical route at mobile (390), tablet (768) and desktop (1280):
no sideways scrolling, no controls cut off past the screen edge, tap targets usable on touch sizes,
and navigation reachable and working. Fresh account, removed afterwards."""
import asyncio, os, uuid, sys
from pathlib import Path
import requests
from playwright.async_api import async_playwright
BASE="http://localhost:8080"; URL=os.environ["SUPABASE_URL"]; SR=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H={"apikey":SR,"Authorization":f"Bearer {SR}","Content-Type":"application/json"}
SHOTS=Path("/tmp/browser/resp"); SHOTS.mkdir(parents=True,exist_ok=True)
SIZES={"mobile":(390,844),"tablet":(768,1024),"desktop":(1280,900)}
PUBLIC=["/","/login","/pricing","/how-it-works","/privacy","/terms","/safety"]
MEMBER=["/app/today","/app/plan","/app/goals","/app/coach","/app/training","/app/nutrition","/app/movement","/app/wellness","/app/learning",
 "/app/recovery","/app/progress","/app/commitments","/app/settings","/app/more","/app/billing","/app/help","/app/twin","/app/lifemap",
 "/app/patterns","/app/experiments","/app/history","/app/accountability","/app/integrations","/app/professionals","/app/knowledge","/app/admin"]
results=[]
def check(n,ok,d=""): results.append(bool(ok)); print(("PASS " if ok else "FAIL ")+n+(f" :: {d}" if d else ""))
PROBE="""(w)=>{const de=document.documentElement;const over=de.scrollWidth-de.clientWidth;
 const clipped=[...document.querySelectorAll('button,a[href],input,select,textarea,h1,h2,h3')].filter(e=>{const r=e.getBoundingClientRect();
   if(!r.width||!r.height)return false; let p=e.parentElement; while(p){const s=getComputedStyle(p); if(/(auto|scroll)/.test(s.overflowX)&&p.scrollWidth>p.clientWidth)return false; p=p.parentElement}
   return r.right>w+1||r.left<-1}).map(e=>(e.getAttribute('aria-label')||e.textContent||e.tagName).trim().slice(0,30)).slice(0,6);
 const T=[...document.querySelectorAll('button,a[href],input:not([type=hidden]):not([aria-hidden=true]),select,[role=button],[role=switch]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0});
 // WCAG 2.5.8: under 24px passes only if a 24px circle on its centre overlaps no other target.
 const small=w<1000?T.filter(e=>{const r=e.getBoundingClientRect(); if(r.width>=24&&r.height>=24) return false; if(e.closest('p,li')&&getComputedStyle(e).display==='inline') return false;
   const cx=r.left+r.width/2, cy=r.top+r.height/2;
   return T.some(o=>{if(o===e||o.contains(e)||e.contains(o))return false;const q=o.getBoundingClientRect();const dx=Math.max(q.left-cx,0,cx-q.right),dy=Math.max(q.top-cy,0,cy-q.bottom);return Math.hypot(dx,dy)<12})})
   .map(e=>(e.getAttribute('aria-label')||e.textContent||e.tagName).trim().slice(0,25)+' '+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height)).slice(0,6):[];
 return {over,clipped,small}}"""
async def audit(page,path,size):
    w,h=SIZES[size]; await page.set_viewport_size({"width":w,"height":h})
    await page.goto(BASE+path,wait_until="networkidle"); await page.wait_for_timeout(900)
    r=await page.evaluate(PROBE,w)
    ok=r["over"]<=1 and not r["clipped"] and not r["small"]
    if not ok or size=="mobile": await page.screenshot(path=str(SHOTS/f"{size}{path.replace('/','_')}.png"))
    check(f"[{size}] {path} fits",ok,str(r))
async def main():
    email=f"e2e-resp-{uuid.uuid4().hex[:10]}@plexecute-test.invalid"; pw="E2e!"+uuid.uuid4().hex; uid=None
    async with async_playwright() as p:
        b=await p.chromium.launch(headless=True); page=await (await b.new_context(viewport={"width":1280,"height":900})).new_page()
        try:
            for path in PUBLIC:
                for s in SIZES: await audit(page,path,s)
            r=requests.post(f"{URL}/auth/v1/admin/users",headers=H,timeout=30,json={"email":email,"password":pw,"email_confirm":True,"user_metadata":{"date_of_birth":"1990-05-01"}}); r.raise_for_status(); uid=r.json()["id"]
            requests.patch(f"{URL}/rest/v1/profiles?id=eq.{uid}",headers=H,json={"onboarded":True,"timezone":"Europe/London","display_name":"Resp Tester","wake_time":"06:00","sleep_time":"23:00","work_days":[]},timeout=30).raise_for_status()
            await page.goto(BASE+"/login",wait_until="networkidle"); await page.fill("#email",email); await page.fill("#pw",pw)
            await page.get_by_role("button",name="Log in").click(); await page.wait_for_url("**/app/**",timeout=20000)
            for path in MEMBER:
                for s in SIZES: await audit(page,path,s)
            # navigation works at every size: reach Plan, then More, from Today using visible links only
            for s,(w,h) in SIZES.items():
                await page.set_viewport_size({"width":w,"height":h}); await page.goto(BASE+"/app/today",wait_until="networkidle")
                ok=True
                for target in ["/app/plan","/app/more"]:
                    links=page.locator(f'a[href="{target}"]:visible')
                    if await links.count()==0: ok=False; break
                    await links.first.click(); await page.wait_for_url(f"**{target}",timeout=8000)
                check(f"[{s}] navigation reaches Plan and More",ok and page.url.endswith("/app/more"),page.url)
        finally:
            if uid: requests.delete(f"{URL}/auth/v1/admin/users/{uid}",headers=H,timeout=30)
            await b.close()
    print(f"{sum(results)} of {len(results)} pass"); sys.exit(0 if all(results) else 1)
asyncio.run(main())
