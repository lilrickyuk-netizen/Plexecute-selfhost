// Pick-any-subject learning: live web search for real courses, books and resources.
// Mirrors the career research path: Firecrawl search, AI extraction, URL verification,
// usage accounting, free-tier AI budget. No invented links: every resource URL must
// come from a fetched page.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Page = { url: string; title?: string; markdown?: string };

export type LearningResource = {
  title: string;
  type: "course" | "book" | "article" | "video" | "webinar" | "practice" | "other";
  free: boolean;
  url: string;
  provider: string;
  why: string;
};

async function search(query: string, uid: string): Promise<Page[]> {
  const key = process.env["FIRECRAWL_API_KEY"];
  if (!key) throw new Error("Live search is not switched on yet.");
  const viaGateway = key.startsWith("lovc_");
  const lk = process.env["LOVABLE_API_KEY"];
  if (viaGateway && !lk) throw new Error("Live search is not switched on yet.");
  const r = await fetch(
    viaGateway
      ? "https://connector-gateway.lovable.dev/firecrawl/v2/search"
      : "https://api.firecrawl.dev/v2/search",
    {
      method: "POST",
      headers: viaGateway
        ? {
            Authorization: `Bearer ${lk}`,
            "X-Connection-Api-Key": key,
            "Content-Type": "application/json",
          }
        : { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        limit: 5,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      }),
    },
  );
  await (
    await import("./usage.server")
  ).recordUsage({
    userId: uid,
    provider: "firecrawl",
    feature: "learning_resources",
    unit: "requests",
    quantity: 1,
    ok: r.ok,
  });
  if (!r.ok) {
    console.error("learning search failed", r.status, (await r.text()).slice(0, 500));
    throw new Error("The web search failed. Try again later.");
  }
  const j = (await r.json()) as { data?: { web?: Page[] } | Page[] };
  const list = Array.isArray(j.data) ? j.data : (j.data?.web ?? []);
  return list.filter((p) => p.url && p.markdown && p.markdown.length > 200).slice(0, 5);
}

export const findLearningResources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        subject: z.string().trim().min(2).max(200),
        level: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => runLearningDiscovery(data, context));

