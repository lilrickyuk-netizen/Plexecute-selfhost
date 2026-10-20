import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CATEGORIES, prefsMap, IN_APP_REQUIRED, EMAIL_ALLOWED, type Category } from "@/lib/notify";

export const getNotificationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { emailDeliveryConfigured } = await import("@/lib/notify.server");
    const [{ data: prefs }, { data: devices }, { data: history }, { data: prompt }] =
      await Promise.all([
        supabase.from("notification_preferences").select("category,in_app,push,email"),
        supabase
          .from("push_devices")
          .select("id,platform,device_name,status,last_seen_at,created_at")
          .neq("status", "removed")
          .order("created_at", { ascending: false }),
        supabase
          .from("notifications")
          .select(
            "id,channel,category,intent,title,status,scheduled_at,sent_at,attempts,last_error,interaction,created_at",
          )
          .order("created_at", { ascending: false })
          .limit(60),
        supabase
          .from("profiles")
          .select(
            "reminders_enabled,reminder_lead_min,push_motivating,quiet_start,quiet_end,push_muted_kinds",
          )
          .eq("id", context.userId)
          .maybeSingle(),
      ]);
    return {
      prefs: prefsMap(prefs),
      devices: devices ?? [],
      history: history ?? [],
      emailOn: emailDeliveryConfigured(),
      prompt: prompt ?? null,
    };
  });

export const saveNotificationPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        category: z.enum(CATEGORIES),
        in_app: z.boolean(),
        push: z.boolean(),
        email: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = data.category as Category;
    const row = {
      user_id: context.userId,
      category: c,
      in_app: IN_APP_REQUIRED.has(c) ? true : data.in_app,
      push: data.push,
      email: EMAIL_ALLOWED[c] ? data.email : false,
    };
    const { error } = await context.supabase
      .from("notification_preferences")
      .upsert(row, { onConflict: "user_id,category" });
    if (error) throw new Error("Could not save your choice.");
    return { ok: true };
  });

/** Called by the Plexecute phone app after it receives an Expo / APNs / FCM token. */
export const registerPushDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        platform: z.enum(["expo", "apns", "fcm", "web"]),
        token: z.string().min(10).max(1200),
        deviceName: z.string().max(80).optional(),
      })
      .refine(
        (v) => v.platform !== "expo" || /^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(v.token),
        "Not an Expo push token",
      )
      .refine((v) => {
        if (v.platform !== "web") return true;
        try {
          const s = JSON.parse(v.token);
          return (
            /^https:\/\//.test(s.endpoint) &&
            typeof s.keys?.p256dh === "string" &&
            typeof s.keys?.auth === "string"
          );
        } catch {
          return false;
        }
      }, "Not a browser push subscription")
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Never reassign a device token that already belongs to another member.
    const { data: existing } = await supabaseAdmin
      .from("push_devices")
      .select("user_id")
      .eq("platform", data.platform)
      .eq("token", data.token)
      .maybeSingle();
    if (existing && existing.user_id !== context.userId)
      throw new Error("Could not register this device.");
    const { error } = await supabaseAdmin.from("push_devices").upsert(
      {
        user_id: context.userId,
        platform: data.platform,
        token: data.token,
        device_name: data.deviceName ?? null,
        status: "active",
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "platform,token" },
    );
    if (error) throw new Error("Could not register this device.");
    await supabaseAdmin.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "user",
      action: "push.device_registered",
      resource_type: "push_device",
      outcome: "succeeded",
      metadata: { platform: data.platform },
    });
    return { ok: true };
  });

export const removePushDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("push_devices")
      .update({ status: "removed" })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    return { ok: true };
  });

export const markNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ id: z.string().uuid(), interaction: z.enum(["opened", "acted", "dismissed"]) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { recordInteraction } = await import("@/lib/notify.server");
    await recordInteraction(context.supabase as never, context.userId, data.id, data.interaction);
    return { ok: true };
  });

/** Public half of the browser-push key pair, so this browser can subscribe. */
export const getWebPushKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { vapidPublicKey } = await import("./webpush.server");
    return { key: vapidPublicKey() };
  });

/** No subscription secrets leave the server; match only this member's current browser. */
export const getPushDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ token: z.string().max(1200).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { webPushConfigured } = await import("./webpush.server");
    const deviceResult = data.token
      ? await supabase
          .from("push_devices")
          .select("id,status,created_at,last_seen_at")
          .eq("user_id", userId)
          .eq("platform", "web")
          .eq("token", data.token)
          .maybeSingle()
      : { data: null, error: null };
    const historyResult = await supabase
      .from("notifications")
      .select(
        "id,channel,scheduled_at,sent_at,status,attempts,last_error,provider_result,created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (deviceResult.error || historyResult.error)
      throw new Error("Could not check notification delivery.");
    const history = historyResult.data ?? [];
    const lastPush = history.find((n) => n.channel === "push" && n.attempts > 0);
    const result = lastPush?.provider_result as {
      attempted_at?: string;
      devices?: Array<{ id: string; ok: boolean; status: number | null; error?: string }>;
    } | null;
    const deviceAttempt = result?.devices?.find((d) => d.id === deviceResult.data?.id);
    return {
      configured: webPushConfigured(),
      device: deviceResult.data,
      lastScheduled: history[0]?.scheduled_at ?? null,
      lastAttempt: result?.attempted_at ?? lastPush?.sent_at ?? null,
      deviceAttempt: deviceAttempt ?? null,
      lastPushStatus: lastPush?.status ?? null,
      lastError: deviceAttempt?.error ?? lastPush?.last_error ?? null,
    };
  });

/** Member prompt preferences (also changed by Coach). */
export const savePromptPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        reminders_enabled: z.boolean().optional(),
        reminder_lead_min: z.number().int().min(5).max(120).optional(),
        push_motivating: z.boolean().optional(),
        quiet_start: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable()
          .optional(),
        quiet_end: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable()
          .optional(),
        push_muted_kinds: z.array(z.string().max(20)).max(20).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { PUSH_KINDS } = await import("./push-plan");
    const patch: Record<string, unknown> = { ...data };
    if (data.push_muted_kinds)
      patch["push_muted_kinds"] = data.push_muted_kinds.filter((k) =>
        (PUSH_KINDS as readonly string[]).includes(k),
      );
    const { error } = await context.supabase
      .from("profiles")
      .update(patch as never)
      .eq("id", context.userId);
    if (error) throw new Error("Could not save your notification settings.");
    return { ok: true };
  });
