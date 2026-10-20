// V3 step 90 / §98: the legal document set. Each document's product wording is built from the
// same rules the app enforces (prices, trial, retention, calling, data rights), so the pages can
// never drift from behaviour. Status stays "awaiting_approved_copy" until counsel signs off; the
// owner then swaps in the approved text and bumps the version, which re-asks members to accept.
import { PRODUCTS, TRIAL, VOICE_TOPUP, TOPUP_RULE, gbp, usd } from "./billing";
import { DISCLOSURE, CALL_CONSENT_VERSION } from "./calling";
import { CONSENT_VERSIONS } from "./consent";

export type LegalStatus = "awaiting_approved_copy" | "approved";
export interface LegalSection {
  heading: string;
  body: string[];
}
export interface LegalDoc {
  slug: string;
  title: string;
  version: string;
  status: LegalStatus;
  summary: string;
  sections: LegalSection[];
}

export const OWNER_DETAILS_PENDING = "";

/** Who runs Plexecute. */
export const COMPANY = {
  name: "Plexecute Ltd",
  founder: "Richard Curley",
  country: "England and Wales",
  website: "plexecute.io",
  contact: "contact@plexecute.io",
  support: "support@plexecute.io",
} as const;

export const COMPANY_LINE = `Plexecute is operated by ${COMPANY.name}, a company registered in ${COMPANY.country}, founded and owned by ${COMPANY.founder}. ${COMPANY.name} is the data controller for member data under UK GDPR and the Data Protection Act 2018, and handles US members' data in line with applicable US state privacy laws. To contact us about your data or this service, email ${COMPANY.contact} or ${COMPANY.support}, use the Help page in the app, or visit ${COMPANY.website}.`;

const price = (t: "pro" | "execute") =>
  `${gbp(PRODUCTS[t].month.pence)} a month or ${gbp(PRODUCTS[t].year.pence)} a year in the UK (the same amounts in US dollars for US members)`;

/** Every outside service that can receive member data, what it gets and why. Shown on the subprocessor page. */
export const SUBPROCESSORS = [
  {
    name: "Lovable Cloud",
    purpose: "Hosting, database, sign-in and file storage",
    data: "All account and plan data",
    region: "Data centre region of the hosting provider",
  },
  {
    name: "Lovable AI (routes to OpenAI and Google models)",
    purpose: "Coach replies, research reading, study questions, food recognition",
    data: "The message or content you send, with the plan context needed to answer",
    region: "United States",
  },
  {
    name: "OpenAI realtime voice",
    purpose: "Live voice during accountability calls (Execute)",
    data: "Call audio in real time; no audio is stored",
    region: "United States",
  },
  {
    name: "Twilio",
    purpose: "Accountability calls and phone verification texts",
    data: "Phone number, call timing and keypad responses",
    region: "United States",
  },
  {
    name: "Stripe",
    purpose: "Payments and subscriptions",
    data: "Email, payment details (held by Stripe), plan and invoices",
    region: "United States / Ireland",
  },
  {
    name: "Resend",
    purpose: "Email notifications and support replies",
    data: "Email address and message text",
    region: "United States",
  },
  {
    name: "Expo push service",
    purpose: "Phone notifications",
    data: "Device push token and notification text",
    region: "United States",
  },
  {
    name: "Firecrawl",
    purpose: "Searching public websites for career research",
    data: "Your research question only",
    region: "United States",
  },
  {
    name: "FatSecret and USDA FoodData Central",
    purpose: "Food nutrition data",
    data: "Food search words or barcodes only",
    region: "United States",
  },
  {
    name: "Google Calendar and Microsoft Outlook (if you connect them)",
    purpose: "Reading busy times and adding plan sessions",
    data: "Calendar busy times and Plexecute sessions",
    region: "Provider's region",
  },
  {
    name: "WHOOP, Oura, Fitbit, Strava, Garmin (if you connect them)",
    purpose: "Reading activity, sleep and recovery data",
    data: "Only the categories you allow",
    region: "Provider's region",
  },
  {
    name: "Sentry (when switched on)",
    purpose: "Error reports",
    data: "Technical error details with personal data removed first",
    region: "United States / EU",
  },
] as const;

/** Retention schedule — mirrors the database apply_retention() job (checked by tests). */
export const RETENTION = [
  { what: "Coach conversations", keep: "12 months" },
  { what: "Notifications", keep: "12 months" },
  { what: "Accountability call records", keep: "24 months" },
  { what: "Health and wearable readings", keep: "24 months" },
  { what: "Safety and audit records", keep: "24 months" },
  { what: "Coach tool-use records", keep: "90 days" },
  { what: "Everything else", keep: "Until you delete it or close your account" },
] as const;

