import { quoteVerified } from "./research";

export const EMPLOYER_EVIDENCE_POLICY = "open_employers_v3";
export function currentEmployerQuestion(query: string): boolean {
  return (
    /\b(employers?|job adverts?|vacanc(?:y|ies)|hiring|recruit(?:ers?|ment)?)\b/i.test(query) &&
    /\b(now|current(?:ly)?|asking|require(?:ments?|d)?|demand|qualifications?|skills)\b/i.test(
      query,
    )
  );
}
export type EmployerEvidence = {
  source: number;
  employer: string;
  status: "open" | "closed" | "unknown";
  closing_date: string | null;
  status_quote: string;
  reason: string;
  qualifications: string;
  skills: string;
  experience: string;
};
export function verifyEmployerEvidence(
  raw: unknown,
  pages: { markdown?: string }[],
  now: Date,
): EmployerEvidence[] {
  return (Array.isArray(raw) ? raw : []).flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const r = v as Record<string, unknown>;
    const source = Number(r["source"]);
    const page = pages[source];
    if (!page || !Number.isInteger(source)) return [];
    const text = page.markdown ?? "";
    const quote = String(r["status_quote"] ?? "").slice(0, 300);
    const closing =
      typeof r["closing_date"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r["closing_date"])
        ? r["closing_date"]
        : null;
    const expired = closing ? Date.parse(`${closing}T23:59:59Z`) < now.getTime() : false;
    const closed =
      /(?:this (?:job|vacancy|advert|position)|applications?|vacancy) (?:is |has |are |have )?(?:now |been )?(?:closed|expired)|no longer accepting applications|job (?:has )?expired/im.test(
        text,
      );
    const verified =
      quoteVerified(quote, text) ||
      (/^apply now$/i.test(quote.trim()) && text.toLowerCase().includes(quote.toLowerCase()));
    const status =
      expired || closed || r["status"] === "closed"
        ? "closed"
        : r["status"] === "open" &&
            verified &&
            String(r["employer"] ?? "").trim() &&
            (closing ||
              /apply (?:now|for this (?:job|role))|accepting applications|applications? (?:are )?open/i.test(
                quote,
              ))
          ? "open"
          : "unknown";
    return [
      {
        source,
        employer: String(r["employer"] ?? "")
          .trim()
          .slice(0, 160),
        status,
        closing_date: closing,
        status_quote: quote,
        reason: expired
          ? "Closing date has passed"
          : closed
            ? "Page says applications are closed"
            : !verified
              ? "Open-status quote not verified"
              : String(r["reason"] ?? ""),
        qualifications: String(r["qualifications"] ?? "").slice(0, 1000),
        skills: String(r["skills"] ?? "").slice(0, 1000),
        experience: String(r["experience"] ?? "").slice(0, 1000),
      } satisfies EmployerEvidence,
    ];
  });
}
export function employerCoverage(evidence: EmployerEvidence[], pages: { url: string }[]) {
  const open = evidence.filter((e) => e.status === "open");
  const employers = [...new Set(open.map((e) => employerIdentity(e.employer)))];
  const hosts = [
    ...new Set(
      open.flatMap((e) => {
        const p = pages[e.source];
        return p ? [new URL(p.url).hostname.replace(/^www\./, "")] : [];
      }),
    ),
  ];
  return {
    open_adverts: open.length,
    distinct_employers: employers.length,
    source_hosts: hosts,
    sufficient: employers.length >= 3 && hosts.length >= 2,
  };
}

export function employerIdentity(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(limited|ltd|plc|inc)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}
