import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEARNING_POLICY_VERSION, nextReview, REVIEW_INTERVALS } from "./learning";
import { addDaysKey, localDayKey } from "./tz";

async function zone(sb: any, userId: string) {
  const { data } = await sb.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  return (data?.timezone as string | undefined) ?? "UTC";
}

export const addRetrievalItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        goalId: z.string().uuid(),
        topicId: z.string().uuid().nullable(),
        prompt: z.string().trim().min(1).max(1000),
        answer: z.string().trim().min(1).max(2000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const tz = await zone(context.supabase, context.userId);
    const due = addDaysKey(localDayKey(new Date(), tz), REVIEW_INTERVALS[0]);
    const { error } = await context.supabase.from("retrieval_items").insert({
      user_id: context.userId,
      goal_id: data.goalId,
      topic_id: data.topicId,
      prompt: data.prompt,
      answer: data.answer,
      due_on: due,
      policy_version: LEARNING_POLICY_VERSION,
    });
    if (error) throw new Error("The question could not be saved.");
    return { due };
  });

export const reviewItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ itemId: z.string().uuid(), correct: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: item } = await supabase
      .from("retrieval_items")
      .select("id,interval_step")
      .eq("id", data.itemId)
      .maybeSingle();
    if (!item) throw new Error("Question not found.");
    const tz = await zone(supabase, userId);
    const r = nextReview(item.interval_step, data.correct);
    const due = addDaysKey(localDayKey(new Date(), tz), r.days);
    const { error } = await supabase
      .from("retrieval_items")
      .update({ interval_step: r.toStep, due_on: due })
      .eq("id", item.id);
    if (error) throw new Error("The review could not be saved.");
    const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    await db.from("retrieval_reviews").insert({
      user_id: userId,
      item_id: item.id,
      correct: data.correct,
      from_step: item.interval_step,
      to_step: r.toStep,
      next_due: due,
      policy_version: LEARNING_POLICY_VERSION,
    });
    return { due, days: r.days };
  });

/** AI authors questions only from the user's own study notes; every item is marked generated. */
export const generateQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ resourceId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: res } = await supabase
      .from("learning_resources")
      .select("id,goal_id,title,content")
      .eq("id", data.resourceId)
      .maybeSingle();
    if (!res?.content?.trim()) throw new Error("Paste your study notes into this resource first.");
    const key = process.env["OPENAI_API_KEY"];
    if (!key) throw new Error("Question writing is not switched on.");
    // V3 §5.2: Free has a daily AI token budget, enforced before the provider call.
    const { data: prof } = await supabase
      .from("profiles")
      .select("tier")
      .eq("id", userId)
      .maybeSingle();
    const budget = await import("./ai-budget.server");
    const estIn = Math.ceil(res.content.slice(0, 20000).length / 4) + 200;
    if (!(await (await import("./flags.server")).flagOn("ai_assist")))
      throw new Error((await import("./flags")).PAUSED_AI);
    if (!(await budget.reserveFreeAiBudget(userId, prof?.tier, estIn, 1200)))
      throw new Error(budget.AI_BUDGET_MESSAGE);
    const r = await (
      await import("./metered-ai.server")
    ).meteredAiFetch(
      userId,
      "study_questions",
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai/gpt-6-luna",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                'Write retrieval-practice questions using ONLY facts stated in the user\'s study notes. Do not add outside knowledge. Return JSON {"items":[{"prompt":string,"answer":string}]} with at most 10 items.',
            },
            { role: "user", content: res.content.slice(0, 20000) },
          ],
        }),
      },
    );
    if (!r.ok)
      await (
        await import("./usage.server")
      ).recordAiUsage(userId, "study_questions", "openai/gpt-6-luna", null, false);
    if (r.status === 429) throw new Error("Too many requests right now. Try again in a minute.");
    if (r.status === 402) throw new Error("Question writing is temporarily unavailable.");
    if (!r.ok) throw new Error("Question writing failed. You can still add questions yourself.");
    const j = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    await (
      await import("./usage.server")
    ).recordAiUsage(userId, "study_questions", "openai/gpt-6-luna", j);
    await budget.settleAiUsage(
      userId,
      prof?.tier,
      estIn,
      1200,
      j.usage ? { input: j.usage.prompt_tokens, output: j.usage.completion_tokens } : null,
    );
    const { outputViolations } = await import("./safety"); // §62 output check on generated questions
    let items: { prompt: string; answer: string }[] = [];
    try {
      const p = JSON.parse(j.choices?.[0]?.message?.content ?? "{}") as { items?: unknown[] };
      items = (p.items ?? [])
        .flatMap((x: any) => {
          const pr = String(x?.prompt ?? "")
              .trim()
              .slice(0, 1000),
            an = String(x?.answer ?? "")
              .trim()
              .slice(0, 2000);
          return pr && an && !outputViolations(pr + " " + an).length
            ? [{ prompt: pr, answer: an }]
            : [];
        })
        .slice(0, 10);
    } catch {
      items = [];
    }
    if (!items.length) return { added: 0 };
    const tz = await zone(supabase, userId);
    const due = addDaysKey(localDayKey(new Date(), tz), REVIEW_INTERVALS[0]);
    const { error } = await supabase.from("retrieval_items").insert(
      items.map((x) => ({
        ...x,
        user_id: userId,
        goal_id: res.goal_id,
        resource_id: res.id,
        generated: true,
        due_on: due,
        policy_version: LEARNING_POLICY_VERSION,
      })),
    );
    if (error) throw new Error("The questions could not be saved.");
    return { added: items.length };
  });
