import { createFileRoute } from "@tanstack/react-router";
import { PublicPage } from "@/components/PublicPage";

const t = "How it works — Plexecute";
const d = "Plan, execute, adapt: how Plexecute turns goals into a week that fits your life.";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: t },
      { name: "description", content: d },
      { property: "og:title", content: t },
      { property: "og:description", content: d },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://plexecute.io/how-it-works" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://plexecute.io/how-it-works" }],
  }),
  component: () => (
    <PublicPage title="How it works">
      <h2>1. Plan</h2>
      <p>
        A short life audit captures your goals, work hours, sleep and preferences. A fixed planning
        engine places every session into real free time, with buffers — and tells you honestly when
        it does not fit.
      </p>
      <h2>2. Execute</h2>
      <p>
        Today shows exactly what is next. Mark sessions done or skipped in one tap. Your coach knows
        your plan and always ends with a concrete next action.
      </p>
      <h2>3. Adapt</h2>
      <p>
        Missed a session? Recovery Mode repairs the day instead of turning it into failure. Replan
        the rest of the week any time; nothing important changes without your approval.
      </p>
      <h2>Honest progress</h2>
      <p>
        Done, skipped and unknown are kept separate. Plexecute never invents certainty it does not
        have.
      </p>
    </PublicPage>
  ),
});
