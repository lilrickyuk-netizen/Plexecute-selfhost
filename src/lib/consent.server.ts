import { CONSENT_VERSIONS } from "./consent";

type Db = {
  from: (t: "consent_records") => {
    insert: (r: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  };
};

/** The only writer of consent_records for data-access consents (append-only table). */
export async function recordConsent(
  db: unknown,
  r: {
    userId: string;
    purpose: keyof typeof CONSENT_VERSIONS;
    granted: boolean;
    scope?: string[];
    source?: string;
    provider?: string | null;
    domain?: string | null;
    subjectId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await (db as Db).from("consent_records").insert({
    user_id: r.userId,
    purpose: r.purpose,
    action: r.granted ? "granted" : "withdrawn",
    policy_version: CONSENT_VERSIONS[r.purpose],
    scope: r.scope ?? [],
    source: r.source ?? "app",
    provider: r.provider ?? null,
    domain: r.domain ?? null,
    subject_id: r.subjectId ?? null,
    metadata: r.metadata ?? {},
  });
  if (error) {
    console.error("consent record failed", error);
    throw new Error("Your choice couldn't be saved. Please try again.");
  }
}
