import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { passwordProblem } from "@/components/SecuritySettings";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — Plexecute" },
      { name: "description", content: "Choose a new password for your Plexecute account." },
      { property: "og:title", content: "Set a new password — Plexecute" },
      { property: "og:description", content: "Choose a new password for your Plexecute account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, follow" },
    ],
  }),
  component: Reset,
});

function Reset() {
  const [pw, setPw] = useState("");
  const navigate = useNavigate();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    {
      const pr = passwordProblem(pw);
      if (pr) {
        toast.error(pr);
        return;
      }
    }
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated");
    navigate({ to: "/app/today" });
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={save} className="w-full max-w-sm space-y-4">
        <h1 className="text-3xl font-semibold">Set a new password</h1>
        <Input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="New password"
        />
        <Button className="w-full rounded-[10px]" type="submit">
          Save password
        </Button>
      </form>
    </div>
  );
}
