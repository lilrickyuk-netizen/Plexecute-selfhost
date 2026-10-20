import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  exportMyData,
  getMyPrivacy,
  getPrivacyOps,
  runRetentionNow,
  setProcessingRestriction,
  submitRightsRequest,
  withdrawRightsRequest,
} from "@/lib/privacy.functions";
import { RIGHTS_LABEL, type RightsType } from "@/lib/privacy";

const ASK: RightsType[] = ["rectification", "objection", "complaint"];
const STATUS: Record<string, string> = {
  received: "Received",
  in_progress: "Being handled",
  paused: "On hold",
  completed: "Done",
  rejected: "Declined",
  withdrawn: "Withdrawn",
};
const fmt = (s: string | null) =>
  s
    ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "";

export function PrivacyCentre({
  onWipe,
  onDeleteAccount,
}: {
  onWipe: () => void;
  onDeleteAccount: () => void;
}) {
  const qc = useQueryClient();
  const getFn = useServerFn(getMyPrivacy);
  const exportFn = useServerFn(exportMyData);
  const restrictFn = useServerFn(setProcessingRestriction);
  const submitFn = useServerFn(submitRightsRequest);
  const withdrawFn = useServerFn(withdrawRightsRequest);
  const { data } = useQuery({ queryKey: ["privacy"], queryFn: () => getFn() });
  const [type, setType] = useState<RightsType>("rectification");
  const [details, setDetails] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["privacy"] });

  async function download(kind: "access" | "portability") {
    const out = await exportFn({ data: { kind } });
    const url = URL.createObjectURL(new Blob([out], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `plexecute-${kind === "portability" ? "portable" : "copy"}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    refresh();
  }
  async function restrict(on: boolean) {
    await restrictFn({ data: { restricted: on } });
    toast.success(
      on
        ? "Paused. Coach, calls, nudges and automatic changes are off."
        : "Use of your data is back on.",
    );
    refresh();
  }
  async function send() {
    try {
      const r = await submitFn({ data: { type, details } });
      toast.success(`Request sent. We'll reply by ${fmt(r.dueAt)}.`);
      setDetails("");
      refresh();
    } catch {
      toast.error("Please describe your request in a few words.");
    }
  }

  return (
    <section id="privacy" className="scroll-mt-20 rounded-[20px] border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">Privacy and your data</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your health and behaviour data is never used for advertising. Every request below is
        recorded and answered within 28 days.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" className="rounded-[10px]" onClick={() => download("access")}>
          Download a copy of my data
        </Button>
        <Button
          variant="outline"
          className="rounded-[10px]"
          onClick={() => download("portability")}
        >
          Get my data to move elsewhere
        </Button>
      </div>

      <div className="mt-5 flex items-start justify-between gap-4 rounded-[14px] border border-border p-4">
        <div>
          <p className="font-medium">Pause use of my data</p>
          <p className="text-sm text-muted-foreground">
            Turns off the AI coach, calls, nudges and automatic plan changes. Your data stays and
            you can still see and edit it.
          </p>
        </div>
        <Switch
          aria-label="Pause use of my data"
          checked={!!data?.restricted}
          onCheckedChange={restrict}
        />
      </div>

      <div className="mt-5 rounded-[14px] border border-border p-4">
        <p className="font-medium">Ask us something about your data</p>
        <p className="text-sm text-muted-foreground">
          Correct something, object to how it is used, or make a complaint. Plain words are fine.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {ASK.map((t) => (
            <Button
              key={t}
              size="sm"
              variant={type === t ? "default" : "outline"}
              className="rounded-[10px]"
              onClick={() => setType(t)}
            >
              {RIGHTS_LABEL[t]}
            </Button>
          ))}
        </div>
        <Textarea
          className="mt-3"
          aria-label="Request details"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Tell us what you'd like"
          maxLength={4000}
        />
        <Button className="mt-3 rounded-[10px]" onClick={send} disabled={details.trim().length < 3}>
          Send request
        </Button>
      </div>

      {!!data?.requests.length && (
        <div className="mt-5">
          <p className="font-medium">Your requests</p>
          <ul className="mt-2 divide-y divide-border text-sm">
            {data.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {RIGHTS_LABEL[r.request_type as RightsType] ?? r.request_type} ·{" "}
                  {fmt(r.received_at)}
                </span>
                <span className="text-muted-foreground">
                  {STATUS[r.status] ?? r.status}
                  {["received", "in_progress"].includes(r.status)
                    ? `, reply by ${fmt(r.due_at)}`
                    : ""}
                  {["received", "in_progress", "paused"].includes(r.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-2"
                      onClick={async () => {
                        await withdrawFn({ data: { id: r.id } });
                        refresh();
                      }}
                    >
                      Withdraw
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="mt-5 text-sm">
        <summary className="cursor-pointer font-medium">How long we keep things</summary>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          {data?.retention.map((r) => (
            <li key={r.what}>
              <span className="text-foreground">{r.what}:</span> {r.keep}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-muted-foreground">
          Older records are removed automatically every day.
        </p>
      </details>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="outline" className="rounded-[10px] text-destructive" onClick={onWipe}>
          Delete all my data
        </Button>
        <Button
          variant="outline"
          className="rounded-[10px] text-destructive"
          onClick={onDeleteAccount}
        >
          Delete my account
        </Button>
      </div>
    </section>
  );
}

export function PrivacyOps() {
  const fn = useServerFn(getPrivacyOps);
  const runFn = useServerFn(runRetentionNow);
  const { data, refetch } = useQuery({ queryKey: ["privacy-ops"], queryFn: () => fn() });
  if (!data) return null;
  const removed = data.lastRetention
    ? Object.values(data.lastRetention.removed as Record<string, number>).reduce((a, b) => a + b, 0)
    : 0;
  return (
    <section className="rounded-[20px] border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">Data rights and retention</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <p className="text-muted-foreground">Open requests</p>
          <p className="text-xl font-semibold">{data.open}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Overdue</p>
          <p className="text-xl font-semibold">{data.overdue}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Deletions done</p>
          <p className="text-xl font-semibold">{data.deletionJobs["completed"] ?? 0}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Deletions failed</p>
          <p className="text-xl font-semibold">{data.deletionJobs["failed"] ?? 0}</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Last cleanup:{" "}
        {data.lastRetention
          ? `${fmt(data.lastRetention.ran_at)}, ${removed} old records removed`
          : "not run yet"}
        . Runs daily.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="mt-3 rounded-[10px]"
        onClick={async () => {
          await runFn();
          await refetch();
          toast.success("Cleanup finished");
        }}
      >
        Run cleanup now
      </Button>
    </section>
  );
}
