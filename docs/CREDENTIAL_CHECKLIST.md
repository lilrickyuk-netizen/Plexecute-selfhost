# Credential checklist (Step 92)

Generated from src/lib/credentials.ts; tests/credential-readiness.test.ts proves every key the code reads is listed and used by real code (no shells). Add values as project secrets — nothing else changes.

## Already in place
- [x] LOVABLE_API_KEY — AI (coach, research, food, questions) (Managed by Lovable Cloud)
- [x] LOVABLE_CRON_SECRET — Scheduled jobs (Managed by Lovable Cloud)
- [x] LOVABLE_CRON_SECRET_PREVIOUS — Scheduled jobs (key rotation) (Managed by Lovable Cloud)
- [x] SUPABASE_URL — Database (Managed by Lovable Cloud)
- [x] SUPABASE_PUBLISHABLE_KEY — Database (Managed by Lovable Cloud)
- [x] SUPABASE_SERVICE_ROLE_KEY — Database (Managed by Lovable Cloud)
- [x] FIRECRAWL_API_KEY — Career research web search (connector) (Managed by Lovable Cloud)
- [x] CALENDAR_STATE_SECRET — Calendar sign-in state (Created automatically)
- [x] WEARABLE_STATE_SECRET — Wearable sign-in state (Created automatically)
- [x] VOICE_STREAM_SECRET — Live voice stream signing (Created automatically)
- [x] PHONE_ENCRYPTION_KEY — Stored phone number encryption (Created automatically)

## Needed from you (real provider credential or approval)

### Public site address for callbacks
- [ ] APP_BASE_URL — Your published domain, e.g. https://plexecute.com

### Payments
- [ ] STRIPE_SECRET_KEY — Stripe → Developers → API keys
- [ ] STRIPE_WEBHOOK_SECRET — Stripe → Webhooks → endpoint /api/public/stripe-webhook
- [ ] STRIPE_PRICE_PRO — Stripe Price for Pro monthly
- [ ] STRIPE_PRICE_PRO_ANNUAL — Stripe Price for Pro yearly
- [ ] STRIPE_PRICE_EXECUTE — Stripe Price for Execute monthly
- [ ] STRIPE_PRICE_EXECUTE_ANNUAL — Stripe Price for Execute yearly
- [ ] STRIPE_PRICE_VOICE_TOPUP — Stripe Price for 60-minute top-up
- [ ] STRIPE_PRICE_PRO_USD — US-dollar Stripe Price for Pro monthly ($23.99)
- [ ] STRIPE_PRICE_PRO_ANNUAL_USD — US-dollar Stripe Price for Pro yearly ($239.99)
- [ ] STRIPE_PRICE_EXECUTE_USD — US-dollar Stripe Price for Execute monthly ($59.99)
- [ ] STRIPE_PRICE_EXECUTE_ANNUAL_USD — US-dollar Stripe Price for Execute yearly ($599.99)
- [ ] STRIPE_PRICE_VOICE_TOPUP_USD — US-dollar Stripe Price for 60-minute top-up ($14.99)

### Accountability calls
- [ ] GOOGLE_MAPS_API_KEY — Google Maps connector (linked; server-side journey routing)
- [ ] TWILIO_ACCOUNT_SID — Twilio console
- [ ] TWILIO_AUTH_TOKEN — Twilio console
- [ ] TWILIO_FROM_NUMBER — A Twilio voice number
- [ ] TWILIO_FROM_NUMBER_GB — optional UK (+44) caller ID; falls back to TWILIO_FROM_NUMBER
- [ ] TWILIO_FROM_NUMBER_US — optional US (+1) caller ID; falls back to TWILIO_FROM_NUMBER

### Phone verification
- [ ] TWILIO_VERIFY_SERVICE_SID — Twilio Verify service

### Live voice on calls (Execute)
- [ ] OPENAI_REALTIME_API_KEY (optional) — OpenAI API key

### Live voice on calls (alternative)
- [ ] GEMINI_LIVE_API_KEY (optional) — Google AI Studio key

### Email
- [ ] RESEND_API_KEY — Resend → API keys
- [ ] EMAIL_FROM — Verified sender address in Resend

### Support inbox
- [ ] SUPPORT_EMAIL — Your support address

