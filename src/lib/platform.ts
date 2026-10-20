/**
 * Step 91 store / platform readiness. Every store-facing declaration is derived
 * from the live rules (billing, health, subprocessors) so stores and app never disagree.
 */
import { PRODUCTS, TRIAL, type PaidTier, type Interval } from "./billing";
import { HEALTH_CATEGORIES, CATEGORY_LABEL } from "./health";

export const APP_NAME = "Plexecute";
/** Env vars a native wrapper needs; unset values mean the deep-link files answer 404. */
export const PLATFORM_ENV = {
  appleTeamId: "APPLE_TEAM_ID",
  iosBundleId: "IOS_BUNDLE_ID",
  androidPackage: "ANDROID_PACKAGE_NAME",
  androidSha256: "ANDROID_SHA256_CERT_FINGERPRINTS",
} as const;

/** Paths a native app opens instead of the browser (universal links / app links). */
export const DEEP_LINK_PATHS = ["/app", "/app/*", "/login", "/reset-password", "/legal/*"] as const;

/** OAuth/provider callbacks: always web URLs on the app origin, then handed to the app by deep link. */
export const OAUTH_CALLBACK_PATHS = [
  "/api/public/calendar/oauth/google",
  "/api/public/calendar/oauth/microsoft",
  "/api/public/wearables/oauth/whoop",
  "/api/public/wearables/oauth/oura",
  "/api/public/wearables/oauth/fitbit",
  "/api/public/wearables/oauth/strava",
  "/api/public/wearables/oauth/garmin",
] as const;

/** Store product ids for each paid plan; prices mirror PRODUCTS and must be set to the same tier in each store. */
export function storeProducts() {
  const out: {
    id: string;
    tier: PaidTier;
    interval: Interval;
    pence: number;
    trialDays: number;
  }[] = [];
  for (const tier of Object.keys(PRODUCTS) as PaidTier[])
    for (const interval of ["month", "year"] as Interval[])
      out.push({
        id: `plexecute.${tier}.${interval === "month" ? "monthly" : "yearly"}`,
        tier,
        interval,
        pence: PRODUCTS[tier][interval].pence,
        trialDays: TRIAL.days,
      });
  return out;
}

/**
 * Store billing policy. Purchases happen through Stripe on the web; the native app is a
 * companion that signs in to an existing plan and offers "Restore purchase" (re-reads the
 * Stripe subscription via restoreSubscription). In-app store billing is not used until the
 * owner chooses it, so no store purchase can ever grant a tier.
 */
export const STORE_BILLING = {
  purchaseChannel: "web_stripe",
  nativeRestore: true,
  storeIapEnabled: false,
} as const;

/** Health permission request strings (App Store usage text / Health Connect rationale). */
export function healthPermissions() {
  return HEALTH_CATEGORIES.map((c) => ({
    category: c,
    read: true,
    write: false,
    reason: `${APP_NAME} reads your ${CATEGORY_LABEL[c].toLowerCase()} only if you allow it, to plan around your recovery and record completed sessions. It never writes to your health data.`,
  }));
}

/** App Store privacy label / Play Data safety declaration. tracking is always false. */
export const PRIVACY_DECLARATION = {
  tracking: false,
  sellsData: false,
  collected: [
    { type: "Contact info: email", purpose: "Account, support, notifications", linked: true },
    {
      type: "Contact info: phone number",
      purpose: "Accountability calls (optional)",
      linked: true,
    },
    {
      type: "Health & fitness",
      purpose: "Planning and completion evidence (optional, per category)",
      linked: true,
    },
    {
      type: "User content: messages, goals, plans, food logs",
      purpose: "App functionality",
      linked: true,
    },
    { type: "Purchases", purpose: "Subscription status", linked: true },
    {
      type: "Diagnostics: crash data (personal data removed)",
      purpose: "App reliability",
      linked: false,
    },
  ],
  deletionInApp: "/app/settings",
  privacyUrl: "/privacy",
} as const;

export function appleAppSiteAssociation(env: Record<string, string | undefined>) {
  const team = env[PLATFORM_ENV.appleTeamId],
    bundle = env[PLATFORM_ENV.iosBundleId];
  if (!team || !bundle) return null;
  return {
    applinks: {
      details: [
        { appIDs: [`${team}.${bundle}`], components: DEEP_LINK_PATHS.map((p) => ({ "/": p })) },
      ],
    },
    webcredentials: { apps: [`${team}.${bundle}`] },
  };
}

export function assetLinks(env: Record<string, string | undefined>) {
  const pkg = env[PLATFORM_ENV.androidPackage],
    fps = env[PLATFORM_ENV.androidSha256];
  if (!pkg || !fps) return null;
  return [
    {
      relation: [
        "delegate_permission/common.handle_all_urls",
        "delegate_permission/common.get_login_creds",
      ],
      target: {
        namespace: "android_app",
        package_name: pkg,
        sha256_cert_fingerprints: fps
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    },
  ];
}
