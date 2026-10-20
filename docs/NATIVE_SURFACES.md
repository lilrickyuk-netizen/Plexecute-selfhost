# Glanceable and native surfaces (Step 57)

## Built (web/backend, complete)
- **Payload contract**: `buildGlance` in `src/lib/glance.ts` (version 1). One payload for every surface: day status, progress, `next`, `live` (Live Activity / ongoing activity), `complication` text, permitted `actions`, `staleAfter`.
- **Privacy**: every item carries `lockScreenTitle` (generic). Lock screen, Smart Stack, complications and Wear OS tiles show it unless the device is unlocked.
- **Safety**: while a safety note pauses accountability, `actions` is empty.
- **Feed API**: `GET /api/public/glance` with header `Authorization: Bearer <user access token>`. Returns JSON, `cache-control: private, no-store`.
- **Actions**: native surfaces call the existing `transitionPlanBlock` server function with `idempotencyKey` = a device-generated UUID (same rule as the offline outbox), so a retried tap never doubles an event.
- **Refresh events**: push via `enqueueNotification` (src/lib/notify.server.ts) plus `GLANCE_STALE_SEC` (15 min) polling.
- **Fixtures**: `tests/offline-glance.test.ts`.

## ENVIRONMENT-BLOCKED (needs native toolchains Lovable cannot build)
- iOS WidgetKit widgets, Lock Screen widgets, Smart Stack, Live Activities (ActivityKit) and Apple Watch app/complications (Xcode).
- Android home-screen widgets (Glance/AppWidget), ongoing activities and Wear OS tiles/complications (Android Studio).
- Native push token registration for those surfaces (the server side already accepts tokens in `push_devices`).
