import { createFileRoute, redirect } from "@tanstack/react-router";

// V3 §10 route inventory alias; the screen lives at /login.
export const Route = createFileRoute("/forgot-password")({
  beforeLoad: () => {
    throw redirect({ to: "/login", search: { mode: "forgot" } });
  },
});
