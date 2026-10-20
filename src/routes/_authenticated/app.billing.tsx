import { CreditCard } from "lucide-react";
import { FeatureHeader } from "@/components/FeatureHeader";
import { ExecutionReward } from "@/components/ExecutionReward";
import { UsageAllowance } from "@/components/UsageAllowance";
import { CancelReason } from "@/components/CancelReason";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { PAUSED_PURCHASES } from "@/lib/flags";
import {
  buyVoiceTopUp,
  getBillingOverview,
  getMemberServiceStatus,
  getTrialDisclosure,
  openBillingPortal,
  restoreSubscription,
  startCheckout,
} from "@/lib/billing.functions";
import {
  PRODUCTS,
  TOPUP_RULE,
  VOICE_TOPUP,
  money,
  priceAmount,
  type Interval,
  type Market,
  type PaidTier,
} from "@/lib/billing";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/app/billing")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { status?: string | undefined; plan?: "pro" | "execute" | undefined } => ({
    status: typeof s["status"] === "string" ? s["status"] : undefined,
    plan:
      s["plan"] === "pro" || s["plan"] === "execute" ? (s["plan"] as "pro" | "execute") : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Plan & billing | Plexecute" },
      {
        name: "description",
        content: "Your Plexecute plan, trials, call allowance and extra minutes.",
      },
      { property: "og:title", content: "Plan & billing | Plexecute" },
      {
        property: "og:description",
        content: "Your Plexecute plan, trials, call allowance and extra minutes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Billing,
});

const PLANS = [
  {
    tier: "pro" as const,
    name: "Pro",
    f: "Full AI coach, whole-life planning and adaptation, integrations, and phone accountability within your included usage.",
  },
  {
    tier: "execute" as const,
    name: "Execute",
    f: "Everything in Pro plus persistent call accountability with 120 talk minutes a month.",
  },
];
const STATE_COPY: Record<string, string> = {
  trialing: "Free trial",
  active: "Active",
  cancelling: "Cancelled, access continues until the end date",
  grace: "Payment failed. Your card is being retried, so your plan stays on for now.",
  expired: "Ended",
  refunded: "Refunded",
  none: "",
};
const fmt = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