/** The one Learning discovery flow, shared by the Learning page and Coach (same data, same rules). */
export async function runLearningDiscovery(
  data: { subject: string; level: "beginner" | "intermediate" | "advanced" },
  context: { userId: string; supabase: any },
): Promise<{ id: string; resources: LearningResource[]; summary: string | null }> {
  const { userId } = context;
  if (!(await (await import("./security.server")).rateLimit("research", userId)))
    throw new Error("Too many searches this hour. Try again later.");
  // §62: screen the subject before any provider call.
  {
    const sp = await (await import("./safety.server")).screenText(userId, "research", data.subject);
    if (sp.stopOrdinaryCoaching || sp.intervention === "neutral_support_refer") {
      const { data: tzr } = await context.supabase
        .from("profiles")
        .select("timezone")
        .eq("id", userId)
        .maybeSingle();
      throw new Error(
        (await import("./safety")).safetyMessage(sp, tzr?.timezone) ??
          "This can't be searched here.",
      );
    }
  }
  const { data: prof } = await context.supabase
    .from("profiles")
    .select("tier")
    .eq("id", userId)
    .maybeSingle();
  const budget = await import("./ai-budget.server");
  if (!(await (await import("./flags.server")).flagOn("ai_assist")))
    throw new Error((await import("./flags")).PAUSED_AI);
  if (!(await budget.reserveFreeAiBudget(userId, prof?.tier, 12000, 2000)))
    throw new Error(budget.AI_BUDGET_MESSAGE);

  // Several focused searches in parallel: free courses, free books, materials and webinars.
  const queries = [
    `free online courses to learn ${data.subject} ${data.level}`,
    `free ebooks or open textbooks for learning ${data.subject}`,
    `free ${data.subject} tutorials, learning materials and practice exercises`,
    `free ${data.subject} webinars, video lectures or workshops`,
  ];
  const settled = await Promise.allSettled(queries.map((q) => search(q, userId)));
  const byUrl = new Map<string, Page>();
  for (const s of settled)
    if (s.status === "fulfilled")
      for (const p of s.value) if (!byUrl.has(p.url)) byUrl.set(p.url, p);
  if (!byUrl.size && settled[0]?.status === "rejected") throw settled[0].reason;
  const pages = [...byUrl.values()].slice(0, 14);
  if (!pages.length) throw new Error("No usable public sources were found. Try different words.");

  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new Error("Resource reading is not switched on.");
  const r = await (
    await import("./metered-ai.server")
  ).meteredAiFetch(
    userId,
    "learning_resources",
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
              `From the numbered sources, pick the best learning resources for the subject and level. ` +
              `Return JSON {"resources":[{"source":number,"title":string,"type":"course"|"book"|"article"|"video"|"webinar"|"practice"|"other","free":boolean,"url":string,"provider":string,"why":string}],"summary":string}. ` +
              `Rules: every url must be copied exactly from a source (the source's own url or a link clearly present in its text); never invent or guess a url. ` +
              `Strongly prefer FREE resources (free online courses, free/open books, free learning materials, free webinars/lectures); mix types so the member gets courses, books, materials and webinars where the sources have them. Set free=true only when the source shows it is free. Prefer well-known providers. "why" is one short sentence. "summary" is 2-3 sentences: a sensible starting path for a ${data.level}. ` +
              `At most 12 resources.`,
          },
          {
            role: "user",
            content:
              `Subject: ${data.subject}\nLevel: ${data.level}\n\n` +
              pages.map((p, i) => `[${i}] ${p.url}\n${p.markdown!.slice(0, 2500)}`).join("\n\n"),
          },
        ],
      }),
    },
  );
  if (!r.ok)
    await (
      await import("./usage.server")
    ).recordAiUsage(userId, "learning_resources", "openai/gpt-6-luna", null, false);
  if (r.status === 429) throw new Error("Too many requests right now. Try again in a minute.");
  if (r.status === 402) throw new Error("Learning search is temporarily unavailable.");
  if (!r.ok) throw new Error("Reading the sources failed.");
  const j = (await r.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  await (
    await import("./usage.server")
  ).recordAiUsage(userId, "learning_resources", "openai/gpt-6-luna", j);
  await budget.settleAiUsage(
    userId,
    prof?.tier,
    12000,
    2000,
    j.usage ? { input: j.usage.prompt_tokens, output: j.usage.completion_tokens } : null,
  );

  let extracted: { resources?: unknown[]; summary?: unknown } = {};
  try {
    extracted = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
  } catch {
    extracted = {};
  }
  // Keep only resources whose URL was actually seen in a fetched page.
  const seen = new Set(pages.map((p) => p.url.replace(/\/$/, "").toLowerCase()));
  const pageText = pages.map((p) => p.markdown!).join("\n");
  const resources: LearningResource[] = [];
  for (const raw of extracted.resources ?? []) {
    const o = raw as Record<string, unknown>;
    const url = typeof o["url"] === "string" ? o["url"].trim() : "";
    if (!/^https:\/\//.test(url)) continue;
    const norm = url.replace(/\/$/, "").toLowerCase();
    if (!seen.has(norm) && !pageText.includes(url)) continue;
    resources.push({
      title: String(o["title"] ?? "").slice(0, 200) || url,
      type: (
        ["course", "book", "article", "video", "webinar", "practice", "other"] as const
      ).includes(o["type"] as never)
        ? (o["type"] as LearningResource["type"])
        : "other",
      free: o["free"] === true,
      url: url.slice(0, 500),
      provider: String(o["provider"] ?? "").slice(0, 120),
      why: String(o["why"] ?? "").slice(0, 300),
    });
    if (resources.length >= 12) break;
  }
  if (!resources.length)
    throw new Error("The sources did not yield verifiable links. Try a more specific subject.");

  const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const { data: rec, error } = await db
    .from("learning_searches")
    .insert({
      user_id: userId,
      subject: data.subject,
      level: data.level,
      summary: typeof extracted.summary === "string" ? extracted.summary.slice(0, 1200) : null,
      resources,
    })
    .select("id")
    .single();
  if (error || !rec) throw new Error("The results could not be saved.");
  return {
    id: rec.id as string,
    resources,
    summary: typeof extracted.summary === "string" ? extracted.summary : null,
  };
}

export const listLearningTopics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("learning_searches")
      .select("id,subject,level,summary,resources,created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error("Your learning searches could not be loaded.");
    return data ?? [];
  });
