import { Link } from "@tanstack/react-router";
import { PublicPage } from "@/components/PublicPage";
import {
  COMPANY_LINE,
  LEGAL_DOCS,
  OWNER_DETAILS_PENDING,
  SUBPROCESSORS,
  type LegalDoc,
} from "@/lib/legal";

export function LegalDocView({ doc }: { doc: LegalDoc }) {
  return (
    <PublicPage title={doc.title}>
      {doc.status !== "approved" && (
        <p
          role="note"
          className="rounded-[12px] border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
        >
          This explains how Plexecute works today. The final wording is waiting for legal approval.{" "}
          {OWNER_DETAILS_PENDING}
        </p>
      )}
      <p className="text-xs">Version {doc.version}</p>
      <section>
        <h2>Who we are</h2>
        <p className="mt-2">{COMPANY_LINE}</p>
      </section>
      {doc.sections.map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          {s.body.map((b, i) => (
            <p key={i} className="mt-2">
              {b}
            </p>
          ))}
        </section>
      ))}
      {doc.slug === "subprocessors" && (
        <div className="overflow-x-auto">
          <table className="mt-4 w-full min-w-[560px] text-left text-sm">
            <thead className="text-foreground">
              <tr>
                <th className="py-2 pr-3">Service</th>
                <th className="pr-3">Used for</th>
                <th className="pr-3">Data it receives</th>
                <th>Where</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((p) => (
                <tr key={p.name} className="border-t border-border align-top">
                  <td className="py-2 pr-3 text-foreground">{p.name}</td>
                  <td className="pr-3">{p.purpose}</td>
                  <td className="pr-3">{p.data}</td>
                  <td>{p.region}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2>Other documents</h2>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {LEGAL_DOCS.filter((d) => d.slug !== doc.slug).map((d) => (
          <li key={d.slug}>
            <Link to="/legal/$doc" params={{ doc: d.slug }} className="underline">
              {d.title}
            </Link>
          </li>
        ))}
      </ul>
    </PublicPage>
  );
}
