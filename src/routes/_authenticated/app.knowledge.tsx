import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/app/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge access | Plexecute" },
      { name: "description", content: "Internal evidence is managed in Plexecute administration." },
      { property: "og:title", content: "Knowledge access | Plexecute" },
      {
        property: "og:description",
        content: "Internal evidence is managed in Plexecute administration.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/app/today", replace: true });
  },
});
