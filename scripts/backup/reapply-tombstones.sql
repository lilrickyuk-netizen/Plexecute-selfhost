-- Step 87 / spec §87: re-apply deletion tombstones to RESTORED data.
-- Before running: load every completed deletion from the most recent source (live deletion_jobs or the
-- tombstone export kept outside the backup) into restore_tombstones(subject_ref text).
-- subject_ref = sha256 hex of the member id, exactly as written by deleteAccountJob (no personal data kept).
-- needs pgcrypto (digest) in the extensions schema, as in production.
DO $$
DECLARE t text; n int; total int := 0; ids uuid[];
BEGIN
  SELECT coalesce(array_agg(p.id), '{}') INTO ids FROM public.profiles p
  JOIN restore_tombstones r ON r.subject_ref = encode(extensions.digest(p.id::text, 'sha256'), 'hex');
  -- Every member-owned table (anything with a user_id column), then the profile itself.
  FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables x
           ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
           WHERE c.table_schema = 'public' AND c.column_name = 'user_id' ORDER BY 1 LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
    EXECUTE format('DELETE FROM public.%I WHERE user_id = ANY($1)', t) USING ids;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
  END LOOP;
  DELETE FROM public.profiles WHERE id = ANY(ids);
  RAISE NOTICE 'tombstones reapplied: % members, % rows removed', coalesce(array_length(ids, 1), 0), total;
END $$;
