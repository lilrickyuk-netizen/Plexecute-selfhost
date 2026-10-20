import { createFileRoute, redirect } from "@tanstack/react-router";

// V3 §10 route inventory alias; the screen lives at /app/accountability.
export const Route = createFileRoute("/_authenticated/app/execute")({
  beforeLoad: () => {
    throw redirect({ to: "/app/accountability" });
  },
});
