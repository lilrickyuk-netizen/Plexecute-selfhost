import { flagDef } from "./flags";

/** True unless an admin has switched this kill switch off. Missing rows mean on. */
export async function flagOn(key: string): Promise<boolean> {
  if (flagDef(key)?.kind !== "kill_switch") return true;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("feature_flags")
    .select("enabled")
    .eq("key", key)
    .maybeSingle();
  return data ? data.enabled : true;
}

export async function flagCap(key: string): Promise<number | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("feature_flags")
    .select("enabled,cap_value")
    .eq("key", key)
    .maybeSingle();
  return data?.enabled ? data.cap_value : null;
}
