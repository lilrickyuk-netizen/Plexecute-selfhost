import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { getSpendSummary, buyAiCredit } from "@/lib/spend.functions";
import { useProfile } from "@/lib/data";
import { marketFor, money } from "@/lib/billing";
import { AI_CREDIT } from "@/lib/spend";
import { Button } from "@/components/ui/button";

/** Usage-ended guidance and AI Credit purchases; no internal balance display. */
export function UsageAllowance() {
  const load = useServerFn(getSpendSummary);
  const buy = useServerFn(buyAiCredit);
  const { data: prof } = useProfile();
  const { data } = useQuery({ queryKey: ["spend-summary"], queryFn: () => load() });
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const market = marketFor(prof);
  const price = money(AI_CREDIT.pricePence, market);
  return (
    <section
      aria-label="AI and call allowance"
      className="rounded-[20px] border border-border bg-card p-6"
    >
      <h2 className="text-lg font-semibold">AI and calls this month</h2>
      {data.includedEnded ? (
        <p className="mt-1 text-sm text-muted-foreground">
          You've used this month's included AI and call usage. Add AI Credit or call time to keep
          going.
        </p>
      ) : data.tier === "free" ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Free includes a small daily AI allowance. AI Credit keeps AI features going after it runs
          out. Calls are part of Pro and Execute.
        </p>
      ) : null}
      <div className="mt-4 rounded-[12px] bg-raised p-3 text-sm">
        <b>Plexecute AI Credit</b>
        <p className="text-muted-foreground">Credit covers AI features only, not calls.</p>
        <Button
          className="mt-3"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await buy({
                data: { confirm: true, countryConfirmed: market, origin: window.location.origin },
              });
              if (r.url) window.location.href = r.url;
              else
                toast.error(
                  r.error === "not_configured"
                    ? "AI Credit purchases aren't switched on yet."
                    : r.error === "country_mismatch"
                      ? "Please check your billing country first."
                      : "Purchases are paused right now.",
                );
            } finally {
              setBusy(false);
            }
          }}
        >
          Buy AI Credit ({price})
        </Button>
      </div>
    </section>
  );
}
