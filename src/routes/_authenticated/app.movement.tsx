import { createFileRoute, redirect } from "@tanstack/react-router";

// Cardio now lives in Training and mobility in Wellness & Movement; old links keep working.
export const Route = createFileRoute("/_authenticated/app/movement")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: s["tab"] === "mobility" ? ("mobility" as const) : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.tab === "mobility")
      throw redirect({ to: "/app/wellness", search: { section: "mobility" } as never });
    throw redirect({ to: "/app/training", search: { section: "cardio" } as never });
  },
});
