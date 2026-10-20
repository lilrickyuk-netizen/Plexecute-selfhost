# Store / platform readiness (Step 91)

All declarations come from `src/lib/platform.ts`, derived from live rules (tests/store-readiness.test.ts).

| Area | Built | Needs owner / store |
|---|---|---|
| Web production | Installable: `/manifest.webmanifest`, icons 192/512, apple-touch-icon, start `/app` | Publish + domain |
| iOS / Android | Web app is the product; native wrapper (Xcode / Android Studio) is ENVIRONMENT-BLOCKED here — see NATIVE_SURFACES.md | Build wrapper, store accounts |
| Subscription products | `storeProducts()` ids `plexecute.{pro,execute}.{monthly,yearly}` at PRODUCTS prices, 7-day trial | Create matching products in stores if store billing is chosen |
| Store billing | `STORE_BILLING`: purchases on web via Stripe; store in-app billing OFF so no store event can grant a tier | Owner decision + store review |
| Restore purchase | `restoreSubscription` (billing.functions.ts) re-reads Stripe; never fabricates | STRIPE_SECRET_KEY |
| Privacy declarations | `PRIVACY_DECLARATION` (App Store label / Play Data safety): no tracking, no sale, in-app deletion | Paste into store consoles |
| Health permissions | `healthPermissions()` read-only usage text per category | HealthKit / Health Connect review |
| Push | Server accepts tokens (`push_devices`), Expo dispatch | APNs / FCM keys in Expo |
| Deep links / app links | `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json` (404 until set) | `APPLE_TEAM_ID`, `IOS_BUNDLE_ID`, `ANDROID_PACKAGE_NAME`, `ANDROID_SHA256_CERT_FINGERPRINTS` |
| OAuth redirects | `OAUTH_CALLBACK_PATHS` — always web URLs on the app origin, then deep-linked into the app | Register each with the provider |

Store approval itself is provider/store approval, not unfinished coding.
