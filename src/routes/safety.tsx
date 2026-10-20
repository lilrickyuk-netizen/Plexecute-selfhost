import { createFileRoute } from "@tanstack/react-router";
import { PublicPage } from "@/components/PublicPage";

const t = "Safety — Plexecute";
const d = "Plexecute safety principles: wellness scope, no pressure tactics, you stay in control.";

export const Route = createFileRoute("/safety")({
  head: () => ({
    meta: [
      { title: t },
      { name: "description", content: d },
      { property: "og:title", content: t },
      { property: "og:description", content: d },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://plexecute.io/safety" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://plexecute.io/safety" }],
  }),
  component: () => (
    <PublicPage title="Safety">
      <h2>Not medical care</h2>
      <p>
        Plexecute does not diagnose or treat conditions. If you have a health condition, injury,
        eating disorder history or are pregnant, speak to a qualified professional before changing
        training or nutrition.
      </p>
      <h2>No pressure tactics</h2>
      <p>Plexecute never uses guilt, shame or emotional pressure to keep you engaged.</p>
      <h2>You stay in control</h2>
      <p>You can inspect, edit, pause or reject any part of your plan.</p>
      <h2>In an emergency</h2>
      <p>If you are in crisis, call 999 in the UK or contact Samaritans on 116 123.</p>
    </PublicPage>
  ),
});
