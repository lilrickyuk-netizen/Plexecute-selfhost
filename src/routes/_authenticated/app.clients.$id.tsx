import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getClientView, sendProMessage, sendProProposal } from "@/lib/professional.functions";
import { PERMISSION_LABEL } from "@/lib/professional";

export const Route = createFileRoute("/_authenticated/app/clients/$id")({
  head: () => ({
    meta: [
      { title: "Client · Plexecute" },
      { name: "description", content: "What your client has chosen to share with you." },
      { property: "og:title", content: "Client · Plexecute" },
      { property: "og:description", content: "What your client has chosen to share with you." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Client,
});

const when = (s: string) =>
  new Date(s).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Client() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const get = useServerFn(getClientView),
    msg = useServerFn(sendProMessage),
    prop = useServerFn(sendProProposal);
  const { data: v, error } = useQuery({
    queryKey: ["pro-client", id],
    queryFn: () => get({ data: { id } }),
    retry: false,
  });
  const [text, setText] = useState("");
  const [p, setP] = useState({
    kind: "constraint" as "constraint" | "plan_change",
    title: "",
    detail: "",
    days: [] as number[],
    start: "",
    end: "",
  });
  const card = "rounded-[20px] border border-border bg-card p-5";
  if (error)
    return (
      <div>
        <p className="text-warning">{error.message}</p>
        <Link to="/app/clients" className="text-sm underline">
          Back
        </Link>
      </div>
    );
  if (!v) return <p className="text-muted-foreground">Loading…</p>;
  const refresh = () => qc.invalidateQueries({ queryKey: ["pro-client", id] });

  return (
    <div className="space-y-5">
      <div>
        <Link to="/app/clients" className="text-sm text-muted-foreground">
          ← My clients
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">{v.client}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Shared with you:{" "}
          {v.perms.map((x) => PERMISSION_LABEL[x].toLowerCase()).join(", ") || "nothing right now"}.
          Each visit is recorded for them.
        </p>
      </div>

      {v.progress && (
        <section className={card}>
          <h2 className="font-semibold">Progress (last 28 days)</h2>
          <p className="mt-1 text-sm">
            {Object.entries(v.progress.last28)
              .map(([k, n]) => `${n} ${k.replace("_", " ")}`)
              .join(" · ") || "No sessions"}
          </p>
          <ul className="mt-2 text-sm">
            {v.progress.goals.map((g, i) => (
              <li key={i}>
                {g.title}
                {g.target_value != null
                  ? `: ${g.current_value ?? "–"} of ${g.target_value} ${g.unit ?? ""}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      {v.plan && (
        <section className={card}>
          <h2 className="font-semibold">Plan (next 14 days)</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {v.plan.map((b, i) => (
              <li key={i}>
                {when(b.starts_at)} · {b.title} · {b.duration_min} min
              </li>
            ))}
          </ul>
        </section>
      )}
      {v.training && (
        <section className={card}>
          <h2 className="font-semibold">Training (last 28 days)</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {v.training.map((t, i) => (
              <li key={i}>
                {when(t.started_at)} · {t.status}
                {t.recovery_state ? ` · recovery ${t.recovery_state}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      {v.nutrition && (
        <section className={card}>
          <h2 className="font-semibold">Nutrition (last 14 days)</h2>
          {v.nutrition.target && (
            <p className="mt-1 text-sm">
              Target {v.nutrition.target.kcal} kcal, {v.nutrition.target.protein_g} g protein
            </p>
          )}
          <ul className="mt-2 space-y-1 text-sm">
            {v.nutrition.days.map((d) => (
              <li key={d.day}>
                {d.day} · {d.kcal} kcal · {d.protein_g} g protein
              </li>
            ))}
          </ul>
        </section>
      )}
      {v.recovery && (
        <section className={card}>
          <h2 className="font-semibold">Recovery check-ins (last 14 days)</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {v.recovery.map((r) => (
              <li key={r.check_date}>
                {r.check_date} · {r.readiness ?? "–"} · sleep {r.sleep_quality ?? "–"}/5 · energy{" "}
                {r.energy ?? "–"}/5{r.ill_or_injured ? " · ill or injured" : ""}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Self-reported check-ins, not a medical assessment.
          </p>
        </section>
      )}

      {v.perms.includes("COMMENT") && (
        <section className={card}>
          <h2 className="font-semibold">Comments</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {v.messages.map((m, i) => (
              <li key={i}>
                <span className="font-medium">
                  {m.author === "professional" ? "You" : v.client}:
                </span>{" "}
                {m.body}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <Input value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
            <Button
              variant="outline"
              className="rounded-[10px]"
              disabled={!text.trim()}
              onClick={async () => {
                try {
                  await msg({ data: { id, body: text } });
                  setText("");
                  refresh();
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Send
            </Button>
          </div>
        </section>
      )}

      {v.perms.includes("PROPOSE_CONSTRAINT_OR_PLAN_CHANGE") && (
        <section className={card}>
          <h2 className="font-semibold">Suggest a rule or plan change</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Nothing changes until {v.client} accepts. Plexecute's safety rules still apply.
          </p>
          <div className="mt-3 flex gap-4 text-sm">
            {(["constraint", "plan_change"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={p.kind === k}
                  onChange={() => setP({ ...p, kind: k })}
                />
                {k === "constraint" ? "A rule to follow" : "A fixed time in their week"}
              </label>
            ))}
          </div>
          <div className="mt-2 space-y-2">
            <Label>Title</Label>
            <Input
              aria-label="Title"
              value={p.title}
              maxLength={120}
              onChange={(e) => setP({ ...p, title: e.target.value })}
            />
            <Label>Details</Label>
            <Input
              aria-label="Details"
              value={p.detail}
              maxLength={2000}
              onChange={(e) => setP({ ...p, detail: e.target.value })}
            />
          </div>
          {p.kind === "plan_change" && (
            <div className="mt-2 space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d, i) => (
                  <label key={d} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={p.days.includes(i + 1)}
                      onChange={() =>
                        setP({
                          ...p,
                          days: p.days.includes(i + 1)
                            ? p.days.filter((x) => x !== i + 1)
                            : [...p.days, i + 1],
                        })
                      }
                    />
                    {d}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  type="time"
                  value={p.start}
                  onChange={(e) => setP({ ...p, start: e.target.value })}
                />
                <Input
                  type="time"
                  value={p.end}
                  onChange={(e) => setP({ ...p, end: e.target.value })}
                />
              </div>
            </div>
          )}
          <Button
            className="mt-3 rounded-[10px]"
            disabled={
              !p.title.trim() ||
              (p.kind === "plan_change" && (!p.days.length || !p.start || !p.end))
            }
            onClick={async () => {
              try {
                const r = await prop({
                  data: {
                    id,
                    kind: p.kind,
                    title: p.title,
                    detail: p.detail || undefined,
                    schedule:
                      p.kind === "plan_change"
                        ? { days: p.days, start_time: p.start, end_time: p.end }
                        : undefined,
                  },
                });
                if (r.blocked) toast.error(r.blocked);
                else toast.success("Sent for their approval.");
                setP({ ...p, title: "", detail: "" });
                refresh();
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Send suggestion
          </Button>
          <ul className="mt-3 space-y-1 text-xs">
            {v.proposals.map((x, i) => (
              <li key={i}>
                {x.title} · {x.status}
                {x.safety_reason ? ` · ${x.safety_reason}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
