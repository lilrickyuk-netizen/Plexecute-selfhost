import { createFileRoute } from "@tanstack/react-router";
import { Stat } from "@/components/AdminUI";
import { useAnalytics, Shell, Grid, gbpOr, NA } from "@/components/OwnerKit";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ownerBookingsSpend } from "@/lib/owner.functions";

export const Route = createFileRoute("/_authenticated/app/admin/owner/economics")({
  head: () => ({
    meta: [
      { title: "Owner unit economics | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner unit economics in Plexecute." },
      { property: "og:title", content: "Owner unit economics | Plexecute" },
      { property: "og:description", content: "Manage Owner unit economics in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Economics,
});
const INSUFFICIENT = "Insufficient data";

function BookingsSpend() {
  const load = useServerFn(ownerBookingsSpend);
  const { data: b } = useQuery({ queryKey: ["owner-bookings-spend"], queryFn: () => load() });
  if (!b) return null;
  const g = (v: number | null) => (v == null ? NA : `£${v.toFixed(2)}`);
  return (
    <>
      <Grid
        title="Measured AI and call cost (last 30 days)"
        note="Real provider usage priced at the AI gateway's list rates. Call rates are estimates until your Twilio invoices are in."
      >
        <Stat label="AI cost" value={g(b.aiCostGbp)} />
        <Stat label="Call cost" value={g(b.callCostGbp)} />
        <Stat label="Retail value consumed" value={g(b.retailGbp)} />
        <Stat label="AI Credit spent" value={g(b.creditSpentGbp)} />
        <Stat label="AI Credit packs sold" value={String(b.creditPurchases)} />
        <Stat label="AI Credit sales" value={g(b.creditSoldGbp)} />
        <Stat label="Cost beyond allowances" value={g(b.overAllowanceGbp)} />
      </Grid>
      <Grid title="Appointment booking (last 30 days)">
        <Stat label="Booking attempts" value={String(b.attempts)} />
        <Stat label="Online" value={String(b.online)} />
        <Stat label="By phone" value={String(b.phone)} />
        <Stat label="Booked" value={String(b.confirmed)} />
        <Stat label="Not booked" value={String(b.failed)} />
        <Stat label="Cancelled" value={String(b.cancelled)} />
        <Stat label="Reschedules" value={String(b.reschedules)} />
        <Stat label="Reservations" value={String(b.reservations)} />
        <Stat label="Restaurant tables" value={String(b.restaurantReservations)} />
        <Stat label="Orders" value={String(b.orders)} />
        <Stat label="Checkout handoffs" value={String(b.checkoutHandoffs)} />
        <Stat label="Paid and confirmed" value={String(b.paidConfirmed)} />
        <Stat label="Checkouts expired" value={String(b.checkoutsExpired)} />
        <Stat label="Checkouts abandoned" value={String(b.checkoutsAbandoned)} />
        <Stat label="Booking call minutes" value={String(b.bookingCallMinutes)} />
        <Stat label="Average cost per booking" value={g(b.avgCostPerConfirmedBookingGbp)} />
        <Stat
          label="Top failure reasons"
          value={
            b.topFailures.length
              ? b.topFailures.map(([r, n]) => `${r.replace(/_/g, " ")} (${n})`).join(", ")
              : "None"
          }
        />
      </Grid>
    </>
  );
}

function Economics() {
  const { data: d, error, isLoading, picker } = useAnalytics();
  return (
    <Shell picker={picker} error={error} loading={isLoading}>
      {d && (
        <>
          <Grid
            title="Business health"
            note="Only real, observed figures. Costs need each provider's invoice rates, and payment fees come from Stripe's statements, so they show “Not yet available” instead of guesses."
          >
            <Stat label="Revenue (MRR)" value={gbpOr(d.money?.mrr)} />
            <Stat label="Reward value issued" value={gbpOr(d.revenue.rewardPenceApplied)} />
            <Stat label="Payment fees" value={NA} />
            <Stat label="AI cost" value={NA} />
            <Stat label="Voice and call cost" value={NA} />
            <Stat label="Other provider cost" value={NA} />
            <Stat label="Hosting cost" value={NA} />
            <Stat label="Contribution margin" value={NA} />
          </Grid>
          <Grid title="Per member">
            <Stat label="Margin per paying member" value={NA} />
            <Stat label="Variable cost per Free member" value={NA} />
            <Stat label="Variable cost per Pro member" value={NA} />
            <Stat label="Variable cost per Execute member" value={NA} />
            <Stat label="Gross margin by plan" value={NA} />
          </Grid>
          <Grid title="Acquisition">
            <Stat label="Customer acquisition cost" value={INSUFFICIENT} />
            <Stat label="Payback period" value={INSUFFICIENT} />
            <Stat label="Lifetime value ÷ acquisition cost" value={INSUFFICIENT} />
          </Grid>
          <BookingsSpend />
          <p className="text-xs text-muted-foreground">
            Usage quantities to price these are in “AI &amp; provider costs”, and can be downloaded
            from Admin → Quotas.
          </p>
        </>
      )}
    </Shell>
  );
}
