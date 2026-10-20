// V3 §5.11 support model and Step 66 support flows. Pure rules shared by the Help page, server and tests.

export type Tier = "free" | "pro" | "execute";
export const SUPPORT_CATEGORIES = [
  "account",
  "billing",
  "plan",
  "calls",
  "integrations",
  "bug",
  "other",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SupportCategory, string> = {
  account: "Account and sign in",
  billing: "Plan, payment or refund",
  plan: "My plan or schedule",
  calls: "Accountability calls",
  integrations: "Connected apps and devices",
  bug: "Something isn't working",
  other: "Something else",
};

/** Published support hours, confirmed by the owner. */
export const SUPPORT_HOURS = "8am to 8pm, every day";

/** Locked §5.11 targets. */
export const SUPPORT_MODEL: Record<
  Tier,
  { channel: string; target: string; priority: "standard" | "priority" }
> = {
  free: {
    channel: "Self-service help centre and email",
    target: "3 business days",
    priority: "standard",
  },
  pro: { channel: "Email and in-app support", target: "1 business day", priority: "standard" },
  execute: {
    channel: "Priority support",
    target: `4 business hours during support hours (${SUPPORT_HOURS})`,
    priority: "priority",
  },
};

export function supportFor(tier: string | null | undefined) {
  return SUPPORT_MODEL[(tier === "pro" || tier === "execute" ? tier : "free") as Tier];
}

/** Self-service routes shown before writing in, per category. */
export const SELF_SERVICE: Partial<Record<SupportCategory, { to: string; label: string }[]>> = {
  account: [
    { to: "/app/settings", label: "Settings: sign in, email and security" },
    { to: "/reset-password", label: "Reset password" },
  ],
  billing: [
    { to: "/app/billing", label: "Plan & billing: change, cancel, restore purchases, receipts" },
  ],
  plan: [
    { to: "/app/plan", label: "Plan: suggested changes and explanations" },
    { to: "/app/history", label: "History: every plan change" },
  ],
  calls: [{ to: "/app/accountability", label: "Accountability: call settings and stop calls" }],
};

/** Words that suggest someone needs urgent help, not a support ticket. Never routed as an ordinary request. */
const URGENT =
  /\b(suicid\w*|kill myself|self[- ]harm|overdose|chest pain|can'?t breathe|emergency|collapsed|unconscious)\b/i;
export function looksUrgent(text: string) {
  return URGENT.test(text);
}

/** Diagnostic context: only technical, never content. Members choose whether to include it. */
export type Diagnostics = {
  page?: string | undefined;
  online?: boolean | undefined;
  browser?: string | undefined;
  screen?: string | undefined;
  timezone?: string | undefined;
  appRef?: string | undefined;
  recentErrorRefs?: string[] | undefined;
};
export function cleanDiagnostics(d: Diagnostics | null | undefined): Diagnostics | null {
  if (!d) return null;
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
  return {
    page: s(d.page, 120)?.split("?")[0],
    online: typeof d.online === "boolean" ? d.online : undefined,
    browser: s(d.browser, 200),
    screen: s(d.screen, 20),
    timezone: s(d.timezone, 64),
    appRef: s(d.appRef, 64),
    recentErrorRefs: Array.isArray(d.recentErrorRefs)
      ? d.recentErrorRefs
          .filter((x) => typeof x === "string")
          .slice(0, 5)
          .map((x) => x.slice(0, 64))
      : undefined,
  };
}

export function supportEmailBody(
  r: {
    id: string;
    user_id: string;
    category: string;
    tier: string;
    priority: string;
    target_label: string;
    message: string;
    created_at: string;
    diagnostics: unknown;
  },
  email: string,
) {
  return `Request ID: ${r.id}\nFrom account: ${email} (user ${r.user_id})\nPlan: ${r.tier} (${r.priority}, target ${r.target_label})\nTopic: ${r.category}\nReceived: ${r.created_at}\n\nWhat they wrote:\n${r.message}\n\nDiagnostics: ${r.diagnostics ? JSON.stringify(r.diagnostics, null, 2) : "not included"}\n`;
}
