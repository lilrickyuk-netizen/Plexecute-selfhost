import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  INVITE_DAYS,
  PRO_PERMISSIONS,
  PRO_ROLES,
  effectivePermissions,
  screenProposal,
  type ProPermission,
} from "./professional";

const sha = async (s: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`plexecute-pro:${s}`)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;
async function audit(
  ownerId: string,
  actor: "user" | "professional",
  action: string,
  shareId: string,
  metadata: Record<string, unknown> = {},
) {
  await (await admin()).from("audit_events").insert({
    user_id: ownerId,
    action,
    actor_type: actor,
    resource_type: "professional_share",
    resource_id: shareId,
    outcome: "succeeded",
    metadata: metadata as never,
  });
}
const Perms = z.array(z.enum(PRO_PERMISSIONS));

// ---------- Owner side ----------
export const getMyShares = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    const [{ data: shares }, { data: msgs }, { data: props }, { data: hist }] = await Promise.all([
      db
        .from("professional_shares")
        .select(
          "id,professional_name,role,credential_status,permissions,health_consent,status,invite_expires_at,accepted_at,revoked_at,created_at",
        )
        .order("created_at", { ascending: false }),
      db
        .from("professional_messages")
        .select("id,share_id,author,body,created_at")
        .order("created_at")
        .limit(500),
      db
        .from("professional_proposals")
        .select("id,share_id,kind,title,detail,schedule,status,safety_reason,decided_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("audit_events")
        .select("action,actor_type,resource_id,created_at,metadata")
        .eq("resource_type", "professional_share")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    const now = Date.now();
    return {
      shares: (shares ?? []).map((s) => ({
        ...s,
        status:
          s.status === "invited" &&
          s.invite_expires_at &&
          new Date(s.invite_expires_at).getTime() < now
            ? "expired"
            : s.status,
      })),
      messages: msgs ?? [],
      proposals: props ?? [],
      history: hist ?? [],
    };
  });

export const createShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        name: z.string().trim().min(1).max(80),
        role: z.enum(PRO_ROLES),
        userAsserted: z.boolean(),
        permissions: Perms.min(1),
        healthConsent: Perms,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await (
      await import("./entitlements.server")
    ).requireCapability(context.supabase, context.userId, "professional_connect");
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
    const db = await admin();
    const { data: row, error } = await db
      .from("professional_shares")
      .insert({
        user_id: context.userId,
        professional_name: data.name,
        role: data.role,
        credential_status: data.userAsserted ? "USER_ASSERTED" : "UNVERIFIED",
        permissions: data.permissions,
        health_consent: data.healthConsent.filter((p) => data.permissions.includes(p)),
        invite_token_hash: await sha(token),
        invite_expires_at: new Date(Date.now() + INVITE_DAYS * 864e5).toISOString(),
      })
      .select("id")
      .single();
    if (error || !row) throw new Error("Couldn't create the invitation.");
    await audit(context.userId, "user", "professional.invite", row.id, {
      role: data.role,
      permissions: data.permissions,
      health_consent: data.healthConsent,
    });
    await (
      await import("./consent.server")
    ).recordConsent(db, {
      userId: context.userId,
      purpose: "professional_sharing",
      granted: true,
      scope: data.permissions,
      domain: data.healthConsent.join(",") || null,
      provider: data.role,
      subjectId: row.id,
    });
    return { id: row.id, token };
  });

export const updateSharePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), permissions: Perms, healthConsent: Perms }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: s } = await context.supabase
      .from("professional_shares")
      .select("id,status")
      .eq("id", data.id)
      .maybeSingle();
    if (!s || s.status === "revoked") throw new Error("That share wasn't found.");
    await (
      await admin()
    )
      .from("professional_shares")
      .update({
        permissions: data.permissions,
        health_consent: data.healthConsent.filter((p) => data.permissions.includes(p)),
      })
      .eq("id", data.id);
    await audit(context.userId, "user", "professional.permissions", data.id, {
      permissions: data.permissions,
      health_consent: data.healthConsent,
    });
    await (
      await import("./consent.server")
    ).recordConsent(await admin(), {
      userId: context.userId,
      purpose: "professional_sharing",
      granted: data.permissions.length > 0,
      scope: data.permissions,
      domain: data.healthConsent.join(",") || null,
      subjectId: data.id,
    });
    return { ok: true };
  });

