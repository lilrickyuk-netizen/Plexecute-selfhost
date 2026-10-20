import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { passwordProblem } from "@/components/SecuritySettings";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const search = z.object({
  mode: z.enum(["login", "signup", "forgot"]).optional(),
  plan: z.enum(["pro", "execute"]).optional(),
});
const PLAN_KEY = "plexecute.wantedPlan";

export const Route = createFileRoute("/login")({
  validateSearch: search,
  head: () => ({
    meta: [
      { title: "Log in or sign up — Plexecute" },
      { name: "description", content: "Sign in to Plexecute or create your free account." },
      { property: "og:title", content: "Log in — Plexecute" },
      { property: "og:description", content: "Sign in to Plexecute or create your free account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, follow" },
    ],
  }),
  component: LoginPage,
});

function isAdult(dob: string) {
  const d = new Date(dob);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  const eighteen = new Date(d.getFullYear() + 18, d.getMonth(), d.getDate());
  return eighteen <= now;
}

function LoginPage() {
  const { mode = "login", plan } = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dob, setDob] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    // A plan picked on the home page survives sign-up (including Google redirects) and opens on Billing.
    if (plan) sessionStorage.setItem(PLAN_KEY, plan);
    let gone = false;
    const go = async (uid: string) => {
      if (gone) return;
      gone = true;
      // New members go straight to onboarding instead of flashing the app first.
      const { data: p } = await supabase
        .from("profiles")
        .select("onboarded")
        .eq("id", uid)
        .maybeSingle();
      if (p && !p.onboarded) return navigate({ to: "/onboarding" });
      const want = sessionStorage.getItem(PLAN_KEY);
      if (want === "pro" || want === "execute") {
        sessionStorage.removeItem(PLAN_KEY);
        navigate({ to: "/app/billing", search: { plan: want, status: undefined } });
      } else navigate({ to: "/app/coach" });
    };
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) void go(data.session.user.id);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) void go(session.user.id);
    });
    return () => data.subscription.unsubscribe();
  }, [navigate, plan]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        if (!isAdult(dob)) {
          toast.error("Plexecute is for adults 18 and over.");
          return;
        }
        const pwProblem = passwordProblem(password);
        if (pwProblem) {
          toast.error(pwProblem);
          return;
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + "/login",
            data: { date_of_birth: dob },
          },
        });
        if (error) throw error;
        setSent(true);
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/reset-password",
        });
        if (error) throw error;
        setSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/login" },
    });
    if (error) toast.error("Google sign-in failed. Please try again.");
  }

  const title =
    mode === "signup"
      ? "Create your account"
      : mode === "forgot"
        ? "Reset your password"
        : "Welcome back";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="member-brand font-display text-lg font-semibold">
          <img src="/icon-192.png" width={30} height={30} alt="" />
          <span>
            Plex<span className="text-execute">ecute</span>
          </span>
        </Link>
        <h1 className="mt-8 text-3xl font-semibold">{title}</h1>

        {sent ? (
          <p className="mt-6 rounded-[14px] border border-border bg-card p-4 text-sm text-muted-foreground">
            Check your inbox at <span className="text-foreground">{email}</span> for a link to
            continue.
          </p>
        ) : (
          <>
            {mode !== "forgot" && (
              <>
                <Button
                  variant="outline"
                  className="mt-8 w-full rounded-[10px]"
                  onClick={google}
                  type="button"
                >
                  Continue with Google
                </Button>
                <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
                  <div className="h-px flex-1 bg-border" /> or{" "}
                  <div className="h-px flex-1 bg-border" />
                </div>
              </>
            )}
            <form onSubmit={submit} className={mode === "forgot" ? "mt-8 space-y-4" : "space-y-4"}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {mode !== "forgot" && (
                <div className="space-y-2">
                  <Label htmlFor="pw">Password</Label>
                  <Input
                    id="pw"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              )}
              {mode === "signup" && (
                <div className="space-y-2">
                  <Label htmlFor="dob">Date of birth</Label>
                  <Input
                    id="dob"
                    type="date"
                    required
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    You must be 18 or over to use Plexecute.
                  </p>
                </div>
              )}
              <Button type="submit" className="w-full rounded-[10px]" disabled={busy}>
                {mode === "signup"
                  ? "Create account"
                  : mode === "forgot"
                    ? "Send reset link"
                    : "Log in"}
              </Button>
            </form>
          </>
        )}

        <div className="mt-6 flex justify-between text-sm text-muted-foreground">
          {mode === "login" ? (
            <>
              <Link to="/login" search={{ mode: "signup" }} className="hover:text-foreground">
                Create account
              </Link>
              <Link to="/login" search={{ mode: "forgot" }} className="hover:text-foreground">
                Forgot password?
              </Link>
            </>
          ) : (
            <Link
              to="/login"
              search={{ mode: "login" }}
              className="hover:text-foreground"
              onClick={() => setSent(false)}
            >
              Back to log in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