### Phone push
- [ ] EXPO_ACCESS_TOKEN (optional) — Expo access token (only if enhanced security is on)

### Google Calendar
- [ ] GOOGLE_CALENDAR_CLIENT_ID — Google Cloud OAuth client
- [ ] GOOGLE_CALENDAR_CLIENT_SECRET — Google Cloud OAuth client

### Outlook Calendar
- [ ] MICROSOFT_CALENDAR_CLIENT_ID (optional) — Azure app registration
- [ ] MICROSOFT_CALENDAR_CLIENT_SECRET (optional) — Azure app registration

### Food data
- [ ] USDA_FDC_API_KEY — api.data.gov key
- [ ] FATSECRET_CLIENT_ID (optional) — FatSecret Platform
- [ ] FATSECRET_CLIENT_SECRET (optional) — FatSecret Platform

### Wearable: Whoop
- [ ] WHOOP_CLIENT_ID (optional) — Whoop developer app
- [ ] WHOOP_CLIENT_SECRET (optional) — Whoop developer app

### Wearable: Oura
- [ ] OURA_CLIENT_ID (optional) — Oura developer app
- [ ] OURA_CLIENT_SECRET (optional) — Oura developer app
- [ ] OURA_WEBHOOK_VERIFY_TOKEN (optional) — Any string you also enter in Oura

### Wearable: Fitbit
- [ ] FITBIT_CLIENT_ID (optional) — Fitbit developer app
- [ ] FITBIT_CLIENT_SECRET (optional) — Fitbit developer app
- [ ] FITBIT_SUBSCRIBER_VERIFY (optional) — Verification code shown by Fitbit

### Wearable: Strava
- [ ] STRAVA_CLIENT_ID (optional) — Strava developer app
- [ ] STRAVA_CLIENT_SECRET (optional) — Strava developer app
- [ ] STRAVA_WEBHOOK_VERIFY_TOKEN (optional) — Any string you also enter in Strava

### Wearable: Garmin
- [ ] GARMIN_CLIENT_ID (optional) — Garmin developer app
- [ ] GARMIN_CLIENT_SECRET (optional) — Garmin developer app
- [ ] GARMIN_WEBHOOK_TOKEN (optional) — Any string in the Garmin webhook URL

### Error monitoring
- [ ] SENTRY_DSN (optional) — Sentry project DSN

### Product analytics
- [ ] POSTHOG_KEY (optional) — PostHog project key

### iOS app links
- [ ] APPLE_TEAM_ID (optional) — Apple Developer account
- [ ] IOS_BUNDLE_ID (optional) — Your iOS app id

### Android app links
- [ ] ANDROID_PACKAGE_NAME (optional) — Your Android package name
- [ ] ANDROID_SHA256_CERT_FINGERPRINTS (optional) — Play Console → App signing

## Optional settings
- CRON_SECRET — Scheduled jobs (falls back to LOVABLE_CRON_SECRET): Not needed
- STRIPE_AUTOMATIC_TAX — Payments: `true` to use Stripe Tax
- OPENAI_REALTIME_MODEL — Live voice on calls: Optional model override
- OPENAI_TRANSCRIBE_MODEL — Live voice on calls: Optional model override
- GEMINI_LIVE_MODEL — Live voice on calls: Optional model override
- OPENAI_REALTIME_VOICE — Live voice on calls: Optional backup voice name (default `ash`)
- OPENAI_REALTIME_VOICE_GB — Live voice on calls: Optional backup voice name for UK members (default `ballad`)
- GEMINI_LIVE_VOICE — Live voice on calls: Optional voice name (default `Charon`)
- MICROSOFT_CALENDAR_TENANT — Outlook Calendar: Default `common`
- FATSECRET_SCOPE — Food data: Optional
- FATSECRET_REGION — Food data: Optional
- POSTHOG_HOST — Product analytics: Default EU host
- APP_ENV — Monitoring labels: e.g. production
- APP_RELEASE — Monitoring labels: e.g. 1.0.0
- DEPLOYED_AT — Owner Releases page: deploy time (ISO date), set at publish

## Provider approvals (not code)
- Twilio + calling countries: switch on in Admin → Call countries after legal sign-off
- Garmin: commercial agreement
- Google Calendar: OAuth consent screen verification
- Apple / Google stores: app review (see STORE_READINESS.md)
- Stripe: account activation
