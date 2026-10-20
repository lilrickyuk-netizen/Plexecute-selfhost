# Plexecute — credentials to add

Add each value in Lovable: Cloud → Secrets (server-only). Nothing is hard-coded; features switch on automatically once set.

| Secret | Value | Used by |
|---|---|---|
| STRIPE_SECRET_KEY | Stripe secret key (`sk_live_…` / `sk_test_…`) | Checkout, billing portal, account deletion |
| STRIPE_PRICE_PRO | Stripe Price ID for Pro £23.99/month (`price_…`) | Checkout |
| STRIPE_PRICE_EXECUTE | Stripe Price ID for Execute £59.99/month (`price_…`) | Checkout + webhook tier mapping |
| STRIPE_WEBHOOK_SECRET | Signing secret (`whsec_…`) of a Stripe webhook pointing at `https://<your-domain>/api/public/stripe-webhook`, events: checkout.session.completed, customer.subscription.created/updated/deleted | Subscription + trial state |
| STRIPE_AUTOMATIC_TAX | `true` to let Stripe Tax add UK VAT (optional) | Checkout |
| TWILIO_ACCOUNT_SID | `AC…` | Accountability calls |
| TWILIO_AUTH_TOKEN | Twilio auth token (also verifies Twilio callbacks) | Calls |
| TWILIO_FROM_NUMBER | Your Twilio voice number, `+44…` | Calls |
| SUPPORT_EMAIL | Support inbox address | Privacy requests (correct, object, complain) are emailed here; needs RESEND_API_KEY + EMAIL_FROM |
| RESEND_API_KEY | Resend API key (`re_…`) | Email reminders |
| EMAIL_FROM | Verified sender, e.g. `Plexecute <reminders@yourdomain.com>` | Email reminders |
| CRON_SECRET | Any long random string | Protects the reminder job |
| APP_BASE_URL | Your public site URL, e.g. `https://plexecute.com` | Callback URLs + Twilio signature checks |

Scheduler: call `POST https://<your-domain>/api/public/cron/reminders` every 5 minutes with header `Authorization: Bearer <CRON_SECRET>`; calls are placed every minute by the managed `/api/public/cron/calls` schedule.

Health companion: POST `https://<your-domain>/api/public/health/ingest` with `Authorization: Bearer <user's health key from Settings>` and body `{ "source": "apple_health", "samples": [{ "kind": "steps", "value": 8421, "recorded_at": "2026-10-01T10:00:00Z" }] }`.

## Food data (Nutrition)
- `FATSECRET_CLIENT_ID`, `FATSECRET_CLIENT_SECRET` — fatsecret Platform OAuth2 client (primary provider; enables barcode lookup and verified UK data).
- `FATSECRET_REGION` — dataset market, e.g. `GB` (requires a plan that includes that country).
- `FATSECRET_SCOPE` — optional, defaults to `premier barcode`.
- `USDA_FDC_API_KEY` — free key from api.data.gov for USDA FoodData Central. Without it the public `DEMO_KEY` is used (low rate limit).

- `FIRECRAWL_API_KEY` — career/qualification live research (web search + page fetch). Server-only env var read in src/lib/research.functions.ts. Without it the Research button reports "Live research is not switched on yet."

## Calendar (Google / Outlook)
- `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` — Google Cloud OAuth client (Web). Enable the Google Calendar API. Authorised redirect URI: `https://<your-domain>/api/public/calendar/oauth/google`. Scopes requested per mode: `calendar.freebusy`, `calendar.events.readonly`, `calendar.app.created`.
- `MICROSOFT_CALENDAR_CLIENT_ID`, `MICROSOFT_CALENDAR_CLIENT_SECRET` — Microsoft Entra app registration (Web). Redirect URI: `https://<your-domain>/api/public/calendar/oauth/microsoft`. Delegated permissions: `offline_access`, `Calendars.ReadBasic`, `Calendars.Read`, `Calendars.ReadWrite`.
- `MICROSOFT_CALENDAR_TENANT` — optional, defaults to `common`.
- `CALENDAR_STATE_SECRET` — any long random string; signs the connection link so it can't be forged.
- Change notifications are delivered to `https://<APP_BASE_URL>/api/public/calendar/webhook/google|microsoft` (needs `APP_BASE_URL` on https).
- Scheduler: `POST https://<your-domain>/api/public/cron/calendar` every 15 minutes with `Authorization: Bearer <CRON_SECRET>`.

## Wearables (step 42)

Each service is switched on when its two keys are set, plus `WEARABLE_STATE_SECRET` (any long random string; falls back to `CALENDAR_STATE_SECRET`). Redirect URI to register with each service: `<APP_BASE_URL>/api/public/wearables/oauth/<provider>`.

