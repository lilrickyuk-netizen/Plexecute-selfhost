import { Users } from "lucide-react";
import { FeatureHeader } from "@/components/FeatureHeader";
import { createFileRoute } from "@tanstack/react-router";
import { PaidGate } from "@/components/PaidGate";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createShare,
  decideProposal,
  getMyShares,
  revokeShare,
  sendOwnerMessage,
  updateSharePermissions,
} from "@/lib/professional.functions";
import {
  CREDENTIAL_LABEL,
  HEALTH_PERMISSIONS,
  PERMISSION_LABEL,
  PRO_PERMISSIONS,
  PRO_ROLES,
  ROLE_LABEL,
  type CredentialStatus,
  type ProPermission,
  type ProRole,
} from "@/lib/professional";

export const Route = createFileRoute("/_authenticated/app/professionals")({
  head: () => ({
    meta: [
      { title: "Professional Connect · Plexecute" },
      {
        name: "description",
        content:
          "Share chosen parts of your plan with a trainer, coach, dietitian or physio you trust.",
      },
      { property: "og:title", content: "Professional Connect · Plexecute" },
      {
        property: "og:description",
        content:
          "Share chosen parts of your plan with a trainer, coach, dietitian or physio you trust.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <PaidGate cap="professional_connect" title="Professionals">
      <Professionals />
    </PaidGate>
  ),
});

const STATUS: Record<string, string> = {
  invited: "Invitation sent",
  active: "Has access",
  revoked: "Access removed",
  expired: "Invitation expired",
};
const PSTATUS: Record<string, string> = {
  pending: "Waiting for you",
  accepted: "Accepted",
  declined: "Declined",
  blocked: "Blocked by safety rules",
  ended: "Ended",
};
const when = (s: string) =>
  new Date(s).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const toggle = (l: ProPermission[], p: ProPermission) =>
  l.includes(p) ? l.filter((x) => x !== p) : [...l, p];

function PermPicker({
  perms,
  consent,
  onChange,
}: {
  perms: ProPermission[];
  consent: ProPermission[];
  onChange: (p: ProPermission[], c: ProPermission[]) => void;
}) {
  return (
    <div className="space-y-1 text-sm">
      {PRO_PERMISSIONS.map((p) => (
        <div key={p}>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={perms.includes(p)}
              onChange={() =>
                onChange(
                  toggle(perms, p),
                  consent.filter((c) => c !== p),
                )
              }
            />
            {PERMISSION_LABEL[p]}
          </label>
          {HEALTH_PERMISSIONS.includes(p) && perms.includes(p) && (
            <label className="ml-6 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={consent.includes(p)}
                onChange={() => onChange(perms, toggle(consent, p))}
              />
              I consent to sharing this health information with this person. Without this tick, it
              isn't shared.
            </label>
          )}
        </div>
      ))}
    </div>
  );
}

function Professionals() {
  const qc = useQueryClient();
  const get = useServerFn(getMyShares),
    create = useServerFn(createShare),
    upd = useServerFn(updateSharePermissions),
    rev = useServerFn(revokeShare),
    msg = useServerFn(sendOwnerMessage),
    decide = useServerFn(decideProposal);
  const { data } = useQuery({ queryKey: ["pro-shares"], queryFn: () => get() });
  const [f, setF] = useState({
    name: "",
    role: "PERSONAL_TRAINER" as ProRole,
    asserted: false,
    perms: [] as ProPermission[],
    consent: [] as ProPermission[],
  });
  const [link, setLink] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      qc.invalidateQueries({ queryKey: ["pro-shares"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
      qc.invalidateQueries({ queryKey: ["pro-shares"] });
    } finally {
      setBusy(false);
    }
  }
  const card = "rounded-[20px] border border-border bg-card p-5";

  return (
    <div className="space-y-6">
      <div>
        <FeatureHeader
          title="Professional Connect"
          icon={Users}
          description="Share chosen parts of your plan with a professional you already work with. Plexecute isn't a marketplace and doesn't replace them. They see only what you tick, and you can remove access at any time."
        />
      </div>

      <section className={card}>
        <h2 className="text-lg font-semibold">Invite a professional</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="pro-name">Their name</Label>
            <Input
              id="pro-name"
              value={f.name}
              maxLength={80}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pro-role">Their role</Label>
            <select
              id="pro-role"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={f.role}
              onChange={(e) => setF({ ...f, role: e.target.value as ProRole })}
            >
              {PRO_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.asserted}
            onChange={(e) => setF({ ...f, asserted: e.target.checked })}
          />
          They've told me they hold a professional qualification
        </label>
        <p className="text-xs text-muted-foreground">
          Plexecute doesn't check qualifications. This will show as "
          {CREDENTIAL_LABEL[f.asserted ? "USER_ASSERTED" : "UNVERIFIED"]}".
        </p>
        <div className="mt-3">
          <Label>What they can do</Label>
          <div className="mt-2">
            <PermPicker
              perms={f.perms}
              consent={f.consent}
              onChange={(p, c) => setF({ ...f, perms: p, consent: c })}
            />
          </div>
        </div>
        <Button
          className="mt-4 rounded-[10px]"
          disabled={busy || !f.name.trim() || !f.perms.length}
          onClick={() =>
            run(async () => {
              const r = await create({
                data: {
                  name: f.name,
                  role: f.role,
                  userAsserted: f.asserted,
                  permissions: f.perms,
                  healthConsent: f.consent,
                },
              });
              setLink(`${window.location.origin}/app/pro/${r.token}`);
              setF({ ...f, name: "", perms: [], consent: [] });
            }, "Invitation created.")
          }
        >
          Create invitation link
        </Button>
        {link && (
          <div className="mt-3 space-y-1">
            <p className="text-xs">
              Send this link to them. It works once, for 7 days, and is shown only now. They sign in
              to Plexecute to accept.
            </p>
            <div className="flex gap-2">
              <Input aria-label="Invitation link" readOnly value={link} />
              <Button
                variant="outline"
                className="rounded-[10px]"
                onClick={() => {
                  navigator.clipboard.writeText(link);
                  toast.success("Copied.");
                }}
              >
                Copy
              </Button>
            </div>
          </div>
        )}
      </section>

      {(data?.shares ?? []).map((s) => {
        const props = data!.proposals.filter((p) => p.share_id === s.id),
          msgs = data!.messages.filter((m) => m.share_id === s.id);
        const live = s.status === "active" || s.status === "invited";
        return (
          <section key={s.id} className={card}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{s.professional_name}</h2>
                <p className="text-sm text-muted-foreground">
                  {ROLE_LABEL[s.role as ProRole]} ·{" "}
                  {CREDENTIAL_LABEL[s.credential_status as CredentialStatus]}
                </p>
              </div>
              <span className={s.status === "active" ? "text-success" : "text-muted-foreground"}>
                {STATUS[s.status]}
              </span>
            </div>
            {live && (
              <>
                <div className="mt-3">
                  <Label>What they can do</Label>
                  <div className="mt-2">
                    <PermPicker
                      perms={s.permissions as ProPermission[]}
                      consent={s.health_consent as ProPermission[]}
                      onChange={(p, c) =>
                        run(
                          () => upd({ data: { id: s.id, permissions: p, healthConsent: c } }),
                          "Sharing updated.",
                        )
                      }
                    />
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="mt-3 rounded-[10px]"
                  disabled={busy}
                  onClick={() =>
                    run(() => rev({ data: { id: s.id } }), "Access removed straight away.")
                  }
                >
                  Remove access now
                </Button>
              </>
            )}

            {props.length > 0 && (
              <div className="mt-4">
                <Label>Their suggestions</Label>
                <ul className="mt-2 space-y-2">
                  {props.map((p) => (
                    <li key={p.id} className="rounded-[14px] border border-border p-3 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">{p.title}</span>
                        <span className="text-xs text-muted-foreground">{PSTATUS[p.status]}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {p.kind === "constraint" ? "A rule to follow" : "A plan change"}
                        {p.schedule ? " · adds a fixed time to your week" : ""} · from{" "}
                        {s.professional_name}
                      </p>
                      {p.detail && <p className="mt-1 text-xs">{p.detail}</p>}
                      {p.safety_reason && (
                        <p className="mt-1 text-xs text-warning">{p.safety_reason}</p>
                      )}
                      {p.status === "pending" && (
                        <div className="mt-2 flex gap-2">
                          <Button
                            size="sm"
                            className="rounded-[10px]"
                            disabled={busy}
                            onClick={() =>
                              run(
                                () => decide({ data: { id: p.id, decision: "accept" } }),
                                "Accepted.",
                              )
                            }
                          >
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-[10px]"
                            disabled={busy}
                            onClick={() =>
                              run(
                                () => decide({ data: { id: p.id, decision: "decline" } }),
                                "Declined.",
                              )
                            }
                          >
                            Decline
                          </Button>
                        </div>
                      )}
                      {p.status === "accepted" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 rounded-[10px]"
                          disabled={busy}
                          onClick={() =>
                            run(() => decide({ data: { id: p.id, decision: "end" } }), "Ended.")
                          }
                        >
                          Stop following this
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(msgs.length > 0 || s.status === "active") && (
              <div className="mt-4">
                <Label>Comments</Label>
                <ul className="mt-2 space-y-1 text-sm">
                  {msgs.map((m) => (
                    <li key={m.id}>
                      <span className="font-medium">
                        {m.author === "user" ? "You" : s.professional_name}:
                      </span>{" "}
                      {m.body}{" "}
                      <span className="text-xs text-muted-foreground">{when(m.created_at)}</span>
                    </li>
                  ))}
                </ul>
                {s.status === "active" && (
                  <div className="mt-2 flex gap-2">
                    <Input
                      value={draft[s.id] ?? ""}
                      maxLength={2000}
                      onChange={(e) => setDraft({ ...draft, [s.id]: e.target.value })}
                      placeholder="Write a comment"
                    />
                    <Button
                      variant="outline"
                      className="rounded-[10px]"
                      disabled={busy || !(draft[s.id] ?? "").trim()}
                      onClick={() =>
                        run(async () => {
                          await msg({ data: { id: s.id, body: draft[s.id]! } });
                          setDraft({ ...draft, [s.id]: "" });
                        })
                      }
                    >
                      Send
                    </Button>
                  </div>
                )}
              </div>
            )}

            <details className="mt-4 text-xs">
              <summary className="cursor-pointer text-muted-foreground">Access history</summary>
              <ul className="mt-2 space-y-1">
                {data!.history
                  .filter((h) => h.resource_id === s.id)
                  .map((h, i) => (
                    <li key={i}>
                      {when(h.created_at)} ·{" "}
                      {h.actor_type === "professional" ? s.professional_name : "You"} ·{" "}
                      {h.action.replace("professional.", "").replace(/[._]/g, " ")}
                    </li>
                  ))}
              </ul>
            </details>
          </section>
        );
      })}
    </div>
  );
}
