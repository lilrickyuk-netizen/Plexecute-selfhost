import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const fmt = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");

// Private subscribable calendar feed (Google / Apple / Outlook "subscribe by URL").
export const Route = createFileRoute("/api/public/calendar/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = params.token.replace(/\.ics$/, "");
        if (!z.string().uuid().safeParse(token).success)
          return new Response("Not found", { status: 404 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: p } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("calendar_token", token)
          .maybeSingle();
        if (!p) return new Response("Not found", { status: 404 });
        const from = new Date(Date.now() - 14 * 864e5).toISOString();
        const { data: blocks } = await supabaseAdmin
          .from("plan_blocks")
          .select("id,title,starts_at,duration_min,status")
          .eq("user_id", p.id)
          .gte("starts_at", from)
          .order("starts_at")
          .limit(500);
        const lines = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//Plexecute//Plan//EN",
          "CALSCALE:GREGORIAN",
          "X-WR-CALNAME:Plexecute plan",
        ];
        for (const b of blocks ?? []) {
          const s = new Date(b.starts_at);
          const e = new Date(s.getTime() + b.duration_min * 60000);
          lines.push(
            "BEGIN:VEVENT",
            `UID:${b.id}@plexecute`,
            `DTSTAMP:${fmt(new Date())}`,
            `DTSTART:${fmt(s)}`,
            `DTEND:${fmt(e)}`,
            `SUMMARY:${esc((b.status === "done" ? "✓ " : "") + b.title)}`,
            `STATUS:${b.status === "skipped" ? "CANCELLED" : "CONFIRMED"}`,
            "END:VEVENT",
          );
        }
        lines.push("END:VCALENDAR");
        return new Response(lines.join("\r\n"), {
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Cache-Control": "private, max-age=300",
          },
        });
      },
    },
  },
});
