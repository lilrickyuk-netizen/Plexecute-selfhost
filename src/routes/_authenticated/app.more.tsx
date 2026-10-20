import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, LogOut, ShieldUser } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMyAdminStatus } from "@/lib/admin.functions";
import { MEMBER_GROUPS } from "@/components/MemberNavigation";
import { Button } from "@/components/ui/button";
import exploreImage from "@/assets/member-explore.jpg";
import wellnessImage from "@/assets/member-wellness.jpg";
import trainingImage from "@/assets/member-training.jpg";
import nutritionImage from "@/assets/member-nutrition.jpg";
import learningImage from "@/assets/member-learning.jpg";

export const Route = createFileRoute("/_authenticated/app/more")({
  head: () => ({
    meta: [
      { title: "Explore — Plexecute" },
      {
        name: "description",
        content: "Your execution, life areas, insights and account in Plexecute.",
      },
      { property: "og:title", content: "Explore — Plexecute" },
      {
        property: "og:description",
        content: "Your execution, life areas, insights and account in Plexecute.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: More,
});
function More() {
  const adminStatus = useServerFn(getMyAdminStatus);
  const { data: admin } = useQuery({ queryKey: ["admin-status"], queryFn: () => adminStatus() });
  return (
    <div>
      <h1 className="text-3xl font-semibold">Explore</h1>
      <Link to="/app/coach" className="member-explore-cover">
        <img src={exploreImage} width={1536} height={1024} alt="" />
        <div>
          <MessageSquareIcon />
          <h2>Your command centre</h2>
          <span>Coach</span>
        </div>
        <ArrowUpRight size={20} aria-hidden="true" />
      </Link>
      {MEMBER_GROUPS.map((group) => (
        <section className="member-directory-section" key={group.label}>
          <h2>{group.label}</h2>
          <div
            className={
              group.label === "Execution"
                ? "member-execution-links"
                : group.label === "Life areas"
                  ? "member-area-links"
                  : "member-directory-links"
            }
          >
            {group.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`member-feature-link ${item.to === "/app/training" || item.to === "/app/nutrition" || item.to === "/app/wellness" || item.to === "/app/learning" ? "member-feature-visual" : ""}`}
              >
                {item.to === "/app/training" && (
                  <img src={trainingImage} width={1536} height={1024} loading="lazy" alt="" />
                )}
                {item.to === "/app/nutrition" && (
                  <img src={nutritionImage} width={1024} height={1024} loading="lazy" alt="" />
                )}
                {item.to === "/app/wellness" && (
                  <img src={wellnessImage} width={1536} height={1024} loading="lazy" alt="" />
                )}
                {item.to === "/app/learning" && (
                  <img src={learningImage} width={1264} height={848} loading="lazy" alt="" />
                )}
                <span className="member-feature-icon">
                  <item.icon size={21} aria-hidden="true" />
                </span>
                <span>{item.label}</span>
                <ArrowUpRight size={15} className="member-feature-arrow" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      ))}
      <div className="member-settings-links mt-8">
        {admin?.isAdmin && (
          <Button variant="outline" asChild>
            <Link to="/app/admin">
              <ShieldUser />
              Admin
            </Link>
          </Button>
        )}
        <Button variant="ghost" onClick={() => supabase.auth.signOut()}>
          <LogOut />
          Sign out
        </Button>
      </div>
    </div>
  );
}

function MessageSquareIcon() {
  const Icon = MEMBER_GROUPS[0].items[1].icon;
  return <Icon size={20} aria-hidden="true" className="text-execute" />;
}
