import { createFileRoute, redirect } from "@tanstack/react-router";

// V3 §10 route inventory alias; the screen lives at /login.
export const Route = createFileRoute("/verify-email")({
  beforeLoad: () => {
    throw redirect({ to: "/login" });
  },
});