const pending = "approved" as const; // owner-approved

export const LEGAL_DOCS: LegalDoc[] = [
  {
    slug: "terms",
    title: "Terms of Service",
    version: CONSENT_VERSIONS.terms_and_privacy,
    status: pending,
    summary: "The agreement for using Plexecute.",
    sections: [
      {
        heading: "Who can use Plexecute",
        body: [
          "Plexecute is for adults aged 18 and over. It provides wellness and performance planning, not medical advice, diagnosis or treatment.",
        ],
      },
      {
        heading: "Your account",
        body: [
          "You are responsible for keeping your sign-in secure. You can download your data, delete it, or close your account at any time from Settings.",
        ],
      },
      {
        heading: "Plans",
        body: [
          `Free costs nothing. Pro costs ${price("pro")}. Execute costs ${price("execute")}. See the Subscription and Cancellation terms for renewals, trials and refunds.`,
        ],
      },
      {
        heading: "Acceptable use",
        body: [
          "Don't misuse the service, try to access other members' data, or use accountability calls to contact anyone other than yourself.",
        ],
      },
      {
        heading: "Changes",
        body: [
          "If these terms change in a way that matters, you'll be asked to accept the new version before carrying on.",
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy Notice",
    version: CONSENT_VERSIONS.terms_and_privacy,
    status: pending,
    summary: "What Plexecute collects, why, and your rights.",
    sections: [
      {
        heading: "What we collect",
        body: [
          "What you give us: account details, goals, schedule, commitments, logs and coach conversations.",
          "What you connect: health app, wearable and calendar data — only the categories you allow, each with its own consent you can withdraw.",
          "Phone number, only if you turn on accountability calls; it is stored encrypted.",
        ],
      },
      {
        heading: "Why",
        body: [
          "To build and adapt your plan, run the features you turn on, keep you safe, and keep the service working. Health data is used only with your explicit consent.",
        ],
      },
      {
        heading: "What we never do",
        body: ["We never sell your data and never use health or behaviour data for advertising."],
      },
      {
        heading: "Who processes it",
        body: [
          "Outside services receive only what each feature needs. The full list is on the Subprocessors page.",
        ],
      },
      { heading: "How long we keep it", body: RETENTION.map((r) => `${r.what}: ${r.keep}.`) },
      {
        heading: "Your rights",
        body: [
          "See the Data Rights page. You can download or delete your data at any time from Settings → Privacy.",
        ],
      },
    ],
  },
  {
    slug: "cookies",
    title: "Cookie Notice",
    version: "v3-cookies-1",
    status: pending,
    summary: "What Plexecute stores in your browser.",
    sections: [
      {
        heading: "Only what's needed",
        body: [
          "Plexecute stores only what's needed to work: your sign-in session, your offline queue so actions made without signal sync later, a cached copy of today's plan, a note of reminders already shown, and whether the side menu is open.",
          "There are no advertising or cross-site tracking cookies, so no cookie banner is needed. If optional analytics are ever added, you'll be asked first.",
        ],
      },
    ],
  },
  {
    slug: "health-disclaimer",
    title: "Health and Wellness Disclaimer",
    version: CONSENT_VERSIONS.safety_acknowledgement,
    status: pending,
    summary: "Plexecute is not medical care.",
    sections: [
      {
        heading: "Not medical advice",
        body: [
          "Plexecute is a wellness and performance planner. It does not diagnose, treat or prevent any condition, and it is not a medical device.",
          "Talk to a qualified professional before changing exercise, diet or sleep if you have a health condition, are pregnant, or take medication.",
          "If you feel unwell, stop. In an emergency call your local emergency number.",
        ],
      },
      {
        heading: "Safety checks",
        body: [
          "Plexecute screens for warning signs and may pause training, calorie targets or calls when something looks unsafe. These checks can miss things and don't replace professional care.",
        ],
      },
    ],
  },
  {
    slug: "ai",
    title: "AI Transparency Notice",
    version: "v3-ai-1",
    status: pending,
    summary: "Where AI is used and where it isn't.",
    sections: [
      {
        heading: "What AI does",
        body: [
          "Writes coach replies, reads public sources for career research, writes study questions from your own notes, suggests foods from text or photos, and speaks on Execute live voice calls.",
          "AI-suggested changes to your plan, foods or profile are always shown for you to confirm first.",
        ],
      },
      {
        heading: "What AI never does",
        body: [
          "Your weekly schedule, calorie targets, training progression and rewards are worked out by fixed rules, not AI.",
          "AI doesn't decide when to remind or call you.",
        ],
      },
      { heading: "Calls", body: [`Every call opens with: "${DISCLOSURE}"`] },
      {
        heading: "Your data",
        body: [
          "Content is sent to the AI service only to produce your answer. Photos aren't stored. Call audio isn't stored.",
        ],
      },
    ],
  },
  {
    slug: "calling",
    title: "Paid Calling Consent and Acceptable Use",
    version: CALL_CONSENT_VERSION,
    status: pending,
    summary: "How accountability calls work and what you agree to.",
    sections: [
      {
        heading: "What you agree to",
        body: [
          "Accountability calls are automated AI calls to your own verified phone number, at times linked to your plan. You turn them on yourself and can turn them off in Settings at any time, or press 9 during a call to stop all calls.",
          "Calls happen only in countries where they've been cleared, within permitted hours, and never during quiet hours you set.",
        ],
      },
      {
        heading: "Acceptable use",
        body: ["Only add a number you own. Don't use calls to contact anyone else."],
      },
      {
        heading: "Allowances",
        body: [
          `Pro includes a monthly allowance of call check-ins. Execute includes persistent calls and connected voice minutes; extra 60-minute top-ups cost ${gbp(VOICE_TOPUP.pence)}. ${TOPUP_RULE}`,
        ],
      },
    ],
  },
  {
    slug: "subscriptions",
    title: "Subscription and Cancellation Terms",
    version: "v3-subs-1",
    status: pending,
    summary: "Renewals, trials, cancelling and refunds.",
    sections: [
      {
        heading: "Prices",
        body: [`Pro: ${price("pro")}. Execute: ${price("execute")}. UK prices include VAT.`],
      },
      {
        heading: "Renewal",
        body: ["Plans renew automatically at the end of each month or year until you cancel."],
      },
      {
        heading: "Free trial",
        body: [
          `Paid plans can start with a one-time ${TRIAL.days}-day free trial. Your card is charged when the trial ends unless you cancel first. Calls during a trial have smaller limits.`,
        ],
      },
      {
        heading: "Cancelling",
        body: [
          "Cancel any time from Plan & billing → Manage subscription. You keep your plan until the end of the period you paid for.",
        ],
      },
      {
        heading: "Execute monthly reward",
        body: [
          `Complete 100% of your accepted monthly Execute plan and your next monthly Execute renewal is ${gbp(PRODUCTS.execute.month.pence - 1000)} instead of ${gbp(PRODUCTS.execute.month.pence)} (${usd(PRODUCTS.execute.month.cents - 1000)} instead of ${usd(PRODUCTS.execute.month.cents)} for US members). There's no partial reward.`,
        ],
      },
    ],
  },
  {
    slug: "data-rights",
    title: "Data Rights",
    version: "v3-rights-1",
    status: pending,
    summary: "How to see, download, correct or delete your data.",
    sections: [
      {
        heading: "Do it yourself",
        body: [
          "Settings → Privacy lets you download all your data, delete all your data while keeping your account, or close your account. Consents can be withdrawn in Settings at any time.",
        ],
      },
      {
        heading: "Formal requests",
        body: [
          "You can also make a formal access, correction, deletion, restriction or objection request from Settings → Privacy. We respond within 28 days.",
        ],
      },
      {
        heading: "Complaints",
        body: ["In the UK you can complain to the Information Commissioner's Office (ico.org.uk)."],
      },
    ],
  },
  {
    slug: "accessibility",
    title: "Accessibility Statement",
    version: "v3-a11y-1",
    status: pending,
    summary: "How accessible Plexecute is.",
    sections: [
      { heading: "Our aim", body: ["Plexecute aims to meet WCAG 2.2 level AA."] },
      {
        heading: "What's been checked",
        body: [
          "Every page is tested automatically for colour contrast, keyboard use, labelled controls and screen-reader names in light and dark mode, on phone, tablet and computer sizes.",
        ],
      },
      {
        heading: "Known limits",
        body: [
          "Phone screen readers inside native apps haven't been tested yet, because the native apps aren't built yet.",
        ],
      },
      {
        heading: "Tell us",
        body: ["If something is hard to use, send a help request from Help in the app."],
      },
    ],
  },
  {
    slug: "subprocessors",
    title: "Subprocessors",
    version: "v3-subprocessors-1",
    status: pending,
    summary: "Outside services that process member data.",
    sections: [
      {
        heading: "Current list",
        body: [
          "Each service receives only what its feature needs. Optional services receive nothing unless you connect or turn on that feature.",
        ],
      },
    ],
  },
];

export const legalDoc = (slug: string) => LEGAL_DOCS.find((d) => d.slug === slug);