/** Instant revocation: the professional loses access on their next request; pending suggestions are closed. */
export const revokeShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: s } = await context.supabase
      .from("professional_shares")
      .select("id")
      .eq("id", data.id)
      .maybeSingle();
    if (!s) throw new Error("That share wasn't found.");
    const db = await admin();
    await db
      .from("professional_shares")
      .update({ status: "revoked", revoked_at: new Date().toISOString(), invite_token_hash: null })
      .eq("id", data.id);
    await db
      .from("professional_proposals")
      .update({ status: "declined", decided_at: new Date().toISOString() })
      .eq("share_id", data.id)
      .eq("status", "pending");
    await audit(context.userId, "user", "professional.revoke", data.id);
    await (
      await import("./consent.server")
    ).recordConsent(db, {
      userId: context.userId,
      purpose: "professional_sharing",
      granted: false,
      subjectId: data.id,
    });
    return { ok: true };
  });

export const sendOwnerMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), body: z.string().trim().min(1).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: s } = await context.supabase
      .from("professional_shares")
      .select("id,status")
      .eq("id", data.id)
      .maybeSingle();
    if (!s || s.status !== "active") throw new Error("You can message only an active connection.");
    await (
      await admin()
    )
      .from("professional_messages")
      .insert({ share_id: data.id, user_id: context.userId, author: "user", body: data.body });
    return { ok: true };
  });

/** A suggestion changes nothing until the user accepts. Accepted plan changes with times become a labelled fixed commitment. */
export const decideProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), decision: z.enum(["accept", "decline", "end"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: p } = await context.supabase
      .from("professional_proposals")
      .select(
        "id,share_id,kind,title,detail,schedule,status,commitment_id,professional_shares(professional_name,role,status)",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (!p) throw new Error("That suggestion wasn't found.");
    const share = p.professional_shares as {
      professional_name: string;
      role: string;
      status: string;
    } | null;
    const db = await admin(),
      now = new Date().toISOString();
    if (data.decision === "end") {
      if (p.status !== "accepted") throw new Error("Only accepted suggestions can be ended.");
      if (p.commitment_id)
        await db.from("commitments").update({ active: false }).eq("id", p.commitment_id);
      await db
        .from("professional_proposals")
        .update({ status: "ended", decided_at: now })
        .eq("id", p.id);
      await audit(context.userId, "user", "professional.proposal.end", p.share_id, {
        proposal_id: p.id,
      });
      return { ok: true };
    }
    if (p.status !== "pending") throw new Error("That suggestion has already been decided.");
    if (data.decision === "decline") {
      await db
        .from("professional_proposals")
        .update({ status: "declined", decided_at: now })
        .eq("id", p.id);
      await audit(context.userId, "user", "professional.proposal.decline", p.share_id, {
        proposal_id: p.id,
      });
      return { ok: true };
    }
    if (share?.status !== "active") throw new Error("This professional no longer has access.");
    const unsafe = screenProposal(`${p.title} ${p.detail ?? ""}`);
    if (unsafe) {
      await db
        .from("professional_proposals")
        .update({ status: "blocked", safety_reason: unsafe, decided_at: now })
        .eq("id", p.id);
      throw new Error(unsafe);
    }
    let commitmentId: string | null = null;
    const sch = p.schedule as {
      days?: number[];
      on_date?: string;
      start_time: string;
      end_time: string;
    } | null;
    if (p.kind === "plan_change" && sch) {
      const { data: c, error } = await context.supabase
        .from("commitments")
        .insert({
          user_id: context.userId,
          title: p.title.slice(0, 120),
          kind: "appointment",
          is_hard: true,
          start_time: sch.start_time,
          end_time: sch.end_time,
          recurrence: sch.on_date ? "once" : "weekly",
          days: sch.days ?? [],
          on_date: sch.on_date ?? null,
          note: `From ${share?.professional_name} (professional), accepted by you ${now.slice(0, 10)}`,
        })
        .select("id")
        .single();
      if (error || !c) throw new Error("Couldn't add it to your commitments.");
      commitmentId = c.id;
    }
    await db
      .from("professional_proposals")
      .update({ status: "accepted", decided_at: now, commitment_id: commitmentId })
      .eq("id", p.id);
    await audit(context.userId, "user", "professional.proposal.accept", p.share_id, {
      proposal_id: p.id,
      commitment_id: commitmentId,
    });
    return { ok: true };
  });