function Billing() {
  const { status, plan: wanted } = Route.useSearch();
  useEffect(() => {
    if (!wanted) return;
    const t = window.setTimeout(
      () =>
        document
          .getElementById(`plan-${wanted}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      400,
    );
    return () => window.clearTimeout(t);
  }, [wanted]);
  const qc = useQueryClient();
  const checkout = useServerFn(startCheckout);
  const portal = useServerFn(openBillingPortal);
  const topup = useServerFn(buyVoiceTopUp);
  const restore = useServerFn(restoreSubscription);
  const disclose = useServerFn(getTrialDisclosure);
  const statusFn = useServerFn(getMemberServiceStatus);
  const overviewFn = useServerFn(getBillingOverview);
  const { data: integ } = useQuery({
    queryKey: ["member-service-status"],
    queryFn: () => statusFn(),
  });
  const { data: ov } = useQuery({
    queryKey: ["billing-overview"],
    queryFn: () => overviewFn(),
    refetchInterval: status === "success" || status === "topup" ? 3000 : false,
  });
  const market: Market = ov?.market ?? "GB";
  const topUpPrice = money(market === "US" ? VOICE_TOPUP.cents : VOICE_TOPUP.pence, market);
  const [interval, setInterval] = useState<Interval>("month");
  const [busy, setBusy] = useState(false);
  const [trialFor, setTrialFor] = useState<null | Awaited<ReturnType<typeof disclose>>>(null);
  const [confirmTopUp, setConfirmTopUp] = useState(false);
  const [addrOk, setAddrOk] = useState(false);
  const countryName = market === "US" ? "the United States" : "the United Kingdom";
  const needAddr = () => {
    if (addrOk) return false;
    toast.error(`Confirm your billing address is in ${countryName} first.`);
    return true;
  };
  const mismatchMsg = `Your billing country is set to ${countryName}. If your card's billing address is elsewhere, change your billing country in Settings before paying.`;

  async function go(tier: PaidTier, trial: boolean, disclosureAccepted = false) {
    if (needAddr()) return;
    setBusy(true);
    try {
      const r = await checkout({
        data: {
          tier,
          interval,
          trial,
          disclosureAccepted,
          countryConfirmed: market,
          origin: window.location.origin,
        },
      });
      if (r.url) window.location.href = r.url;
      else
        toast.error(
          r.error === "country_mismatch"
            ? mismatchMsg
            : r.error === "paused"
              ? PAUSED_PURCHASES
              : r.error === "already_subscribed"
                ? "You already have a plan. Manage it below."
                : "Paid plans aren't switched on yet.",
        );
    } catch {
      toast.error("Couldn't start checkout");
    } finally {
      setBusy(false);
    }
  }
  async function manage() {
    const r = await portal({ data: { origin: window.location.origin } });
    if (r.url) window.location.href = r.url;
    else toast.error("No billing account yet.");
  }
  async function doRestore() {
    setBusy(true);
    try {
      const r = await restore();
      if (r.restored) {
        toast.success(`Plan refreshed: ${r.tier}`);
        qc.invalidateQueries();
      } else
        toast.error(
          r.reason === "not_configured"
            ? "Payments aren't switched on yet."
            : "No purchase found for this account.",
        );
    } finally {
      setBusy(false);
    }
  }
  async function doTopUp() {
    if (needAddr()) {
      setConfirmTopUp(false);
      return;
    }
    setBusy(true);
    try {
      const r = await topup({
        data: { confirm: true, countryConfirmed: market, origin: window.location.origin },
      });
      if (r.url) window.location.href = r.url;
      else
        toast.error(
          r.error === "country_mismatch"
            ? mismatchMsg
            : r.error === "paused"
              ? PAUSED_PURCHASES
              : r.error === "execute_only"
                ? "Extra minutes need an active Pro or Execute plan."
                : "Payments aren't switched on yet.",
        );
    } finally {
      setBusy(false);
      setConfirmTopUp(false);
    }
  }

  const sub = ov?.sub;
  const active = ov && ["trialing", "active", "cancelling", "grace"].includes(ov.state);
  return (
    <div>
      <FeatureHeader title="Plan & billing" icon={CreditCard} />
      {status === "success" && (
        <p className="mt-3 rounded-[10px] bg-raised p-3 text-sm">
          Payment received. Your plan updates in a few seconds.
        </p>
      )}
      {status === "topup" && (
        <p className="mt-3 rounded-[10px] bg-raised p-3 text-sm">
          Thanks. Your extra minutes appear once the payment is confirmed.
        </p>
      )}
      {integ && !integ.payments && (
        <p className="mt-3 rounded-[10px] border border-border p-3 text-sm text-muted-foreground">
          Paid plans aren't switched on yet. You can keep using Free.
        </p>
      )}

      <div className="mt-6 rounded-[20px] border border-border bg-card p-6">
        <div className="text-sm text-muted-foreground">Current plan</div>
        <div className="mt-1 text-2xl font-semibold capitalize">
          {ov?.tier ?? "free"}
          {sub?.billing_interval ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {sub.billing_interval === "year" ? "yearly" : "monthly"}
            </span>
          ) : null}
        </div>
        {ov && STATE_COPY[ov.state] && (
          <p className={`mt-1 text-sm ${ov.state === "grace" ? "text-destructive" : ""}`}>
            {STATE_COPY[ov.state]}
          </p>
        )}
        {ov?.state === "trialing" && sub?.trial_ends_at && (
          <p className="mt-1 text-sm">
            Trial ends {fmt(sub.trial_ends_at)}, then renews automatically unless you cancel.
          </p>
        )}
        {active && sub?.current_period_end && ov?.state !== "trialing" && (
          <p className="mt-1 text-sm text-muted-foreground">
            {ov?.state === "cancelling" ? "Ends" : "Renews"} {fmt(sub.current_period_end)}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {sub?.customer_id && (
            <Button variant="outline" className="rounded-[10px]" onClick={manage}>
              Manage or cancel subscription
            </Button>
          )}
          <Button variant="ghost" className="rounded-[10px]" disabled={busy} onClick={doRestore}>
            Restore purchases
          </Button>
        </div>
        {(ov?.state === "cancelling" || ov?.state === "expired" || sub?.cancel_at_period_end) && (
          <CancelReason />
        )}
      </div>

      {ov?.callUsage && (
        <div className="mt-6 rounded-[20px] border border-border bg-card p-6">
          <div className="font-semibold">Calling</div>
          {ov.callUsage.ended && (
            <p className="mt-2 text-sm text-muted-foreground">
              Your included call usage has ended. Add call time to keep calling; in-app reminders
              carry on.
            </p>
          )}
          {(ov.tier === "pro" || ov.tier === "execute") && (
            <div className="mt-5 border-t border-border pt-4">
              <div className="text-sm font-medium">Extra talk time</div>
              <p className="text-xs text-muted-foreground">
                {VOICE_TOPUP.minutes} minutes for {topUpPrice}. {TOPUP_RULE} No monthly call-count
                cap while purchased minutes remain. Only bought when you choose to.
              </p>
              <Button
                className="mt-2 rounded-[10px]"
                disabled={busy || !ov.canBuyTopUp}
                onClick={() => setConfirmTopUp(true)}
              >
                Buy {VOICE_TOPUP.minutes} minutes
              </Button>
              {ov.wallet.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {ov.wallet.map((w) => (
                    <li key={w.id} className="flex justify-between">
                      <span>
                        {w.reason === "voice_topup_refund" ? "Refund" : "Bought"}{" "}
                        {fmt(w.created_at)}
                      </span>
                      <span>
                        {Number(w.amount) > 0 ? "+" : ""}
                        {Math.round(Number(w.amount) / 60)} min
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-6">
        <UsageAllowance />
      </div>

      <div className="mt-6">
        <ExecutionReward showHistory />
      </div>

      <section
        aria-label="Billing country"
        className="mt-6 rounded-[14px] border border-border bg-card p-4 text-sm"
      >
        <p>
          Billing country:{" "}
          <b>
            {market === "US"
              ? "United States — you pay in US dollars ($)"
              : "United Kingdom — you pay in pounds (£)"}
          </b>
          .{" "}
          <a href="/app/settings#preferences" className="text-execute underline">
            Change
          </a>
        </p>
        <label className="mt-2 flex items-start gap-2">
          <input
            type="checkbox"
            aria-label="Billing address confirmation"
            checked={addrOk}
            onChange={(e) => setAddrOk(e.target.checked)}
            className="mt-1"
          />
          <span>My card's billing address is in {countryName}. Checkout will ask for it.</span>
        </label>
      </section>

      {!active && (
        <>
          <div className="mt-6 inline-flex rounded-[10px] border border-border p-1">
            {(["month", "year"] as const).map((i) => (
              <button
                key={i}
                onClick={() => setInterval(i)}
                className={`rounded-[8px] px-4 py-1.5 text-sm ${interval === i ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {i === "month" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {PLANS.map((p) => (
              <div
                key={p.tier}
                id={`plan-${p.tier}`}
                className={`rounded-[20px] border bg-card p-6 ${wanted === p.tier ? "border-logo-brand ring-1 ring-logo-brand" : "border-border"}`}
              >
                <div className="text-lg font-semibold">{p.name}</div>
                <div className="mt-1 font-display text-3xl font-semibold">
                  {money(priceAmount(p.tier, interval, market), market)}
                  <span className="text-sm font-normal text-muted-foreground">
                    /{interval === "month" ? "mo" : "yr"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{p.f}</p>
                <div className="mt-4 flex flex-col gap-2">
                  {!sub?.trial_used && (
                    <Button
                      disabled={busy}
                      onClick={async () =>
                        setTrialFor(await disclose({ data: { tier: p.tier, interval } }))
                      }
                      className="rounded-[10px]"
                    >
                      Try free for 7 days
                    </Button>
                  )}
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() => go(p.tier, false)}
                    className="rounded-[10px]"
                  >
                    Subscribe now
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {market === "US"
              ? "US sales tax is added at checkout where your state requires it."
              : "Prices include UK VAT where it applies."}{" "}
            Cancel anytime. One free trial per account; trials never start on their own.
          </p>
        </>
      )}

      <Dialog open={!!trialFor} onOpenChange={(o) => !o && setTrialFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Start your {trialFor?.tier === "pro" ? "Pro" : "Execute"} trial
            </DialogTitle>
          </DialogHeader>
          {trialFor && (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Plan</dt>
                <dd className="capitalize">{trialFor.tier}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Free trial</dt>
                <dd>{trialFor.trialDays} days</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Then</dt>
                <dd>
                  {money(trialFor.renewalPricePence, trialFor.market)} per {trialFor.interval}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">First payment</dt>
                <dd>{fmt(trialFor.renewalDate)}</dd>
              </div>
              <p className="pt-2">{trialFor.autoRenew}</p>
              <p className="text-muted-foreground">
                {trialFor.cancelPath}{" "}
                <a
                  href="/legal/subscriptions"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Subscription and cancellation terms
                </a>
              </p>
              <p className="text-xs text-muted-foreground">
                During the trial, calls are limited to{" "}
                {trialFor.tier === "pro"
                  ? "3 check-ins and 3 talk minutes"
                  : "5 sessions and 15 talk minutes"}
                .
              </p>
            </dl>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTrialFor(null)}>
              Not now
            </Button>
            <Button disabled={busy} onClick={() => trialFor && go(trialFor.tier, true, true)}>
              Start free trial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmTopUp} onOpenChange={setConfirmTopUp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buy {VOICE_TOPUP.minutes} extra minutes?</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            One payment of {topUpPrice}. {TOPUP_RULE}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmTopUp(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={doTopUp}>
              Pay {topUpPrice}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
