import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { IncidentBanner } from "@/components/IncidentBanner";
import { useEffect, useState } from "react";
import { MEMBER_GROUPS, MemberNavLink } from "@/components/MemberNavigation";
import { Button } from "@/components/ui/button";
import {
  Apple,
  BatteryCharging,
  BookOpen,
  ListTodo,
  CircleCheck,
  CreditCard,
  Dumbbell,
  FlaskConical,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  Target,
  TrendingUp,
} from "lucide-react";
import { Reminders } from "@/components/Reminders";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/lib/data";
import { useSafety } from "@/components/SafetyPanel";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useOutboxSync } from "@/lib/offline";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({
    meta: [
      { title: "Your Plexecute workspace" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Your Coach, plans and life areas in Plexecute." },
      { property: "og:title", content: "Your Plexecute workspace" },
      { property: "og:description", content: "Your Coach, plans and life areas in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AppLayout,
});

const MOBILE = [
  { to: "/app/today", label: "Today", icon: CircleCheck },
  { to: "/app/plan", label: "Plan", icon: ListTodo },
  { to: "/app/coach", label: "Coach", icon: MessageSquare },
  { to: "/app/progress", label: "Progress", icon: TrendingUp },
  { to: "/app/more", label: "Explore", icon: Menu },
] as const;

function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { data: profile, isLoading, isFetched } = useProfile();
  const { data: safety } = useSafety();
  const navigate = useNavigate();
  useOutboxSync();
  // V3 §91: the admin console is a separate surface, reachable before the admin's own setup is finished.
  const onAdmin = useRouterState({ select: (r) => r.location.pathname.startsWith("/app/admin") });
  useEffect(() => {
    if (!isLoading && isFetched && profile && !profile.onboarded && !onAdmin)
      navigate({ to: "/onboarding" });
  }, [isLoading, isFetched, profile, navigate, onAdmin]);
  // One dark identity, regardless of saved preferences or device appearance.
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);
  // V3 §58 accessibility: text size, reduced motion and high contrast apply to every page.
  const a11y = profile as unknown as
    { text_size?: string; reduce_motion?: boolean; high_contrast?: boolean } | undefined;
  useEffect(() => {
    const el = document.documentElement;
    el.style.fontSize =
      a11y?.text_size === "larger" ? "125%" : a11y?.text_size === "large" ? "112.5%" : "";
    el.classList.toggle("reduce-motion", !!a11y?.reduce_motion);
    el.classList.toggle("high-contrast", !!a11y?.high_contrast);
    return () => {
      el.style.fontSize = "";
      el.classList.remove("reduce-motion", "high-contrast");
    };
  }, [a11y?.text_size, a11y?.reduce_motion, a11y?.high_contrast]);

  // Don't flash the app before we know whether this member still needs onboarding.
  if (!onAdmin && (!profile || !profile.onboarded))
    return <div className="min-h-screen bg-background" aria-busy="true" />;

  return (
    <div
      className={`member-app min-h-screen bg-background md:flex ${collapsed ? "member-app-collapsed" : ""}`}
    >
      <aside className="member-sidebar">
        <Link
          to="/app/coach"
          className="member-brand font-display text-xl font-semibold"
          aria-label="Plexecute Coach"
        >
          <img src="/icon-192.png" width={30} height={30} alt="" />
          <span className="member-brand-name">
            Plex<span className="text-logo-brand">ecute</span>
          </span>
        </Link>
        <nav className="member-sidebar-nav" aria-label="Feature navigation">
          {MEMBER_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="member-nav-heading">{group.label}</p>
              {group.items.map((item) => (
                <MemberNavLink key={item.to} item={item} />
              ))}
            </div>
          ))}
        </nav>
        {profile?.tier === "free" && !safety?.policy.blockUpsell && (
          <Link
            to="/app/billing"
            search={{ status: undefined }}
            className="mb-4 rounded-[14px] border border-execute/40 bg-gradient-to-br from-execute/20 to-transparent p-4 text-sm hover:border-execute"
          >
            <p className="font-semibold text-foreground">Upgrade to Pro</p>
            <p className="mt-1 text-xs text-muted-foreground">7-day free trial</p>
          </Link>
        )}
        <div className="border-t border-border pt-4 text-xs text-muted-foreground">
          <div className="mb-3 capitalize">
            {profile?.display_name} · {profile?.tier} plan
          </div>
          <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 pb-24 md:pb-0">
        <div className="member-content">
          <div className="member-topbar">
            <Button
              variant="ghost"
              size="icon"
              className="hidden md:inline-flex"
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
              onClick={() => setCollapsed(!collapsed)}
            >
              <Menu size={19} />
            </Button>
            <Link
              to="/app/coach"
              className="member-brand font-display text-lg font-semibold md:hidden"
              aria-label="Plexecute Coach"
            >
              <img src="/icon-192.png" width={28} height={28} alt="" />
              <span>
                Plex<span className="text-logo-brand">ecute</span>
              </span>
            </Link>
            <div className="flex flex-1 items-center justify-end gap-3">
              {profile?.tier === "free" && (
                <Link
                  to="/app/billing"
                  search={{ status: undefined }}
                  className="rounded-full bg-execute px-3 py-1.5 text-xs font-medium text-execute-foreground md:hidden"
                >
                  Upgrade
                </Link>
              )}
              <Reminders />
            </div>
          </div>
          <OfflineBanner />
          <IncidentBanner />
          <div className="member-page-body">
            <Outlet />
          </div>
        </div>
      </main>
      <nav className="member-mobile-nav" aria-label="Main navigation">
        {MOBILE.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            className="member-mobile-link"
            activeProps={{ className: "member-mobile-active" }}
          >
            <n.icon className="h-5 w-5" /> {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