// ---------- Professional side ----------
export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: s } = await db
      .from("professional_shares")
      .select("id,user_id,status,invite_expires_at")
      .eq("invite_token_hash", await sha(data.token))
      .maybeSingle();
    if (!s || s.status !== "invited")
      return { ok: false as const, reason: "This invitation isn't valid any more." };
    if (s.invite_expires_at && new Date(s.invite_expires_at).getTime() < Date.now())
      return { ok: false as const, reason: "This invitation has expired. Ask for a new one." };
    if (s.user_id === context.userId)
      return {
        ok: false as const,
        reason: "This is your own invitation. Send the link to your professional.",
      };
    await db
      .from("professional_shares")
      .update({
        status: "active",
        professional_user_id: context.userId,
        accepted_at: new Date().toISOString(),
        invite_token_hash: null,
      })
      .eq("id", s.id);
    await audit(s.user_id, "professional", "professional.accept", s.id);
    return { ok: true as const, id: s.id };
  });

async function activeShareFor(proId: string, id: string) {
  const { data: s } = await (
    await admin()
  )
    .from("professional_shares")
    .select(
      "id,user_id,professional_name,role,permissions,health_consent,status,professional_user_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!s || s.status !== "active" || s.professional_user_id !== proId)
    throw new Error("You don't have access to this person any more.");
  return { ...s, perms: effectivePermissions(s.permissions, s.health_consent) };
}

export const getMyClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const { data } = await db
      .from("professional_shares")
      .select("id,user_id,role,permissions,health_consent,accepted_at")
      .eq("professional_user_id", context.userId)
      .eq("status", "active");
    const ids = (data ?? []).map((s) => s.user_id);
    const { data: profs } = ids.length
      ? await db.from("profiles").select("id,display_name").in("id", ids)
      : { data: [] };
    const name = new Map((profs ?? []).map((p) => [p.id, p.display_name]));
    return (data ?? []).map((s) => ({
      id: s.id,
      client: name.get(s.user_id) ?? "Client",
      role: s.role,
      perms: effectivePermissions(s.permissions, s.health_consent),
      accepted_at: s.accepted_at,
    }));
  });

