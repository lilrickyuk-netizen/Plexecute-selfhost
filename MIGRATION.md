# Moving Plexecute off Lovable: runbook

This copy of the code no longer depends on Lovable. Plexecute will run on:

- **Cloudflare Workers** for the app: website, server code, API routes and the call voice stream.
- **Supabase** (your own project) for the database, sign-in and scheduled jobs.
- **Your own accounts** for everything else: OpenAI, Gemini, Twilio, Stripe, Resend, Firecrawl and Google Maps.

Keep the Lovable version live and untouched until the new one has passed every check in step 8.

---

## What changed in the code

| Area | Before (Lovable) | Now |
|---|---|---|
| Build | `@lovable.dev/vite-tanstack-config` | Plain Vite config with `@cloudflare/vite-plugin` (`vite.config.ts`, `wrangler.jsonc`) |
| AI text, vision, embeddings, voice input | Lovable AI gateway + `LOVABLE_API_KEY` | Direct to OpenAI (`OPENAI_API_KEY`) and Gemini (`GEMINI_API_KEY`) via `src/lib/ai-gateway.server.ts`. Models, metering and spend caps are unchanged. |
| Google sign-in | Lovable's OAuth broker ("continue to Lovable") | Supabase Google sign-in with **your own** Google OAuth client, so it shows "Plexecute" |
| Auth emails (confirm, reset) | Lovable email service | Supabase sends them through **Resend SMTP** (set in the dashboard, step 4) |
| Journey planning (future upgrade, hidden) | Lovable connector gateway | Direct Google Maps APIs (`GOOGLE_MAPS_API_KEY`), ready for when you switch Journeys on |
| Career/video research | Firecrawl via Lovable connector | Firecrawl direct: use a real `fc-…` key |
| Scheduled jobs | Lovable-managed cron + `LOVABLE_CRON_SECRET` | Supabase `pg_cron` calling the app with `CRON_SECRET` (`supabase/self-host/cron-schedules.sql`) |
| Removed | `src/integrations/lovable`, `src/routes/lovable/*`, `send-email.ts`, `@lovable.dev/*` packages | — |

Everything else (features, prices, Stripe price IDs, tests) is unchanged.

> **Not tested here.** These changes could not be installed or built in the environment that made them, because package downloads were blocked. The new AI routing and Maps mapping were behaviour-tested, and every changed file was syntax-checked. The first `npm install && npm run build` on your computer is the real test. If it fails, paste the error into Claude Code on your machine and fix it there.

---

## Step 0: Keep this separate from the Lovable repo

Your Lovable project syncs with its GitHub repo. **Don't push these changes to that repo's main branch**, or the Lovable version will break.

Do one of these instead:
- Create a **new private GitHub repo**, e.g. `plexecute-selfhost`, and push this folder there (recommended).
- Or push to a new branch called `self-host` and never merge it into main while Lovable is live.

## Step 1: Accounts you need

| Account | What for | Notes |
|---|---|---|
| Supabase | Database, sign-in, scheduled jobs | Pro plan ($25/month). Pick the **London (eu-west-2)** region. Add point-in-time recovery later. |
| Cloudflare | Hosting | Workers Paid plan (~$5/month). Your domain's DNS will move here. |
| Google Cloud | Google sign-in client | One project called "Plexecute". Add a Maps key later, when Journeys launches |
| OpenAI | AI text, embeddings, voice input | Turn on auto-recharge and a monthly budget alert |
| Google AI Studio | Gemini key (fallback AI, food photos, live call voice) | You already have `GEMINI_LIVE_API_KEY`; you can use the same key for both |
| Firecrawl | Career and video research | A direct `fc-…` key |
| Resend | All email | Verify `plexecute.io` in Resend |
| Stripe, Twilio | Unchanged | Same accounts, keys and price IDs |

## Step 2: Set up on your computer

1. Install **Node.js 22** and **Git**.
2. Open a terminal in this folder and run:
   ```bash
   npm install
   npm test
   ```
   All unit tests should pass, including the new `tests/ai-gateway.test.ts`.
3. Install the Supabase CLI and Postgres client tools (`psql`), which you need for step 3.

## Step 3: Create the database

Create the Supabase project first: **New project → Region: London → Pro plan**. Note the database password.

Then choose **one** route.

### Route A (recommended): copy the live database exactly

This needs a direct connection string for the Lovable Cloud database. Ask Lovable: *"Give me a direct Postgres connection string for this project's database so I can export it."*

If you get one, follow Supabase's project-to-project guide. Use the old URL for the dumps and the new URL for the restore:

```bash
supabase db dump --db-url "OLD_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "OLD_DB_URL" -f schema.sql
supabase db dump --db-url "OLD_DB_URL" -f data.sql --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"

psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql --dbname "NEW_DB_URL"
```

This copies everything: your admin and test accounts, feature flags, call countries, the knowledge library and settings. Then sign in on the new app with your existing password to confirm the accounts came across.

> If you copy the data, you **must** reuse the old values of `PHONE_ENCRYPTION_KEY` and `VAPID_SEED`. Otherwise stored phone numbers can't be decrypted and push subscriptions stop working. Ask Lovable for those two values. If it can't provide them, re-verify your phone and re-allow notifications after the move.

