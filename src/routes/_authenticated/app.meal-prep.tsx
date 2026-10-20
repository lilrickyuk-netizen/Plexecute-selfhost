import { createFileRoute } from "@tanstack/react-router";
import { MealPrep } from "@/components/MealPrep";
import { MemberPage } from "@/components/MemberPage";
import { useEffect, useState } from "react";
import { useProfile } from "@/lib/data";
import { localDayRange } from "@/lib/tz";

export const Route = createFileRoute("/_authenticated/app/meal-prep")({
  head: () => ({
    meta: [
      { title: "Meal prep — Plexecute" },
      {
        name: "description",
        content: "Your Plexecute meal prep, using your existing nutrition targets and meals.",
      },
      { property: "og:title", content: "Meal prep — Plexecute" },
      {
        property: "og:description",
        content: "Your Plexecute meal prep, using your existing nutrition targets and meals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});
function Page() {
  const { data: profile } = useProfile();
  const [day, setDay] = useState("");
  useEffect(() => {
    setDay(
      localDayRange(new Date(), profile?.timezone)[0].toLocaleDateString("en-CA", {
        timeZone: profile?.timezone ?? "UTC",
      }),
    );
  }, [profile?.timezone]);
  if (!day)
    return (
      <MemberPage title="Meal prep">
        <p aria-busy="true">Loading…</p>
      </MemberPage>
    );
  return (
    <MemberPage title="Meal prep">
      <MealPrep day={day} />
    </MemberPage>
  );
}