/** Scoped view: only domains the client allowed (and consented to, for health domains). Every view is audited. */
export const getClientView = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const s = await activeShareFor(context.userId, data.id),
      db = await admin(),
      u = s.user_id,
      has = (p: ProPermission) => s.perms.includes(p);
    const now = Date.now(),
      d28 = new Date(now - 28 * 864e5).toISOString(),
      d14 = new Date(now - 14 * 864e5).toISOString();
    const { data: prof } = await db.from("profiles").select("display_name").eq("id", u).single();
    const out: Record<string, unknown> = { client: prof?.display_name ?? "Client", perms: s.perms };
    if (has("VIEW_SELECTED_PROGRESS")) {
      const { data: b } = await db
        .from("plan_blocks")
        .select("status")
        .eq("user_id", u)
        .gte("starts_at", d28)
        .lte("starts_at", new Date(now).toISOString())
        .limit(2000);
      const c: Record<string, number> = {};
      for (const r of b ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
      const { data: g } = await db
        .from("goals")
        .select("title,status,current_value,target_value,unit")
        .eq("user_id", u)
        .neq("status", "archived")
        .limit(20);
      out["progress"] = { last28: c, goals: g ?? [] };
    }
    if (has("VIEW_SELECTED_PLAN"))
      out["plan"] =
        (
          await db
            .from("plan_blocks")
            .select("title,starts_at,duration_min,status")
            .eq("user_id", u)
            .gte("starts_at", new Date(now).toISOString())
            .lte("starts_at", new Date(now + 14 * 864e5).toISOString())
            .order("starts_at")
            .limit(100)
        ).data ?? [];
    if (has("VIEW_SELECTED_TRAINING"))
      out["training"] =
        (
          await db
            .from("workout_sessions")
            .select("started_at,completed_at,status,recovery_state")
            .eq("user_id", u)
            .gte("started_at", d28)
            .order("started_at", { ascending: false })
            .limit(30)
        ).data ?? [];
    if (has("VIEW_SELECTED_NUTRITION")) {
      const [{ data: t }, { data: f }] = await Promise.all([
        db
          .from("nutrition_targets")
          .select("kcal,protein_g,carbs_g,fat_g,created_at")
          .eq("user_id", u)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1),
        db
          .from("food_entries")
          .select("eaten_on,kcal,protein_g")
          .eq("user_id", u)
          .gte("eaten_on", d14.slice(0, 10))
          .limit(2000),
      ]);
      const days = new Map<string, { kcal: number; protein: number }>();
      for (const r of f ?? []) {
        const x = days.get(r.eaten_on) ?? { kcal: 0, protein: 0 };
        x.kcal += Number(r.kcal);
        x.protein += Number(r.protein_g);
        days.set(r.eaten_on, x);
      }
      out["nutrition"] = {
        target: t?.[0] ?? null,
        days: [...days.entries()]
          .sort()
          .map(([day, v]) => ({ day, kcal: Math.round(v.kcal), protein_g: Math.round(v.protein) })),
      };
    }
    if (has("VIEW_SELECTED_RECOVERY"))
      out["recovery"] =
        (
          await db
            .from("recovery_checkins")
            .select("check_date,sleep_quality,energy,soreness,stress,readiness,ill_or_injured")
            .eq("user_id", u)
            .gte("check_date", d14.slice(0, 10))
            .order("check_date", { ascending: false })
        ).data ?? [];
    out["messages"] = has("COMMENT")
      ? ((
          await db
            .from("professional_messages")
            .select("author,body,created_at")
            .eq("share_id", s.id)
            .order("created_at")
            .limit(200)
        ).data ?? [])
      : [];
    out["proposals"] = has("PROPOSE_CONSTRAINT_OR_PLAN_CHANGE")
      ? ((
          await db
            .from("professional_proposals")
            .select("kind,title,status,safety_reason,created_at")
            .eq("share_id", s.id)
            .order("created_at", { ascending: false })
            .limit(50)
        ).data ?? [])
      : [];
    await audit(u, "professional", "professional.view", s.id, {
      sections: s.perms.filter((p) => p.startsWith("VIEW_")),
    });
    return out as {
      client: string;
      perms: ProPermission[];
      progress?: {
        last28: Record<string, number>;
        goals: {
          title: string;
          status: string;
          current_value: number | null;
          target_value: number | null;
          unit: string | null;
        }[];
      };
      plan?: { title: string; starts_at: string; duration_min: number; status: string }[];
      training?: {
        started_at: string;
        completed_at: string | null;
        status: string;
        recovery_state: string | null;
      }[];
      nutrition?: {
        target: { kcal: number; protein_g: number } | null;
        days: { day: string; kcal: number; protein_g: number }[];
      };
      recovery?: {
        check_date: string;
        sleep_quality: number | null;
        energy: number | null;
        soreness: number | null;
        stress: number | null;
        readiness: string | null;
        ill_or_injured: boolean | null;
      }[];
      messages: { author: string; body: string; created_at: string }[];
      proposals: {
        kind: string;
        title: string;
        status: string;
        safety_reason: string | null;
        created_at: string;
      }[];
    };
  });

export const sendProMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), body: z.string().trim().min(1).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const s = await activeShareFor(context.userId, data.id);
    if (!s.perms.includes("COMMENT")) throw new Error("You don't have permission to comment.");
    await (
      await admin()
    )
      .from("professional_messages")
      .insert({ share_id: s.id, user_id: s.user_id, author: "professional", body: data.body });
    await audit(s.user_id, "professional", "professional.comment", s.id);
    return { ok: true };
  });

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const sendProProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        kind: z.enum(["constraint", "plan_change"]),
        title: z.string().trim().min(1).max(120),
        detail: z.string().trim().max(2000).optional(),
        schedule: z
          .object({
            days: z.array(z.number().int().min(1).max(7)).optional(),
            on_date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
            start_time: Time,
            end_time: Time,
          })
          .refine((s) => s.end_time > s.start_time && (!!s.on_date || (s.days?.length ?? 0) > 0))
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const s = await activeShareFor(context.userId, data.id);
    if (!s.perms.includes("PROPOSE_CONSTRAINT_OR_PLAN_CHANGE"))
      throw new Error("You don't have permission to suggest changes.");
    const unsafe = screenProposal(`${data.title} ${data.detail ?? ""}`);
    const { data: row } = await (
      await admin()
    )
      .from("professional_proposals")
      .insert({
        share_id: s.id,
        user_id: s.user_id,
        kind: data.kind,
        title: data.title,
        detail: data.detail ?? null,
        schedule: data.schedule ?? null,
        status: unsafe ? "blocked" : "pending",
        safety_reason: unsafe,
      })
      .select("id")
      .single();
    await audit(s.user_id, "professional", "professional.propose", s.id, {
      proposal_id: row?.id,
      blocked: !!unsafe,
    });
    return { ok: true, blocked: unsafe };
  });
