import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { transitionPlanBlock, type PlanBlockActionInput } from "@/lib/planning.functions";
import { newOpId, readCache, sendOrQueue, writeCache } from "@/lib/offline";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Goal = Database["public"]["Tables"]["goals"]["Row"];
export type Block = Database["public"]["Tables"]["plan_blocks"]["Row"];
export type Log = Database["public"]["Tables"]["daily_logs"]["Row"];

async function uid() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const id = await uid();
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      writeCache("profile", data);
      return data;
    },
    initialData: () =>
      typeof window === "undefined" ? undefined : readCache<Profile | null>("profile"),
    initialDataUpdatedAt: 0,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Profile>) => {
      const id = await uid();
      const { error } = await supabase.from("profiles").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile"] }),
  });
}

export function useGoals() {
  return useQuery({
    queryKey: ["goals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("goals").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
  });
}

export function useBlocks(fromIso: string, toIso: string, includeHistorical = false) {
  return useQuery({
    queryKey: ["blocks", fromIso, toIso, includeHistorical],
    queryFn: async () => {
      let query = supabase
        .from("plan_blocks")
        .select("*")
        .gte("starts_at", fromIso)
        .lt("starts_at", toIso)
        .order("starts_at");
      if (!includeHistorical) query = query.neq("status", "rescheduled");
      const { data, error } = await query;
      if (error) throw error;
      writeCache(`blocks:${fromIso}:${toIso}:${includeHistorical}`, data);
      return data;
    },
    // §56: the last synced copy of the day stays readable offline.
    initialData: () =>
      typeof window === "undefined"
        ? undefined
        : readCache<Block[]>(`blocks:${fromIso}:${toIso}:${includeHistorical}`),
    initialDataUpdatedAt: 0,
  });
}

export function useSetBlockStatus() {
  const qc = useQueryClient();
  const transition = useServerFn(transitionPlanBlock);
  return useMutation({
    mutationFn: async (data: PlanBlockActionInput) => {
      const id = data.idempotencyKey ?? newOpId();
      const r = await sendOrQueue("transition", data as never, id, () =>
        transition({ data: { ...data, idempotencyKey: id } }),
      );
      if (r.queued) {
        // Optimistic local status so Today reflects the offline action until it syncs.
        const { ACTION_TARGET } = await import("@/lib/execution");
        qc.setQueriesData<Block[]>({ queryKey: ["blocks"] }, (old) =>
          old?.map((b) =>
            b.id === data.blockId
              ? { ...b, status: ACTION_TARGET[data.action] as Block["status"] }
              : b,
          ),
        );
        return { ok: true, status: ACTION_TARGET[data.action], duplicate: false, queued: true };
      }
      return r.result;
    },
    onSuccess: (r) => {
      if (!(r as { queued?: boolean }).queued) qc.invalidateQueries({ queryKey: ["blocks"] });
    },
  });
}

export function useLogs(kind?: string) {
  return useQuery({
    queryKey: ["logs", kind],
    queryFn: async () => {
      let q = supabase
        .from("daily_logs")
        .select("*")
        .order("log_date", { ascending: true })
        .limit(200);
      if (kind) q = q.eq("kind", kind);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export { uid };
