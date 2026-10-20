import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "@/components/MemberSettings";

export const Route = createFileRoute("/_authenticated/app/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Plexecute" },
      { name: "description", content: "Your Plexecute preferences and coaching settings." },
      { property: "og:title", content: "Settings — Plexecute" },
      { property: "og:description", content: "Your Plexecute preferences and coaching settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
});
