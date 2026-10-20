import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  adminIncidents,
  adminOpenIncident,
  adminUpdateIncident,
} from "@/lib/admin-console.functions";
import { Section, Loading } from "@/components/AdminUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function IncidentsPanel() {
  const list = useServerFn(adminIncidents);
  const open = useServerFn(adminOpenIncident);
  const update = useServerFn(adminUpdateIncident);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-incidents"], queryFn: () => list() });
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<"minor" | "major" | "critical">("minor");
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-incidents"] });
    qc.invalidateQueries({ queryKey: ["open-incidents"] });
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await open({ data: { title, member_message: message, severity, affected: [] } });
      setTitle("");
      setMessage("");
      refresh();
    } catch {
      setErr("Add a title and a member message of at least 10 characters.");
    }
  };
  return (
    <Section
      title="Incidents"
      note="Open incidents show a notice at the top of every member page until resolved."
    >
      <form onSubmit={submit} className="space-y-2 rounded-[14px] border border-border bg-card p-4">
        <h3 className="text-sm font-medium">Open an incident</h3>
        <Input
          placeholder="Internal title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Incident title"
        />
        <Textarea
          placeholder="What members will see"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-label="Member message"
        />
        <select
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={severity}
          onChange={(e) => setSeverity(e.target.value as typeof severity)}
          aria-label="Severity"
        >
          <option value="minor">Minor</option>
          <option value="major">Major</option>
          <option value="critical">Critical</option>
        </select>
        <Button type="submit">Open incident</Button>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </form>
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No incidents.</p>
      ) : (
        <ul className="space-y-3">
          {data.map((i) => (
            <li key={i.id} className="rounded-[14px] border border-border bg-card p-4 text-sm">
              <p className="font-medium">
                {i.title}{" "}
                <span className="text-xs text-muted-foreground">
                  · {i.severity} · {i.status}
                </span>
              </p>
              <p className="mt-1 text-muted-foreground">{i.member_message}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Started {new Date(i.started_at).toLocaleString()}
                {i.resolved_at ? ` · resolved ${new Date(i.resolved_at).toLocaleString()}` : ""}
              </p>
              {i.status !== "resolved" && (
                <div className="mt-2 flex gap-2">
                  {i.status === "investigating" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await update({ data: { id: i.id, status: "monitoring" } });
                        refresh();
                      }}
                    >
                      Mark monitoring
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={async () => {
                      await update({ data: { id: i.id, status: "resolved" } });
                      refresh();
                    }}
                  >
                    Resolve
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
