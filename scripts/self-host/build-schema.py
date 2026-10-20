# Rebuilds supabase/self-host/schema-part-*.sql from supabase/migrations + drizzle/migrations.
# Run from the repo root: python3 scripts/self-host/build-schema.py
import os,glob,re
files=sorted(glob.glob('supabase/migrations/*.sql'))+sorted(glob.glob('drizzle/migrations/*.sql'))
SKIP={"INSERT INTO public.user_roles (user_id, role) VALUES ('6421cd71-eea8-4097-87a9-88ed8740b976', 'admin') ON CONFLICT DO NOTHING;":
      "-- Skipped: granted admin to the old Lovable account id. Grant admin to your new account after you sign up (see MIGRATION.md)."}
def clean(t):
    for a,b in SKIP.items(): t=t.replace(a,b)
    return t
parts=[];cur=[];size=0
for f in files:
    t=clean(open(f).read())
    if size+len(t)>190_000 and cur: parts.append(cur);cur=[];size=0
    cur.append((f,t));size+=len(t)
parts.append(cur)
n=len(parts)
for i,p in enumerate(parts,1):
    out=[f"-- Plexecute database setup, part {i} of {n}.",
         "-- Run the parts in order in Supabase → SQL Editor (paste the whole file, click Run).",
         "-- Each part runs as one transaction: if anything fails, nothing in that part is applied.",
         f"-- Contains: {p[0][0]} … {p[-1][0]}","","begin;",""]
    if i==1: out+=["create extension if not exists vector with schema extensions;","create extension if not exists pg_cron;","create extension if not exists pg_net;",""]
    for f,t in p: out+=[f"-- ===== {f} =====",t.rstrip(),""]
    out+=["commit;",""]
    open(f'supabase/self-host/schema-part-{i}.sql','w').write("\n".join(out))
print(n,"parts")
