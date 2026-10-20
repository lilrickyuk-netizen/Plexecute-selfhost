// V3 §68A Professional Connect: consent-based, domain-granular sharing with a professional the user chose.
import { outputViolations } from "./safety";

export const PRO_ROLES = [
  "PERSONAL_TRAINER",
  "COACH",
  "DIETITIAN_OR_NUTRITION_PROFESSIONAL",
  "PHYSIOTHERAPY_OR_REHAB_PROFESSIONAL",
  "MENTOR",
  "OTHER_USER_NAMED_PROFESSIONAL",
] as const;
export type ProRole = (typeof PRO_ROLES)[number];
export const ROLE_LABEL: Record<ProRole, string> = {
  PERSONAL_TRAINER: "Personal trainer",
  COACH: "Coach",
  DIETITIAN_OR_NUTRITION_PROFESSIONAL: "Dietitian or nutrition professional",
  PHYSIOTHERAPY_OR_REHAB_PROFESSIONAL: "Physiotherapy or rehab professional",
  MENTOR: "Mentor",
  OTHER_USER_NAMED_PROFESSIONAL: "Other professional",
};

export const CREDENTIAL_STATUSES = [
  "UNVERIFIED",
  "VERIFIED_BY_PLEXECUTE_PROCESS",
  "USER_ASSERTED",
] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];
export const CREDENTIAL_LABEL: Record<CredentialStatus, string> = {
  UNVERIFIED: "Credentials not verified",
  VERIFIED_BY_PLEXECUTE_PROCESS: "Verified by Plexecute",
  USER_ASSERTED: "Credentials stated by you, not checked by Plexecute",
};

export const PRO_PERMISSIONS = [
  "VIEW_SELECTED_PROGRESS",
  "VIEW_SELECTED_PLAN",
  "VIEW_SELECTED_TRAINING",
  "VIEW_SELECTED_NUTRITION",
  "VIEW_SELECTED_RECOVERY",
  "COMMENT",
  "PROPOSE_CONSTRAINT_OR_PLAN_CHANGE",
] as const;
export type ProPermission = (typeof PRO_PERMISSIONS)[number];
export const PERMISSION_LABEL: Record<ProPermission, string> = {
  VIEW_SELECTED_PROGRESS: "See my progress",
  VIEW_SELECTED_PLAN: "See my plan",
  VIEW_SELECTED_TRAINING: "See my training",
  VIEW_SELECTED_NUTRITION: "See my nutrition",
  VIEW_SELECTED_RECOVERY: "See my recovery and sleep",
  COMMENT: "Leave comments",
  PROPOSE_CONSTRAINT_OR_PLAN_CHANGE: "Suggest rules or plan changes",
};

/** Health / special-category domains: each needs its own explicit consent for this professional. */
export const HEALTH_PERMISSIONS: readonly ProPermission[] = [
  "VIEW_SELECTED_TRAINING",
  "VIEW_SELECTED_NUTRITION",
  "VIEW_SELECTED_RECOVERY",
];

/** Permissions actually in force: a health permission without its consent grants nothing. */
export function effectivePermissions(
  perms: readonly string[],
  consent: readonly string[],
): ProPermission[] {
  return PRO_PERMISSIONS.filter(
    (p) => perms.includes(p) && (!HEALTH_PERMISSIONS.includes(p) || consent.includes(p)),
  );
}

export const INVITE_DAYS = 7;

/** Plexecute's safety rules still apply to a professional's suggestion before the user can accept it. */
export function screenProposal(text: string): string | null {
  const v = outputViolations(text);
  if (v.includes("very_low_energy"))
    return "This suggests a very low calorie intake. Plexecute can't apply it automatically; please discuss it directly with your professional.";
  if (v.includes("medication"))
    return "This involves medication. Plexecute can't apply it; please follow it up with your professional or GP directly.";
  if (v.length)
    return "Plexecute can't apply this automatically. Please discuss it directly with your professional.";
  return null;
}
