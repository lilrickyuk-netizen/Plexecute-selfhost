#!/usr/bin/env bash
# Step 87 restore drill: back up → restore into an ISOLATED empty database → verify integrity → reapply tombstones.
# Usage: SOURCE_URL=<db url> TARGET="-h <host> -p <port> -U postgres" scripts/backup/restore-drill.sh <workdir>
# Never point TARGET at the live database.
set -euo pipefail
W=${1:-/tmp/drill}; T=${TARGET:?}; S=${SOURCE_URL:?}
here=$(cd "$(dirname "$0")" && pwd)
q() { psql "$S" -Atqc "$1"; }
r() { psql $T -d restore_drill -Atqc "$1"; }

# Checksum every public table: row count + md5 of rows in a stable order.
SUM="select string_agg(format('%s|%s', tablename, (xpath('/row/c/text()', query_to_xml(format('select count(*)||'':''||coalesce(md5(string_agg(t::text, '','' order by t::text)),'''') as c from public.%I t', tablename), false, true, '')))[1]::text), E'\n' order by tablename) from pg_tables where schemaname='public'"

echo "1/5 backup"; t0=$(date +%s)
q "$SUM" > "$W/source.sums"
q "select id from public.profiles" > "$W/ids"
pg_dump "$S" -Fc -n public --no-owner --no-acl -f "$W/backup.dump"
echo "    $(du -h "$W/backup.dump" | cut -f1) in $(( $(date +%s) - t0 ))s"

# Optional: something that happens after the backup (e.g. an account deletion) before restoring.
[ -n "${AFTER_BACKUP:-}" ] && eval "$AFTER_BACKUP"
echo "2/5 restore into empty isolated database"; t1=$(date +%s)
psql $T -qc "drop database if exists restore_drill" -c "create database restore_drill"
r "create schema auth; create schema extensions; create extension pgcrypto schema extensions; create extension \"uuid-ossp\" schema extensions;
   do \$\$ begin create role anon; exception when others then null; end \$\$; do \$\$ begin create role authenticated; exception when others then null; end \$\$;
   do \$\$ begin create role service_role; exception when others then null; end \$\$;
   create table auth.users (id uuid primary key); create function auth.uid() returns uuid language sql as 'select null::uuid';
   create function auth.role() returns text language sql as 'select ''service_role''::text'; create function auth.jwt() returns jsonb language sql as 'select ''{}''::jsonb';"
r "\copy auth.users from '$W/ids'"
pg_restore $T -d restore_drill --no-owner --no-acl "$W/backup.dump" 2> "$W/restore.err" || true
echo "    restored in $(( $(date +%s) - t1 ))s; $(grep -c 'error:' "$W/restore.err" || true) non-data errors (see restore.err)"

echo "3/5 integrity"
r "$SUM" > "$W/restore.sums"
if diff "$W/source.sums" "$W/restore.sums" > "$W/sums.diff"; then echo "    all $(wc -l < "$W/source.sums") tables match row-for-row"
else echo "    MISMATCH:"; cat "$W/sums.diff"; fi

echo "4/5 reapply deletion tombstones"
r "create table restore_tombstones (subject_ref text primary key)"
q "select subject_ref from public.deletion_jobs where status='completed'" > "$W/tombstones"
r "\copy restore_tombstones from '$W/tombstones'"
psql $T -d restore_drill -q -f "$here/reapply-tombstones.sql"

echo "5/5 done in $(( $(date +%s) - t0 ))s total"
