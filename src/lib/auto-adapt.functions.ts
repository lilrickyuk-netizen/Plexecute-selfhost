import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AUTO_ADAPT_PERMISSIONS, toMap } from "./auto-adapt";

export const getAutoAdapt = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("auto_adapt_permissions")
      .select("permission,enabled");
    return toMap(data);
  });

export const setAutoAdapt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ permission: z.enum(AUTO_ADAPT_PERMISSIONS), enabled: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("auto_adapt_permissions")
      .upsert({ user_id: context.userId, permission: data.permission, enabled: data.enabled });
    if (error) throw new Error("Your setting could not be saved.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "user",
      action: "auto_adapt.changed",
      resource_type: "auto_adapt_permission",
      resource_id: data.permission,
      outcome: "succeeded",
      metadata: { enabled: data.enabled },
    });
    await supabaseAdmin.from("consent_records").insert({
      user_id: context.userId,
      purpose: `auto_adapt:${data.permission}`,
      policy_version: "v3-auto-adapt-1",
      action: data.enabled ? "granted" : "withdrawn",
    });
    return { ok: true };
  });