| Service | Keys | Change notifications URL | Extra |
|---|---|---|---|
| WHOOP | `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET` | `/api/public/wearables/webhook/whoop` (signed with the client secret) | — |
| Oura | `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET` | `/api/public/wearables/webhook/oura` | `OURA_WEBHOOK_VERIFY_TOKEN` |
| Fitbit | `FITBIT_CLIENT_ID`, `FITBIT_CLIENT_SECRET` | `/api/public/wearables/webhook/fitbit` | `FITBIT_SUBSCRIBER_VERIFY` |
| Strava | `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | `/api/public/wearables/webhook/strava` | `STRAVA_WEBHOOK_VERIFY_TOKEN` |
| Garmin | `GARMIN_CLIENT_ID`, `GARMIN_CLIENT_SECRET` (needs Garmin's commercial agreement) | `/api/public/wearables/webhook/garmin?token=<GARMIN_WEBHOOK_TOKEN>` | `GARMIN_WEBHOOK_TOKEN` |

Polling backup: call `POST /api/public/cron/wearables` every 30 minutes with `Authorization: Bearer <CRON_SECRET>`.

## Push notifications (step 44)
| Name | What | Used for |
|---|---|---|
| EXPO_ACCESS_TOKEN | Optional Expo access token (only if "enhanced push security" is on in Expo) | Phone push via Expo Push Service |
Push needs the Plexecute phone app to register its token through `registerPushDevice`. Email uses RESEND_API_KEY + EMAIL_FROM (above). Delivery runs inside `/api/public/cron/reminders` (CRON_SECRET), every 5 minutes.

## Pro accountability calling (step 45)
| Name | What | Used for |
|---|---|---|
| TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER | Twilio Programmable Voice (stable regional number) | Placing calls; status webhook `/api/public/twilio/status` |
| TWILIO_VERIFY_SERVICE_SID | Twilio Verify service (`VA…`) | Text-message code to prove the phone number |
| PHONE_ENCRYPTION_KEY | 32 random bytes, base64 (`openssl rand -base64 32`) | Encrypting stored phone numbers |
| (no env var) | Countries are switched on in Admin → Call countries after legal sign-off | Replaces the old CALL_MARKETS_APPROVED variable; credentials never enable calling |

## Execute monthly execution reward
No new keys. Uses STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. In the Stripe webhook endpoint (`/api/public/stripe-webhook`) also enable: `invoice.created`, `invoice.paid`, `invoice.payment_failed`. STRIPE_PRICE_EXECUTE must be the monthly £59.99 GBP price. The reward is a £10 customer-balance credit (Stripe applies it to the next renewal invoice, making it £39.99).

## Live AI voice on calls (Step 48)
Entered as backend secrets (env vars). Without them calls use the keypad only.
- `VOICE_STREAM_SECRET` — any long random string; signs the per-call stream token. Required.
- `OPENAI_REALTIME_API_KEY` — primary live voice provider. Optional `OPENAI_REALTIME_MODEL` (default `gpt-realtime`), `OPENAI_TRANSCRIBE_MODEL` (default `gpt-4o-mini-transcribe`, used only for ephemeral safety screening).
- `GEMINI_LIVE_API_KEY` — fallback provider. Optional `GEMINI_LIVE_MODEL` (default `gemini-2.5-flash-native-audio-latest`).
- `APP_BASE_URL` must be the public https URL so Twilio can open the wss stream.

## Billing products (Steps 50–55)
Set in project secrets (Stripe price IDs, no hard-coded IDs):
- `STRIPE_PRICE_PRO` (£23.99/month), `STRIPE_PRICE_PRO_ANNUAL` (£239.99/year)
- `STRIPE_PRICE_EXECUTE` (£59.99/month), `STRIPE_PRICE_EXECUTE_ANNUAL` (£599.99/year)
- `STRIPE_PRICE_VOICE_TOPUP` (one-off £14.99, 60 minutes)
Webhook events to enable on `/api/public/stripe-webhook`: checkout.session.completed, checkout.session.async_payment_succeeded, customer.subscription.*, invoice.created, invoice.paid, invoice.payment_failed, charge.refunded.

## Monitoring (Step 64), all optional
| Key | What it switches on | Where it goes |
|---|---|---|
| SENTRY_DSN | Errors also sent to your Sentry project (always stored in the app too) | Project secrets |
| POSTHOG_KEY | Privacy-filtered product analytics (fixed event names, surrogate ids) | Project secrets |
| POSTHOG_HOST | PostHog region, default https://eu.i.posthog.com | Project secrets |
| APP_ENV / APP_RELEASE | Environment and release labels on logs and errors | Project secrets |

## Native app links (Step 91)
APPLE_TEAM_ID, IOS_BUNDLE_ID, ANDROID_PACKAGE_NAME, ANDROID_SHA256_CERT_FINGERPRINTS (comma-separated) — server env; enable /.well-known deep-link files.
