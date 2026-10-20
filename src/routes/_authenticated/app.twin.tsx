import { FeatureHeader } from "@/components/FeatureHeader";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Lock, Unlock, History, AlertTriangle, Fingerprint } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { proposeWeekPlan } from "@/lib/planning.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/app/twin")({
  head: () => ({
    meta: [
      { title: "Your Life Twin · Plexecute" },
      {
        name: "description",
        content: "See and correct everything Plexecute knows about your life.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Your Life Twin · Plexecute" },
      {
        property: "og:description",
        content: "See and correct everything Plexecute knows about your life.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TwinPage,
});

type Fact = {
  id: string;
  domain: string;
  fact_key: string;
  fact_value: unknown;
  source: string;
  confidence: number;
  valid_from: string;
  valid_until: string | null;
  is_locked: boolean;
  version: number;
  supersedes_id: string | null;
  source_ref: string | null;
  observed_at: string;
};

const SOURCE: Record<string, string> = {
  USER_ASSERTED: "You told us",
  OBSERVED: "Measured",
  DERIVED: "Calculated",
  AI_INFERRED: "Coach guess",
};
const LABEL = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const show = (v: unknown): string => {
  if (v == null) return "Not set";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.length ? v.map(show).join(", ") : "None";
  return Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${LABEL(k)}: ${show(x)}`)
    .join(" · ");
};
/** Facts that change scheduling: correcting them proposes a new plan for approval. */
const PLAN_KEYS = new Set(["routine", "study_availability", "state", "preferences"]);

function TwinPage() {
  const qc = useQueryClient();
  const propose = useServerFn(proposeWeekPlan);
  const { data: facts = [] } = useQuery({
    queryKey: ["twin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("life_twin_facts")
        .select("*")
        .order("version", { ascending: false });
      if (error) throw error;
      return data as Fact[];
    },
  });
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const current = facts.filter((f) => !f.valid_until);
  const keys = [...new Set(current.map((f) => `${f.domain}|${f.fact_key}`))];
  const byDomain = keys.reduce<Record<string, string[]>>(
    (a, k) => ((a[k.split("|")[0] ?? ""] ??= []).push(k), a),
    {},
  );

  async function correct(old: Fact, raw: string): Promise<void> {
    let value: unknown = raw;
    if (typeof old.fact_value !== "string") {
      try {
        value = JSON.parse(raw);
      } catch {
        toast.error("Keep the same format as before.");
        return;
      }
    }
    const { data: u } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const siblings = current.filter((f) => f.domain === old.domain && f.fact_key === old.fact_key);
    const { error } = await supabase.from("life_twin_facts").insert({
      user_id: u.user!.id,
      domain: old.domain,
      fact_key: old.fact_key,
      fact_value: value as never,
      source: "USER_ASSERTED",
      source_ref: "life_twin_page",
      confidence: 1,
      version:
        Math.max(
          ...facts
            .filter((f) => f.fact_key === old.fact_key && f.domain === old.domain)
            .map((f) => f.version),
        ) + 1,
      supersedes_id: old.id,
      is_locked: old.is_locked,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase
      .from("life_twin_facts")
      .update({ valid_until: now })
      .in(
        "id",
        siblings.map((s) => s.id),
      );
    if (old.fact_key === "routine" && value && typeof value === "object") {
      const v = value as { wake?: string; bed?: string };
      await supabase
        .from("profiles")
        .update({
          ...(v.wake ? { wake_time: v.wake } : {}),
          ...(v.bed ? { sleep_time: v.bed } : {}),
        })
        .eq("id", u.user!.id);
    }
    if (PLAN_KEYS.has(old.fact_key)) {
      try {
        await propose({ data: { trigger: "system" } });
        toast.success("Saved. A new plan is waiting for approval on Plan.");
      } catch {
        toast.success("Saved.");
      }
    } else toast.success("Saved.");
    setEdit(null);
    qc.invalidateQueries({ queryKey: ["twin"] });
  }

  async function lock(f: Fact): Promise<void> {
    const { error } = await supabase
      .from("life_twin_facts")
      .update({ is_locked: !f.is_locked })
      .eq("id", f.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["twin"] });
  }

  return (
    <div className="space-y-6">
      <div>
        <FeatureHeader
          title="Your Life Twin"
          icon={Fingerprint}
          description="Everything Plexecute uses to plan for you, where it came from and how sure we are. Correct anything that's wrong; locked items are never changed by the coach or by measurements."
        />
      </div>
      {keys.length === 0 && (
        <p className="rounded-[16px] border border-border bg-card p-6 text-sm text-muted-foreground">
          Nothing recorded yet. Your Life Audit answers will appear here.
        </p>
      )}
      {Object.entries(byDomain).map(([domain, ks]) => (
        <section key={domain} className="rounded-[20px] border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-widest text-muted-foreground">
            {LABEL(domain)}
          </h2>
          <div className="space-y-3">
            {ks.map((k) => {
              const [d = "", key = ""] = k.split("|");
              const live = current.filter((f) => f.domain === d && f.fact_key === key);
              const f = live[0];
              if (!f) return null;
              const conflict = new Set(live.map((x) => show(x.fact_value))).size > 1;
              const past = facts.filter(
                (x) => x.domain === d && x.fact_key === key && x.valid_until,
              );
              return (
                <div key={k} className="rounded-[14px] border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{LABEL(key)}</div>
                      {edit?.id === f.id ? (
                        <div className="mt-2 flex gap-2">
                          <Input
                            value={edit.text}
                            onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                          />
                          <Button size="sm" onClick={() => correct(f, edit.text)}>
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="mt-1 break-words text-sm text-muted-foreground">
                          {show(f.fact_value) || "—"}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                          {SOURCE[f.source] ?? f.source}
                        </span>
                        <span>{Math.round(f.confidence * 100)}% sure</span>
                        {f.source_ref && <span>{f.source_ref}</span>}
                        <span>observed {new Date(f.observed_at).toLocaleString()}</span>
                        <span>v{f.version}</span>
                      </div>
                      {conflict && (
                        <div className="mt-2 space-y-1 rounded-[10px] bg-warning/10 p-2 text-xs text-warning">
                          <div className="flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" /> These sources disagree. Pick
                            the right one:
                          </div>
                          {live.map((x) => (
                            <button
                              key={x.id}
                              className="block underline"
                              onClick={() => correct(x, show(x.fact_value))}
                            >
                              {show(x.fact_value)} ({SOURCE[x.source] ?? x.source})
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={f.is_locked ? "Unlock" : "Lock"}
                        onClick={() => lock(f)}
                      >
                        {f.is_locked ? (
                          <Lock className="h-4 w-4" />
                        ) : (
                          <Unlock className="h-4 w-4" />
                        )}
                      </Button>
                      {past.length > 0 && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="History"
                          onClick={() => setOpen(open === k ? null : k)}
                        >
                          <History className="h-4 w-4" />
                        </Button>
                      )}
                      {edit?.id !== f.id && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEdit({ id: f.id, text: show(f.fact_value) })}
                        >
                          Correct
                        </Button>
                      )}
                    </div>
                  </div>
                  {open === k && (
                    <ul className="mt-3 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                      {past.map((x) => (
                        <li key={x.id}>
                          v{x.version}: {show(x.fact_value)} · {SOURCE[x.source] ?? x.source} ·
                          until {new Date(x.valid_until!).toLocaleDateString()}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
