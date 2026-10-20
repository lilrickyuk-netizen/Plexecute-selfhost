import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return "Use at least 12 characters.";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "Use a mix of letters and numbers.";
  return null;
}

export function SecuritySettings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  async function change() {
    const problem = passwordProblem(next);
    if (!current) {
      toast.error("Enter your current password.");
      return;
    }
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({
      password: next,
      current_password: current,
    } as { password: string });
    setBusy(false);
    if (error) {
      toast.error(
        /pwned|leak|breach|weak/i.test(error.message)
          ? "That password has appeared in a known data breach. Please choose another."
          : error.message,
      );
      return;
    }
    setCurrent("");
    setNext("");
    toast.success("Password changed.");
  }

  async function signOutEverywhere() {
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) {
      toast.error(error.message);
      return;
    }
    window.location.href = "/login";
  }

  return (
    <section
      id="security"
      className="scroll-mt-20 space-y-4 rounded-[20px] border border-border bg-card p-6"
    >
      <h2 className="text-lg font-semibold">Security</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Current password</Label>
          <Input
            aria-label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>New password</Label>
          <Input
            aria-label="New password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        At least 8 characters with letters and numbers. Passwords found in known data breaches are
        refused. Signed in with Google? Use "Forgot password" on the sign-in page to set one.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button className="rounded-[10px]" disabled={busy} onClick={change}>
          {busy ? "Saving…" : "Change password"}
        </Button>
        <Button variant="outline" className="rounded-[10px]" onClick={signOutEverywhere}>
          Sign out on all devices
        </Button>
      </div>
    </section>
  );
}
