import { aiCostUsd, retailMicro, usdToMicroGbp, AI_CREDIT_MESSAGE } from "./spend";
import { aiFetch } from "./ai-gateway.server";

/** Admission and settlement surround each actual gateway request, including retries/tool rounds. */
export async function meteredAiFetch(
  userId: string | null,
  feature: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  if (!userId) return aiFetch(url, init);
  const spend = await import("./spend.server");
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const payload = JSON.parse(String(init.body)) as Record<string, any>;
  const model = String(payload["model"]);
  const outputCap = 16000;
  if (url.endsWith("/responses")) payload["max_output_tokens"] = outputCap;
  else payload["max_completion_tokens"] = outputCap;
  const st = await spend.spendState(userId, db);
  const rate = (await spend.usdPerGbp(db)) ?? 1.3;
  // A UTF-8 byte is a conservative upper bound for text tokens. Images get a separate bounded reserve.
  const text = JSON.stringify(payload).replace(/data:image\/[^" ]+/g, "[image]");
  const inputCap = new TextEncoder().encode(text).length + 16000;
  const estimate = usdToMicroGbp(aiCostUsd(model, inputCap, outputCap), rate);
  let id: string | null = null;
  if (st.tier === "pro" || st.tier === "execute") {
    const r = await db.rpc("reserve_paid_ai", {
      _user: userId,
      _period: st.period,
      _cost: estimate,
      _ref: crypto.randomUUID(),
    });
    if (r.error) throw new Error("AI usage could not be checked.");
    if (!r.data) throw new Error(AI_CREDIT_MESSAGE);
    id = r.data;
  }
  const settle = async (cost: number) => {
    if (!id) return;
    const r = await db.rpc("settle_paid_ai", {
      _id: id,
      _cost: cost,
      _feature: feature,
      _retail: retailMicro(cost),
    });
    if (r.error) throw new Error("AI usage could not be saved.");
  };
  let incurredCost = 0;
  try {
    const response = await aiFetch(url, { ...init, body: JSON.stringify(payload) });
    if (!response.ok) {
      await settle(0);
      return response;
    }
    const raw = await response.clone().text();
    let usage: any = null;
    if (payload["stream"]) {
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          const event = JSON.parse(line.slice(5));
          usage = event.response?.usage ?? event.usage ?? usage;
        } catch {
          /* SSE terminator */
        }
      }
    } else usage = JSON.parse(raw).usage;
    const input = Number(usage?.input_tokens ?? usage?.prompt_tokens ?? inputCap);
    const output = Number(usage?.output_tokens ?? usage?.completion_tokens ?? outputCap);
    const cost = usdToMicroGbp(aiCostUsd(model, input, output), rate);
    incurredCost = cost;
    if (id) await settle(cost);
    else await spend.chargeAi(userId, feature, model, input, output);
    return response;
  } catch (error) {
    await settle(incurredCost);
    throw error;
  }
}
