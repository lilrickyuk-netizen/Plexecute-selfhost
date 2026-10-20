import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "@/components/MemberSettings";

export const Route = createFileRoute("/_authenticated/app/reminders")({
  head: () => ({
    meta: [
      { title: "Reminders — Plexecute" },
      { name: "description", content: "Manage your Plexecute reminders." },
      { property: "og:title", content: "Reminders — Plexecute" },
      { property: "og:description", content: "Manage your Plexecute reminders." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <Settings surface="reminders" />,
});
