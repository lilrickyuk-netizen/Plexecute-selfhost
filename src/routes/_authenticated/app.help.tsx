import { LifeBuoy } from "lucide-react";
import { FeatureHeader } from "@/components/FeatureHeader";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SupportPanel } from "@/components/SupportPanel";

export const Route = createFileRoute("/_authenticated/app/help")({
  head: () => ({
    meta: [
      { title: "Help · Plexecute" },
      { name: "description", content: "How Plexecute works, urgent help and how to get support." },
      { property: "og:title", content: "Help · Plexecute" },
      {
        property: "og:description",
        content: "How Plexecute works, urgent help and how to get support.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Help,
});

const FAQ = [
  [
    "Why did my plan change?",
    "Plexecute never changes your plan without telling you. Every change appears as a suggestion on your Plan with the reasons, and you approve it. The full record is in History.",
  ],
  [
    'What does "unknown" mean on Progress?',
    "If a session wasn't marked done or skipped, Plexecute doesn't guess. It counts as unknown rather than as a success or a miss.",
  ],
  [
    "Why didn't my weights go up?",
    "Loads rise only when you hit the top of the rep range on every set in two sessions in a row, and never when recovery is AMBER or RED. The reason is shown in your training history.",
  ],
  [
    "How do I stop reminders or calls?",
    "Turn them off in Settings under Reminders & accountability. You can stop calls at any time.",
  ],
  [
    "How do I get my data or delete it?",
    "Settings → Privacy lets you download everything, delete your data or delete your account.",
  ],
] as const;

function Help() {
  return (
    <div>
      <FeatureHeader title="Help" icon={LifeBuoy} />
      <div className="mt-6 rounded-[20px] border border-destructive/50 bg-destructive/10 p-5 text-sm">
        <p className="font-medium">Need urgent help?</p>
        <p className="mt-1">
          If you or someone else is in danger, call 999. For urgent health advice, call NHS 111.
          Samaritans are free on 116 123, any time. Plexecute is not a medical or emergency service.
        </p>
      </div>
      <h2 className="mt-8 text-lg font-semibold">Common questions</h2>
      <div className="mt-3 divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
        {FAQ.map(([q, a]) => (
          <details key={q} className="px-5 py-4">
            <summary className="cursor-pointer font-medium">{q}</summary>
            <p className="mt-2 text-sm text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
      <SupportPanel />
      <div className="mt-8 flex flex-wrap gap-3 text-sm">
        <Link to="/how-it-works" className="text-execute underline">
          How Plexecute works
        </Link>
        <Link to="/safety" className="text-execute underline">
          Safety
        </Link>
        <Link to="/privacy" className="text-execute underline">
          Privacy policy
        </Link>
        <Link to="/terms" className="text-execute underline">
          Terms
        </Link>
        <Link to="/legal" className="text-execute underline">
          All legal documents
        </Link>
      </div>
    </div>
  );
}