### Route B: build a fresh database from the migrations

Use this if Lovable won't give you a connection string. You only have test accounts, so you lose nothing that matters.

All the migrations are already combined, in the right order, into two files.

1. Open Supabase → **SQL Editor → New query**.
2. Paste the whole of `supabase/self-host/schema-part-1.sql` and click **Run**. Wait for "Success".
3. Paste the whole of `supabase/self-host/schema-part-2.sql` and click **Run**.

Each part runs as one transaction, so if anything fails, nothing in that part is applied. Send the error to Claude and re-run that part after fixing it.

These files were test-run on a stand-in database. They created all **116 tables** listed in the live app's own schema file, plus all the database functions the app relies on (spend reservations, cron token check, admin role check and knowledge search), with row-level security on every table. The one migration that granted admin to your **old** Lovable account ID is skipped, because that ID doesn't exist on the new project.

4. After you deploy (step 6), **sign up** on the new site, then make yourself admin in the SQL Editor:
   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin' from auth.users where email = 'richard@plexecute.io'
   on conflict do nothing;
   ```
   Sign out and back in to see the full control panel.
5. Redo the settings you'd changed in the old control panel, such as call countries (switch **UK** back on) and any feature switches.

To regenerate the two files after adding new migrations, run `python3 scripts/self-host/build-schema.py`.

## Step 4: Supabase sign-in settings

In Supabase → **Authentication**:

1. **URL configuration**
   - Site URL: `https://plexecute.io`
   - Redirect URLs: `https://plexecute.io/**`, `https://www.plexecute.io/**`, `http://localhost:3000/**`, plus your `*.workers.dev` URL from step 6.
2. **Google provider**
   - In Google Cloud → APIs & Services → **OAuth consent screen**: app name **Plexecute**, your logo, plexecute.io, and your privacy and terms links. Submit it for brand verification.
   - Create **Credentials → OAuth client ID (Web)**. Under authorised redirect URI, put the callback URL Supabase shows on its Google provider page (`https://<project>.supabase.co/auth/v1/callback`).
   - Paste the client ID and secret into Supabase → Google provider → Enable.
3. **Emails (SMTP)**: Authentication → **SMTP settings** → enable custom SMTP:
   - Host `smtp.resend.com`, port `465`, username `resend`, password = your Resend API key.
   - Sender `noreply@plexecute.io`, name `Plexecute`.
   - Customise the email templates (confirm signup, reset password, change email) in Authentication → **Emails**. The old designs are in `src/lib/email-templates/` for reference.
4. **Passwords**: turn on leaked-password protection and set a minimum length of 8, to match the app's rules.

## Step 5: Secrets

**Build-time values (`.env`):** replace the values in `.env` with your new Supabase project's details:

```
VITE_SUPABASE_URL=https://<new-project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<new publishable key>
```

You can delete the old `SUPABASE_*` and `VITE_LOVABLE_*` lines from `.env`.

**Server secrets (Cloudflare):** run `npx wrangler login` once, then add each secret with:

```bash
npx wrangler secret put NAME
```

**Required to launch:**

```
SUPABASE_URL  SUPABASE_PUBLISHABLE_KEY  SUPABASE_SERVICE_ROLE_KEY
APP_BASE_URL                      (workers.dev URL while testing, then https://plexecute.io)
OPENAI_API_KEY  GEMINI_API_KEY  GEMINI_LIVE_API_KEY  FIRECRAWL_API_KEY  USDA_FDC_API_KEY
CRON_SECRET  VOICE_STREAM_SECRET  PHONE_ENCRYPTION_KEY  VAPID_SEED  VAPID_CONTACT
STRIPE_SECRET_KEY  STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_PRO  STRIPE_PRICE_PRO_ANNUAL  STRIPE_PRICE_EXECUTE  STRIPE_PRICE_EXECUTE_ANNUAL
STRIPE_PRICE_VOICE_TOPUP  STRIPE_PRICE_AI_CREDIT
STRIPE_PRICE_PRO_USD  STRIPE_PRICE_PRO_ANNUAL_USD  STRIPE_PRICE_EXECUTE_USD  STRIPE_PRICE_EXECUTE_ANNUAL_USD
STRIPE_PRICE_VOICE_TOPUP_USD  STRIPE_PRICE_AI_CREDIT_USD
TWILIO_ACCOUNT_SID  TWILIO_AUTH_TOKEN  TWILIO_FROM_NUMBER  TWILIO_VERIFY_SERVICE_SID   (+ _GB/_US numbers if used)
RESEND_API_KEY  EMAIL_FROM  SUPPORT_EMAIL
```

Copy the Stripe, Twilio and Resend values exactly as they are in Lovable today. Make each generated secret (`CRON_SECRET`, `VOICE_STREAM_SECRET` and so on) with `openssl rand -hex 32`, unless Route A means you must reuse an old value.

