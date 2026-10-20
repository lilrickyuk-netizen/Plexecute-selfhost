CREATE TABLE public.life_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  goal_id uuid REFERENCES public.goals(id) ON DELETE CASCADE,
  link_key text NOT NULL,
  from_kind text NOT NULL,
  from_ref text NOT NULL,
  to_kind text NOT NULL,
  to_ref text NOT NULL,
  relation text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  UNIQUE (user_id, link_key)
);
GRANT SELECT ON public.life_links TO authenticated;
GRANT ALL ON public.life_links TO service_role;
ALTER TABLE public.life_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own links readable" ON public.life_links FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX life_links_user_live ON public.life_links (user_id) WHERE invalidated_at IS NULL;

CREATE TABLE public.intelligence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('multi_domain','daily_brief','weekly_review','signal_generated','signal_accepted','conflict_detected','pattern_detected','pathway_confidence','goal_behind','blocker_open')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.intelligence_events TO authenticated;
GRANT ALL ON public.intelligence_events TO service_role;
ALTER TABLE public.intelligence_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own intelligence events readable" ON public.intelligence_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX intelligence_events_kind_time ON public.intelligence_events (kind, created_at);

ALTER TABLE public.plan_versions ADD COLUMN IF NOT EXISTS rationale jsonb;

CREATE OR REPLACE FUNCTION public.owner_intelligence(_from timestamptz, _to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'multiDomain', (SELECT count(*) FROM intelligence_events WHERE kind='multi_domain' AND created_at BETWEEN _from AND _to),
    'dailyBriefs', (SELECT count(*) FROM intelligence_events WHERE kind='daily_brief' AND created_at BETWEEN _from AND _to),
    'weeklyReviews', (SELECT count(*) FROM intelligence_events WHERE kind='weekly_review' AND created_at BETWEEN _from AND _to),
    'signals', (SELECT count(*) FROM intelligence_events WHERE kind='signal_generated' AND created_at BETWEEN _from AND _to),
    'signalsAccepted', (SELECT count(*) FROM intelligence_events WHERE kind='signal_accepted' AND created_at BETWEEN _from AND _to),
    'conflicts', (SELECT count(DISTINCT user_id) FROM intelligence_events WHERE kind='conflict_detected' AND created_at BETWEEN _from AND _to),
    'goalsBehind', (SELECT count(DISTINCT user_id) FROM intelligence_events WHERE kind='goal_behind' AND created_at BETWEEN _from AND _to),
    'blockers', (SELECT count(DISTINCT user_id) FROM intelligence_events WHERE kind='blocker_open' AND created_at BETWEEN _from AND _to),
    'confidence', COALESCE((SELECT jsonb_object_agg(lvl, n) FROM (SELECT detail->>'level' lvl, count(*) n FROM intelligence_events WHERE kind='pathway_confidence' AND created_at BETWEEN _from AND _to GROUP BY 1) c), '{}'::jsonb),
    'failureReasons', COALESCE((SELECT jsonb_object_agg(cause, n) FROM (SELECT detail->>'cause' cause, count(*) n FROM intelligence_events WHERE kind='pattern_detected' AND created_at BETWEEN _from AND _to GROUP BY 1) c), '{}'::jsonb),
    'goalDomains', COALESCE((SELECT jsonb_object_agg(domain, n) FROM (SELECT domain, count(*) n FROM goals WHERE status IN ('active','proposed') GROUP BY 1) g), '{}'::jsonb)
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.owner_intelligence(timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_intelligence(timestamptz, timestamptz) TO authenticated;