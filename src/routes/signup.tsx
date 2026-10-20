import { createFileRoute, redirect } from "@tanstack/react-router";

// V3 §10 route inventory alias; the screen lives at /login.
export const Route = createFileRoute("/signup")({
  beforeLoad: () => {
    throw redirect({ to: "/login", search: { mode: "signup" } });
  },
});
