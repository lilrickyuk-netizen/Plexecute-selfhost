/** V3 §59 consent model: one vocabulary shared by every domain. Pure, browser-safe. */
export const CONSENT_VERSIONS = {
  terms_and_privacy: "v3-terms-1",
  safety_acknowledgement: "v3-safety-1",
  age_confirmation: "v3-age-18",
  health_data: "v3-health-1",
  wearable_data: "v3-wearable-1",
  calendar_access: "v3-calendar-1",
  professional_sharing: "v3-pro-share-1",
} as const;
export type ConsentPurpose =
  keyof typeof CONSENT_VERSIONS | "accountability_calls" | `auto_adapt:${string}`;

export const PURPOSE_LABEL: Record<string, string> = {
  terms_and_privacy: "Terms and privacy notice",
  safety_acknowledgement: "Safety notice (not medical advice)",
  age_confirmation: "Confirmed 18 or older",
  health_data: "Health app data",
  wearable_data: "Wearable data",
  calendar_access: "Calendar access",
  professional_sharing: "Sharing with a professional",
  accountability_calls: "Accountability calls",
};
export const purposeLabel = (p: string) =>
  PURPOSE_LABEL[p] ??
  (p.startsWith("auto_adapt:")
    ? `Automatic changes: ${p.slice(11).replace(/_/g, " ")}`
    : p.replace(/_/g, " "));

export type ConsentRow = {
  purpose: string;
  action: string;
  policy_version: string;
  created_at: string;
  scope: string[] | null;
  source: string;
  provider: string | null;
  domain: string | null;
  subject_id: string | null;
};
export type ConsentState = ConsentRow & { granted: boolean; history: number };

/** Latest record per (purpose, subject) decides the current state; withdrawn always wins over older grants. */
export function currentConsents(rows: ConsentRow[]): ConsentState[] {
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const map = new Map<string, ConsentState>();
  for (const r of sorted) {
    const k = `${r.purpose}|${r.subject_id ?? ""}`;
    const cur = map.get(k);
    if (cur) cur.history++;
    else map.set(k, { ...r, granted: r.action === "granted", history: 1 });
  }
  return [...map.values()];
}
