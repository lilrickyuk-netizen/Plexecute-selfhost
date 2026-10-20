import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { HEALTH_CATEGORIES, HEALTH_PLATFORMS, hashToken } from "./health";

const audit = async (
  userId: string,
  action: string,
  id: string,
  metadata: Record<string, unknown>,
) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("audit_events").insert({
    user_id: userId,
    action,
    actor_type: "user",
    resource_type: "health_connection",
    resource_id: id,
    outcome: "succeeded",
    metadata: metadata as never,
  });
};

export const getHealthState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    const [{ data: conns }, { data: counts }] = await Promise.all([
      db
        .from("health_connections")
        .select(
          "id,platform,status,categories,last_received_at,rejected_count,created_at,revoked_at",
        )
        .order("created_at", { ascending: false })
        .limit(20),
      db.from("health_samples").select("source").eq("is_deleted", false).limit(5000),
    ]);
    const bySource: Record<string, number> = {};
    for (const r of counts ?? []) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    return {
      connections: (conns ?? []).filter((c) => c.status === "active"),
      history: (conns ?? []).filter((c) => c.status !== "active"),
      bySource,
    };
  });

/** Creates (or replaces) a connection and returns its key once; only a hash is stored. */
export const connectHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        platform: z.enum(HEALTH_PLATFORMS),
        categories: z.array(z.enum(HEALTH_CATEGORIES)).min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    await db
      .from("health_connections")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("platform", data.platform)
      .eq("status", "active");
    const key = `phk_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
    const { data: row, error } = await db
      .from("health_connections")
      .insert({
        user_id: context.userId,
        platform: data.platform,
        categories: data.categories,
        token_hash: await hashToken(key),
      })
      .select("id")
      .single();
    if (error || !row) throw new Error("Couldn't create the connection.");
    await audit(context.userId, "health.connect", row.id, {
      platform: data.platform,
      categories: data.categories,
    });
    await (
      await import("./consent.server")
    ).recordConsent(db, {
      userId: context.userId,
      purpose: "health_data",
      granted: true,
      scope: data.categories,
      provider: data.platform,
      subjectId: row.id,
    });
    return { id: row.id, key };
  });

export const updateHealthPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), categories: z.array(z.enum(HEALTH_CATEGORIES)) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: own } = await context.supabase
      .from("health_connections")
      .select("id")
      .eq("id", data.id)
      .eq("status", "active")
      .maybeSingle();
    if (!own) throw new Error("That connection wasn't found.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    await db.from("health_connections").update({ categories: data.categories }).eq("id", data.id);
    await audit(context.userId, "health.permissions", data.id, { categories: data.categories });
    await (
      await import("./consent.server")
    ).recordConsent(db, {
      userId: context.userId,
      purpose: "health_data",
      granted: data.categories.length > 0,
      scope: data.categories,
      subjectId: data.id,
    });
    return { ok: true };
  });

/** Revocation: the key stops working at once; optionally every reading from that source is deleted. */
export const revokeHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), deleteData: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: own } = await context.supabase
      .from("health_connections")
      .select("id,platform")
      .eq("id", data.id)
      .maybeSingle();
    if (!own) throw new Error("That connection wasn't found.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    await db
      .from("health_connections")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    let deleted = 0;
    if (data.deleteData) {
      const { count } = await db
        .from("health_samples")
        .delete({ count: "exact" })
        .eq("user_id", context.userId)
        .eq("source", own.platform);
      deleted = count ?? 0;
    }
    await audit(context.userId, "health.revoke", data.id, { platform: own.platform, deleted });
    await (
      await import("./consent.server")
    ).recordConsent(db, {
      userId: context.userId,
      purpose: "health_data",
      granted: false,
      provider: own.platform,
      subjectId: data.id,
    });
    return { deleted };
  });

/** Privacy control: delete all readings from one source without disconnecting. */
export const deleteHealthSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ source: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    const { count } = await context.supabase
      .from("health_samples")
      .delete({ count: "exact" })
      .eq("source", data.source);
    await audit(context.userId, "health.delete_source", context.userId, {
      source: data.source,
      deleted: count ?? 0,
    });
    return { deleted: count ?? 0 };
  });
