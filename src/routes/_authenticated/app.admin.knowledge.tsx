import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { adminKnowledge } from "@/lib/admin-console.functions";
import { rebuildKnowledgeIndex } from "@/lib/knowledge.functions";
import { Stat, Section, Loading } from "@/components/AdminUI";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/app/admin/knowledge")({
  head: () => ({
    meta: [
      { title: "Admin knowledge | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Admin knowledge in Plexecute." },
      { property: "og:title", content: "Admin knowledge | Plexecute" },
      { property: "og:description", content: "Manage Admin knowledge in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const fn = useServerFn(adminKnowledge);
  const rebuild = useServerFn(rebuildKnowledgeIndex);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-knowledge"], queryFn: () => fn() });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await rebuild();
      setMsg(
        `Rebuilt ${r.sources} sources into ${r.chunks} search passages${r.embedded ? ", with meaning-based search" : ", word search only"}.`,
      );
      qc.invalidateQueries({ queryKey: ["admin-knowledge"] });
    } catch {
      setMsg("Rebuild failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Knowledge" note="Evidence sources the coach cites, with review dates.">
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="Sources" value={data.sources.length} />
            <Stat label="Search passages" value={data.chunks} />
            <Stat label="Review overdue" value={data.sources.filter((s) => s.reviewDue).length} />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={run} disabled={busy}>
              {busy ? "Rebuilding…" : "Rebuild search index"}
            </Button>
            {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
          </div>
          <h3 className="mt-2 text-sm font-semibold">Recent Coach knowledge routing</h3>
          <ul className="divide-y divide-border rounded-[14px] border border-border bg-card text-xs">
            {data.routing.length === 0 && (
              <li className="p-3 text-muted-foreground">No turns yet.</li>
            )}
            {data.routing.map((r: any, i: number) => (
              <li key={i} className="space-y-1 p-3">
                <p className="font-medium">
                  {new Date(r.at).toLocaleString()} · {r.intent ?? "?"} · {r.action_class ?? "?"} ·
                  knowledge {r.knowledge_status} ({r.knowledge_method})
                </p>
                <p className="text-muted-foreground">
                  Areas: {(r.message_domains ?? []).join(", ") || "none"} · Specialists:{" "}
                  {(r.specialists ?? []).join(", ") || "none"} · Knowledge domains:{" "}
                  {(r.knowledge_domains ?? []).join(", ") || "none"}
                </p>
                <p className="text-muted-foreground">
                  Retrieved:{" "}
                  {(r.retrieved ?? []).map((x: any) => `${x.id} (${x.score})`).join(", ") || "none"}
                  {r.tool_evidence_refs?.length
                    ? ` · via tools: ${r.tool_evidence_refs.join(", ")}`
                    : ""}
                </p>
                <p className="text-muted-foreground">
                  Research: {r.research_invoked ? "yes" : "no"} · Mission changed:{" "}
                  {r.mission_changed ? "yes" : "no"} · Tools: {(r.tools ?? []).join(", ") || "none"}
                </p>
              </li>
            ))}
          </ul>
          <ul className="divide-y divide-border rounded-[14px] border border-border bg-card text-sm">
            {data.sources.map((s) => (
              <li key={s.source_id} className="p-3">
                <p>{s.title}</p>
                <p className="text-xs text-muted-foreground">
                  {s.domain} · tier {s.trust_tier} · reviewed {s.last_reviewed ?? "never"} · indexed{" "}
                  {s.indexed_at ? new Date(s.indexed_at).toLocaleDateString() : "not yet"}
                  {s.superseded_by ? ` · replaced by ${s.superseded_by}` : ""}
                  {s.reviewDue ? " · review due" : ""}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
