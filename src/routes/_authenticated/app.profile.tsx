import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "@/components/MemberSettings";

export const Route = createFileRoute("/_authenticated/app/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Plexecute" },
      { name: "description", content: "Manage your Plexecute profile." },
      { property: "og:title", content: "Profile — Plexecute" },
      { property: "og:description", content: "Manage your Plexecute profile." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <Settings surface="profile" />,
});
