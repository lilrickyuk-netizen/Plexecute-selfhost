import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WEARABLES } from "./wearables";

const origin = () => {
  try {
    return new URL(getRequest().url).origin;
  } catch {
    return "";
  }
};

export const getWearableState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { wearableConfig } = await import("./wearables.server");
    const { isStale } = await import("./wearables");
    const { data } = await context.supabase
      .from("wearable_connections")
      .select("id,provider,status,last_sync_at,last_error,created_at")
      .in("status", ["active", "degraded", "revoked"])
      .order("created_at");
    return {
      configured: Object.fromEntries(WEARABLES.map((p) => [p, !!wearableConfig(p)])) as Record<
        (typeof WEARABLES)[number],
        boolean
      >,
      connections: (data ?? []).map((c) => ({
        ...c,
        stale: isStale(c.provider as (typeof WEARABLES)[number], c.last_sync_at),
      })),
    };
  });

export const startWearableConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ provider: z.enum(WEARABLES) }).parse(d))
  .handler(async ({ data, context }) => {
    await (
      await import("./entitlements.server")
    ).requireCapability(context.supabase, context.userId, "premium_wearables");
    const m = await import("./wearables.server");
    if (!m.wearableConfig(data.provider)) return { url: null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("wearable_connections")
      .update({ status: "disconnected" })
      .eq("user_id", context.userId)
      .eq("provider", data.provider)
      .eq("status", "revoked");
    return { url: await m.authUrl(supabaseAdmin, data.provider, context.userId, origin()) };
  });

async function own(sb: { from: (t: "wearable_connections") => any }, id: string) {
  const { data } = await sb.from("wearable_connections").select("id").eq("id", id).maybeSingle();
  if (!data) throw new Error("That connection wasn't found.");
}

export const syncWearableNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await own(context.supabase, data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return {
      status: await (await import("./wearables.server")).syncWearable(supabaseAdmin, data.id),
    };
  });

export const disconnectWearableFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), deleteData: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await own(context.supabase, data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (
      await import("./wearables.server")
    ).disconnectWearable(supabaseAdmin, data.id, data.deleteData);
    return { ok: true };
  });
