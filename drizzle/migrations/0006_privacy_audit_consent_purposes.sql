ALTER TABLE public.consent_records DROP CONSTRAINT consent_records_purpose_check;
ALTER TABLE public.consent_records ADD CONSTRAINT consent_records_purpose_check CHECK (
  purpose = ANY (ARRAY['terms_and_privacy','safety_acknowledgement','age_confirmation','health_data','wearable_data','calendar_access',
    'professional_sharing','accountability_calls','calendar_read','calendar_write','email_reminders','phone_calls','professional_share','ai_personalisation'])
  OR purpose LIKE 'auto\_adapt:%');
ALTER TABLE public.audit_events DROP CONSTRAINT audit_events_actor_type_check;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_actor_type_check CHECK (actor_type = ANY (ARRAY['user','system','provider','operator','professional','admin']));