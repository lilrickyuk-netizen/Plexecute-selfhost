import { BatteryCharging } from "lucide-react";
import { FeatureHeader } from "@/components/FeatureHeader";
import { RecoveryPanel } from "@/components/RecoveryPanel";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/app/recovery")({
  head: () => ({
    meta: [
      { title: "Recovery — Plexecute" },
      { name: "description", content: "Manage Recovery in Plexecute." },
      { property: "og:title", content: "Recovery — Plexecute" },
      { property: "og:description", content: "Manage Recovery in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RecoveryRoute,
});

function RecoveryRoute() {
  return (
    <div>
      <FeatureHeader
        title="Recovery"
        icon={BatteryCharging}
        description="A 20-second daily check-in. Your recovery state shapes how hard today should be."
      />
      <RecoveryPanel />
    </div>
  );
}