**Optional, for future upgrades:** `GOOGLE_MAPS_API_KEY` (Journeys), `CALENDAR_STATE_SECRET` plus the Google/Outlook calendar keys (calendar sync), and `WEARABLE_STATE_SECRET` plus the wearable keys (wearables). Add them only when you switch those features on. Also optional: any other variables you use today, such as `GEMINI_LIVE_MODEL`, `ELEVENLABS_*`, `SENTRY_DSN` and `POSTHOG_KEY`. The full list with descriptions is in `src/lib/credentials.ts`.

For local development, copy `.dev.vars.example` to `.dev.vars` and fill it in. Use **Stripe test keys** there.

## Step 6: Deploy to a test address

```bash
npm run deploy
```

Wrangler prints a URL like `https://plexecute.<your-account>.workers.dev`. Then:

1. Set `APP_BASE_URL` to that URL (`npx wrangler secret put APP_BASE_URL`) and add it to the Supabase redirect URLs.
2. Open it. You should see Plexecute running on your own infrastructure.

## Step 7: Scheduled jobs

1. Open `supabase/self-host/cron-schedules.sql`.
2. Replace `YOUR_CRON_SECRET` with the same `CRON_SECRET` you set on Cloudflare, and replace the URL with your workers.dev URL for now.
3. Run it in Supabase → SQL Editor.
4. Check it's working with `select * from cron.job_run_details order by start_time desc limit 20;`. Runs should succeed, and `net._http_response` should show status `200`.

## Step 8: Test everything on the test address

Tick each item off before going further:

- [ ] Sign up with email: the confirmation email arrives from Plexecute, the link works, and onboarding opens.
- [ ] Google sign-in: the screen says **Plexecute**, not Lovable, and you land in the app.
- [ ] Password reset email arrives and works.
- [ ] Coach replies, creates and changes a plan, and uses tools (e.g. "move tomorrow's workout to 7pm").
- [ ] Food photo estimate works (Gemini), voice input transcribes (OpenAI), and career research returns sources (Firecrawl).
- [ ] Billing, with **Stripe test mode**: point a *test-mode* webhook at `https://<workers.dev>/api/public/stripe-webhook`, buy Pro, confirm the plan upgrades, and buy an AI credit and a call top-up.
- [ ] A reminder arrives on time, which proves the scheduled jobs are running.
- [ ] A real call to your phone: voice works, keypad works, a no-answer triggers a retry, and STOP works.
- [ ] Admin console opens, and the costs page shows the AI and call usage you just generated.
- [ ] Owner Control Centre → Integrations shows AI, payments, calls and email as working.

## Step 9: Switch plexecute.io over

1. **Move DNS to Cloudflare** (free): Cloudflare → Add site → `plexecute.io`. Check every existing record is copied, including email records, then change the nameservers at your domain registrar to the two Cloudflare gives you.
   - Remove the old `notify.plexecute.io` delegation to Lovable's nameservers. Add the DNS records Resend gives you instead.
2. Disconnect the custom domain from the Lovable project. Keep the Lovable project itself.
3. In Cloudflare → Workers → **plexecute → Settings → Domains & Routes**, add `plexecute.io` and `www.plexecute.io`.
4. Update `APP_BASE_URL` to `https://plexecute.io`, and run this in the Supabase SQL Editor:
   `select vault.update_secret((select id from vault.secrets where name = 'plexecute_app_url'), 'https://plexecute.io');`
5. Stripe's **live** webhook still points at `https://plexecute.io/api/public/stripe-webhook` and keeps the same signing secret, so nothing changes there. Make one real purchase and refund it.
6. Run the Step 8 checklist again quickly on `https://plexecute.io`.

## Step 10: Afterwards

- Leave the Lovable project unpublished but intact for at least a week as your fallback.
- Then cancel Lovable Cloud and its AI usage.
- When paying users reach the hundreds, turn on **point-in-time recovery** in Supabase (Settings → Add-ons) so you can restore to within minutes.

## If something goes wrong

- **Build fails after `npm install`:** usually a version mismatch between Vite 8 and `@cloudflare/vite-plugin`. Run `npm install @cloudflare/vite-plugin@latest wrangler@latest` and rebuild. If it still fails, paste the error into Claude Code in this folder.
- **"OPENAI_API_KEY is not configured":** the Cloudflare secret is missing. Run `npx wrangler secret list`.
- **AI errors mentioning "model not found":** the code uses the same model names Lovable used (`gpt-6-luna`, `gpt-transcribe`, `text-embedding-3-small`, `gemini-3.8-flash`, `gemini-3.1-flash-lite`). If a provider names a model slightly differently, check the exact ID in your OpenAI or AI Studio dashboard and update it where it's defined (search the code for the old name).
- **Google sign-in returns to the login page without signing in:** the redirect URL is missing from Supabase → Authentication → URL configuration.
- **Reminders or calls never fire:** check `cron.job_run_details` and `net._http_response`. A `401` means the `CRON_SECRET` in Vault and in Cloudflare don't match.
- **Calls connect but there's no voice:** check `VOICE_STREAM_SECRET` and `GEMINI_LIVE_API_KEY` are set, and that `APP_BASE_URL` is your live address, because Twilio is told to stream to it.
