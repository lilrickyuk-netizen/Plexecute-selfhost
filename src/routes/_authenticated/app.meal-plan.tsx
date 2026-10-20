import { createFileRoute } from "@tanstack/react-router";
import { MealPlanner } from "@/components/MealPlanner";
import { MemberPage } from "@/components/MemberPage";

export const Route = createFileRoute("/_authenticated/app/meal-plan")({
  head: () => ({
    meta: [
      { title: "Meal planning — Plexecute" },
      {
        name: "description",
        content: "Your Plexecute meal planning, using your existing nutrition targets and meals.",
      },
      { property: "og:title", content: "Meal planning — Plexecute" },
      {
        property: "og:description",
        content: "Your Plexecute meal planning, using your existing nutrition targets and meals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});
function Page() {
  return (
    <MemberPage title="Meal planning">
      <MealPlanner />
    </MemberPage>
  );
}
