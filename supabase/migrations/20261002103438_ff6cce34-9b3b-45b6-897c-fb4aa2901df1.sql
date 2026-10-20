CREATE TABLE public.professional_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  professional_name text NOT NULL CHECK (char_length(professional_name) BETWEEN 1 AND 80),
  role text NOT NULL CHECK (role IN ('PERSONAL_TRAINER','COACH','DIETITIAN_OR_NUTRITION_PROFESSIONAL','PHYSIOTHERAPY_OR_REHAB_PROFESSIONAL','MENTOR','OTHER_USER_NAMED_PROFESSIONAL')),
  credential_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (credential_status IN ('UNVERIFIED','VERIFIED_BY_PLEXECUTE_PROCESS','USER_ASSERTED')),
  permissions text[] NOT NULL DEFAULT '{}',
  health_consent text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','revoked','expired')),
  invite_token_hash text UNIQUE,
  invite_expires_at timestamptz,
  professional_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.professional_shares TO authenticated;
GRANT ALL ON public.professional_shares TO service_role;
ALTER TABLE public.professional_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads shares" ON public.professional_shares FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER professional_shares_touch BEFORE UPDATE ON public.professional_shares FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.professional_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.professional_shares(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author text NOT NULL CHECK (author IN ('user','professional')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.professional_messages TO authenticated;
GRANT ALL ON public.professional_messages TO service_role;
ALTER TABLE public.professional_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads messages" ON public.professional_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.professional_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.professional_shares(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('constraint','plan_change')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  detail text CHECK (char_length(detail) <= 2000),
  schedule jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','blocked','ended')),
  safety_reason text,
  commitment_id uuid REFERENCES public.commitments(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.professional_proposals TO authenticated;
GRANT ALL ON public.professional_proposals TO service_role;
ALTER TABLE public.professional_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads proposals" ON public.professional_proposals FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER professional_proposals_touch BEFORE UPDATE ON public.professional_proposals FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();