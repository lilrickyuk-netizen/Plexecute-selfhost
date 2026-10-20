// Applies a verified Stripe event. Called only by the "stripe.event" job (first delivery, retry or replay).
import type { StripeEvent } from "./jobs.server";

export async function processStripeEvent(db: any, event: StripeEvent) {
  const b = await import("./billing.server");

  const o = event.data.object;
  if (event.type === "checkout.session.completed") {
    const meta = (o["metadata"] as { user_id?: string; kind?: string }) ?? {};
    const userId = (o["client_reference_id"] as string) ?? meta.user_id;
    if (
      userId &&
      o["mode"] === "payment" &&
      meta.kind === "ai_credit" &&
      o["payment_status"] === "paid"
    )
      await (
        await import("./spend.server")
      ).creditAiPurchase(db, userId, o["payment_intent"] as string);
    if (userId && o["mode"] === "payment" && meta.kind === "voice_topup") {
      if (o["payment_status"] === "paid")
        await b.creditTopUp(db, userId, o["payment_intent"] as string);
    }
    // Confirm the billing country from the checkout billing address (authoritative over any time-zone hint).
    const country = (o["customer_details"] as { address?: { country?: string } } | null)?.address
      ?.country;
    if (userId && (country === "GB" || country === "US"))
      await db
        .from("profiles")
        .update({ billing_country: country, billing_country_source: "checkout" })
        .eq("id", userId);
    if (userId && o["mode"] !== "payment") {
      await db.from("subscriptions").upsert({
        user_id: userId,
        customer_id: o["customer"] as string,
        subscription_id: o["subscription"] as string,
        updated_at: new Date().toISOString(),
      });
    }
  }
  if (event.type === "checkout.session.async_payment_succeeded") {
    const meta = (o["metadata"] as { user_id?: string; kind?: string }) ?? {};
    if (meta.kind === "voice_topup" && meta.user_id)
      await b.creditTopUp(db, meta.user_id, o["payment_intent"] as string);
    if (meta.kind === "ai_credit" && meta.user_id)
      await (
        await import("./spend.server")
      ).creditAiPurchase(db, meta.user_id, o["payment_intent"] as string);
  }
  if (event.type === "charge.refunded" && o["payment_intent"]) {
    await b.reverseTopUp(db, o["payment_intent"] as string);
    await (await import("./spend.server")).reverseAiPurchase(db, o["payment_intent"] as string);
  }
  if (event.type.startsWith("customer.subscription.")) {
    await b.applyStripeSubscription(
      db,
      o as unknown as import("./billing.server").StripeSub,
      event.type === "customer.subscription.deleted",
    );
  }
  // Execute Monthly Execution Reward (owner-locked): close the ended period and credit the renewal; confirm on payment.
  if (
    event.type === "invoice.created" ||
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_failed"
  ) {
    const r = await import("./reward.server");
    await r.handleInvoiceEvent(db, event.type, o as never);
  }
}
