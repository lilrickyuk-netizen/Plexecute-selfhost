import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { acceptInvite } from "@/lib/professional.functions";

export const Route = createFileRoute("/_authenticated/app/pro/$token")({
  head: () => ({
    meta: [
      { title: "Accept invitation · Plexecute" },
      { name: "description", content: "Accept a client's invitation to Professional Connect." },
      { property: "og:title", content: "Accept invitation · Plexecute" },
      {
        property: "og:description",
        content: "Accept a client's invitation to Professional Connect.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Accept,
});

function Accept() {
  const { token } = Route.useParams();
  const accept = useServerFn(acceptInvite),
    nav = useNavigate();
  const [err, setErr] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-3xl font-semibold">Client invitation</h1>
      <p className="text-muted-foreground">
        Someone has invited you to see chosen parts of their Plexecute plan. You'll see only what
        they allowed, they can remove access at any time, and every view is recorded for them.
      </p>
      {err && <p className="text-sm text-warning">{err}</p>}
      <div className="flex gap-2">
        <Button
          className="rounded-[10px]"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await accept({ data: { token } });
              if (r.ok) nav({ to: "/app/clients/$id", params: { id: r.id } });
              else setErr(r.reason);
            } catch {
              setErr("This invitation isn't valid.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Accept
        </Button>
        <Link to="/app" className="inline-flex items-center px-3 text-sm text-muted-foreground">
          Not now
        </Link>
      </div>
    </div>
  );
}
