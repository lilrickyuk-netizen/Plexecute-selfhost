import { Link, useRouterState } from "@tanstack/react-router";
import { WithVoice } from "@/components/VoiceInputButton";
import { rows } from "@/lib/rows";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/lib/data";
import { submitSupportRequest } from "@/lib/support.functions";
import {
  CATEGORY_LABELS,
  SELF_SERVICE,
  SUPPORT_CATEGORIES,
  SUPPORT_HOURS,
  supportFor,
  type SupportCategory,
} from "@/lib/support";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

export function SupportPanel() {
  const { data: profile } = useProfile();
  const model = supportFor(profile?.tier);
  const send = useServerFn(submitSupportRequest);
  const qc = useQueryClient();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const [category, setCategory] = useState<SupportCategory>("account");
  const [message, setMessage] = useState("");
  const [diag, setDiag] = useState(true);
  const [state, setState] = useState<{ kind: "idle" | "sent" | "urgent" | "error"; text?: string }>(
    { kind: "idle" },
  );
  const [busy, setBusy] = useState(false);
  const { data: mine } = useQuery({
    queryKey: ["support-requests"],
    queryFn: async () =>
      rows(
        await supabase
          .from("support_requests")
          .select("id,category,status,target_label,created_at")
          .order("created_at", { ascending: false })
          .limit(10),
      ),
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setState({ kind: "idle" });
    const diagnostics = diag
      ? {
          page: path,
          online: navigator.onLine,
          browser: navigator.userAgent,
          screen: `${window.innerWidth}x${window.innerHeight}`,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }
      : null;
    try {
      const r = await send({ data: { category, message, diagnostics } });
      if (r.urgent) setState({ kind: "urgent" });
      else {
        setMessage("");
        setState({
          kind: "sent",
          text: `Sent. Our target reply time for your plan is ${r.target}.`,
        });
        qc.invalidateQueries({ queryKey: ["support-requests"] });
      }
    } catch (err) {
      setState({
        kind: "error",
        text:
          err instanceof Error && err.message.startsWith("Too many")
            ? err.message
            : "Write at least 10 characters, then try again.",
      });
    } finally {
      setBusy(false);
    }
  };
  const routes = SELF_SERVICE[category];
  return (
    <section className="mt-8 space-y-4">
      <h2 className="text-lg font-semibold">Contact support</h2>
      <div className="rounded-[20px] border border-border bg-card p-5 text-sm">
        <p className="font-medium capitalize">
          {profile?.tier ?? "free"} plan: {model.channel}
        </p>
        <p className="mt-1 text-muted-foreground">
          Target reply time: {model.target}. Support hours: {SUPPORT_HOURS}. Support helps with your
          account, plan and the app. It is not medical or emergency help.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-3 rounded-[20px] border border-border bg-card p-5">
        <label className="block text-sm font-medium" htmlFor="support-cat">
          What is it about?
        </label>
        <select
          id="support-cat"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={category}
          onChange={(e) => setCategory(e.target.value as SupportCategory)}
        >
          {SUPPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        {routes && (
          <div className="text-sm">
            <p className="text-muted-foreground">You may be able to sort this straight away:</p>
            <ul className="mt-1 space-y-1">
              {routes.map((r) => (
                <li key={r.to}>
                  <Link to={r.to as "/app/settings"} className="text-execute underline">
                    {r.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <WithVoice value={message} onChange={(v) => setMessage(v)}>
          <Textarea
            aria-label="Your message"
            placeholder="Tell us what happened"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
          />
        </WithVoice>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5 size-5"
            checked={diag}
            onCheckedChange={(v) => setDiag(v === true)}
            aria-label="Include technical details"
          />
          <span>
            Include technical details (page, browser, screen size, time zone, online status). Never
            your plan, food, health or chats.
          </span>
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send to support"}
        </Button>
        {state.kind === "sent" && <p className="text-sm text-primary">{state.text}</p>}
        {state.kind === "error" && <p className="text-sm text-destructive">{state.text}</p>}
        {state.kind === "urgent" && (
          <div
            role="alert"
            className="rounded-[14px] border border-destructive/50 bg-destructive/10 p-3 text-sm"
          >
            It sounds like you may need urgent help. Support can't help with that. If you or someone
            else is in danger, call 999. For urgent health advice, call NHS 111. Samaritans are free
            on 116 123, any time. Your message was not sent.
          </div>
        )}
      </form>
      {!!mine?.length && (
        <div className="rounded-[20px] border border-border bg-card p-5 text-sm">
          <h3 className="font-medium">Your requests</h3>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {mine.map((r) => (
              <li key={r.id}>
                {new Date(r.created_at).toLocaleDateString()} ·{" "}
                {CATEGORY_LABELS[r.category as SupportCategory] ?? r.category} · {r.status} · target{" "}
                {r.target_label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
