import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { adminUsersSummary, adminFindUser } from "@/lib/admin-console.functions";
import { Stat, Tally, Section, Loading } from "@/components/AdminUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/app/admin/users/")({
  head: () => ({
    meta: [
      { title: "Admin users | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Admin users in Plexecute." },
      { property: "og:title", content: "Admin users | Plexecute" },
      { property: "og:description", content: "Manage Admin users in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Users,
});

function Users() {
  const summary = useServerFn(adminUsersSummary);
  const find = useServerFn(adminFindUser);
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["admin-users"], queryFn: () => summary() });
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await find({ data: { email, reason } });
      if (r.userId) navigate({ to: "/app/admin/users/$id", params: { id: r.userId } });
      else setMsg("No member has that email.");
    } catch {
      setMsg("Enter a full email address and a reason of at least 5 characters.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="Users"
      note="There is no member list. Look up one member by exact email when supporting them; the reason is logged."
    >
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Members" value={data.total} />
            <Stat label="Finished setup" value={data.onboarded} />
            <Stat label="New (7 days)" value={data.new7} />
            <Stat label="New (30 days)" value={data.new30} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Tally title="By plan" data={data.byTier} />
            <Tally title="By account status" data={data.byStatus} />
          </div>
        </>
      )}
      <form onSubmit={submit} className="space-y-2 rounded-[14px] border border-border bg-card p-4">
        <h3 className="text-sm font-medium">Support lookup</h3>
        <Input
          type="email"
          required
          placeholder="Member's email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Member's email"
        />
        <Input
          required
          minLength={5}
          placeholder="Reason, e.g. billing question by email"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="Reason"
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Looking up…" : "Look up"}
        </Button>
        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      </form>
    </Section>
  );
}
