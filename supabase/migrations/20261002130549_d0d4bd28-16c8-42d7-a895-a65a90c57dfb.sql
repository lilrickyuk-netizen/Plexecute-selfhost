CREATE TABLE public.call_market_manifest (
  country text PRIMARY KEY CHECK (country ~ '^([A-Z]{2}|GLOBAL)$'),
  enabled boolean NOT NULL DEFAULT false,
  killed boolean NOT NULL DEFAULT false,
  signed_off_by text NULL,
  signed_off_at timestamptz NULL,
  review_ref text NULL,
  permitted_start time NULL,
  permitted_end time NULL,
  consent_version text NULL,
  disclosure_version text NULL,
  max_attempts_per_occurrence integer NULL CHECK (max_attempts_per_occurrence IS NULL OR max_attempts_per_occurrence BETWEEN 1 AND 6),
  max_per_24h integer NULL CHECK (max_per_24h IS NULL OR max_per_24h BETWEEN 1 AND 12),
  pro_retry_allowed boolean NOT NULL DEFAULT true,
  min_answer_rate numeric NULL CHECK (min_answer_rate IS NULL OR (min_answer_rate >= 0 AND min_answer_rate <= 1)),
  notes text NULL,
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR (signed_off_by IS NOT NULL AND signed_off_at IS NOT NULL AND review_ref IS NOT NULL AND consent_version IS NOT NULL AND disclosure_version IS NOT NULL AND permitted_start IS NOT NULL AND permitted_end IS NOT NULL))
);
GRANT ALL ON public.call_market_manifest TO service_role;
ALTER TABLE public.call_market_manifest ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER call_market_manifest_touch BEFORE UPDATE ON public.call_market_manifest FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
INSERT INTO public.call_market_manifest (country, enabled, killed, notes) VALUES ('GLOBAL', false, false, 'Global kill switch row. killed=true stops every automated call in every market.');