import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  ExternalLink,
  Flag,
  MessageSquare,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSessionBrief } from "@/lib/session-brief.functions";
import { BlockRow } from "@/components/BlockRow";
import { SessionCta } from "@/components/SessionCta";
import { useProfile, type Block } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/app/session/$id")({
  head: () => ({
    meta: [
      { title: "Session | Plexecute" },
      {
        name: "description",
        content: "What to do, why it matters, how to start and when you are done.",
      },
      { property: "og:title", content: "Session | Plexecute" },
      {
        property: "og:description",
        content: "What to do, why it matters, how to start and when you are done.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Session,
});

function Session() {
  const { id } = Route.useParams();
  const fetchBrief = useServerFn(getSessionBrief);
  const { data: profile } = useProfile();
  const tz = profile?.timezone ?? "UTC";
  const { data: block } = useQuery({
    queryKey: ["block", id],
    queryFn: async () =>
      (await supabase.from("plan_blocks").select("*").eq("id", id).maybeSingle())
        .data as Block | null,
  });
  const { data: s, isLoading } = useQuery({
    queryKey: ["session-brief", id, block?.status, block?.starts_at],
    queryFn: () => fetchBrief({ data: { blockId: id } }),
    enabled: !!block,
  });

  if (!isLoading && block === null)
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">This session is no longer on your plan.</p>
        <Link to="/app/plan" className="text-execute">
          Back to your plan
        </Link>
      </div>
    );
  if (!s || !block) return <p className="text-sm text-muted-foreground">Preparing your session…</p>;

  const time = new Date(s.startsAt).toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/app/plan" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Plan
      </Link>
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {time} · {s.durationMin} min
        </p>
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="text-lg text-execute" data-testid="session-objective">
          {s.objective}
        </p>
      </header>

      <section className="rounded-[20px] border border-border bg-card p-5 space-y-4">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Start here</p>
          <p className="mt-1 font-medium" data-testid="session-first-step">
            {s.firstStep}
          </p>
        </div>
        <SessionCta cta={s.primary} block={block} brief={s} primary />
        <div className="flex flex-wrap gap-2">
          {s.secondary.map((c) => (
            <SessionCta key={c.label} cta={c} block={block} brief={s} />
          ))}
        </div>
      </section>

      {s.missing.length > 0 && (
        <section
          className="rounded-[16px] border border-border bg-card p-4"
          data-testid="session-missing"
        >
          {s.missing.map((m) => (
            <p key={m} className="flex items-start gap-2 text-sm">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {m}
            </p>
          ))}
        </section>
      )}

      {s.steps.length > 1 && (
        <Section title="Then">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {s.steps.slice(1).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
        </Section>
      )}
      {s.details.map((d) => (
        <Section key={d.label} title={d.label}>
          <ul className="space-y-1 text-sm">
            {d.items.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Section>
      ))}
      {s.resources.length > 0 && (
        <Section title="Resources">
          <ul className="space-y-2">
            {s.resources.map((r) => (
              <li key={r.url}>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-[12px] border border-border px-3 py-2 text-sm hover:border-execute/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.title}</span>
                    <span className="text-xs text-muted-foreground">{r.source}</span>
                  </span>
                  <ExternalLink className="h-4 w-4 shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Done when">
        <p className="flex items-start gap-2 text-sm" data-testid="session-completion">
          <Flag className="mt-0.5 h-4 w-4 shrink-0" /> {s.completion}
        </p>
        {s.next && (
          <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" /> {s.next}
          </p>
        )}
      </Section>
      {s.why.length > 0 && (
        <Section title="Why this matters">
          <ul className="space-y-1 text-sm text-muted-foreground">
            {s.why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Status">
        <BlockRow block={block} />
      </Section>
      <Link
        to="/app/coach"
        search={{ session: s.blockId }}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-execute"
      >
        <MessageSquare className="h-4 w-4" /> Ask Coach about this session
      </Link>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}
