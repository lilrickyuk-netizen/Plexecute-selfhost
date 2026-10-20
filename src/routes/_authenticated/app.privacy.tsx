import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "@/components/MemberSettings";

export const Route = createFileRoute("/_authenticated/app/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy — Plexecute" },
      { name: "description", content: "Manage your Plexecute privacy." },
      { property: "og:title", content: "Privacy — Plexecute" },
      { property: "og:description", content: "Manage your Plexecute privacy." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <Settings surface="privacy" />,
});
