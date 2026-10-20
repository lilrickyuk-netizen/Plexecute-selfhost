import { localDayRange } from "@/lib/tz";
import { createFileRoute } from "@tanstack/react-router";

const twiml = (body: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });

export const Route = createFileRoute("/api/public/twilio/$action")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const m = await import("@/lib/integrations.server");
        const url = new URL(request.url);
        const fd = await request.formData().catch(() => null);
        if (!fd) return new Response("Bad request", { status: 400 });
        const form = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
        const publicUrl = (m.env("APP_BASE_URL") ?? url.origin) + url.pathname + url.search;
        if (
          !(await m.verifyTwilioSignature(
            publicUrl,
            form,
            request.headers.get("x-twilio-signature"),
          ))
        ) {
          return new Response("Forbidden", { status: 403 });
        }
        const logId = url.searchParams.get("log") ?? "";
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: log } = await supabaseAdmin
          .from("call_logs")
          .select("*")
          .eq("id", logId)
          .maybeSingle();
        if (!log) return twiml("<Hangup/>");
        // UK members get the British recordings of the opening lines; everyone else keeps the existing voice.
        const accentParam = async () => {
          const { data: pr } = await supabaseAdmin
            .from("profiles")
            .select("billing_country")
            .eq("id", log.user_id)
            .maybeSingle();
          const { callAccent } = await import("@/lib/voice");
          return callAccent(pr?.billing_country) === "en-GB"
            ? '<Parameter name="accent" value="gb"/>'
            : "";
        };

        if (params.action === "status") {
          const cs = await import("@/lib/calling.server");
          await cs.handleStatus(supabaseAdmin, logId, form);
          return new Response("ok");
        }

        // Appointment booking call to a business: the AI opens with the owner's wording, no member keypad steps.
        if (log.booking_id && params.action !== "status") {
          const base = m.env("APP_BASE_URL") ?? url.origin;
          if (params.action === "gather" && url.searchParams.get("step") === "closing")
            return twiml("<Hangup/>");
          if (params.action === "gather" && url.searchParams.get("step") === "after_stream") {
            if (log.voice_end_reason === "closing_done") return twiml("<Hangup/>");
            const ap = await import("@/lib/appointments.server");
            const line = await ap.bookingCallSignoff(supabaseAdmin, logId);
            return twiml(
              `<Say voice='Polly.Amy-Neural' language='en-GB'>${m.xmlEscape(line)}</Say><Gather input="speech" timeout="3" speechTimeout="auto" actionOnEmptyResult="true" action="${m.xmlEscape(`${base}/api/public/twilio/gather?log=${logId}&step=closing`)}" method="POST"/><Hangup/>`,
            );
          }
          if (params.action === "amd") {
            if ((form["AnsweredBy"] ?? "").startsWith("machine") && form["CallSid"])
              await m.twilioUpdateCall(form["CallSid"], "<Response><Hangup/></Response>");
            return new Response("ok");
          }
          if (params.action !== "voice" || (form["AnsweredBy"] ?? "").startsWith("machine"))
            return twiml("<Hangup/>");
          const v = await import("@/lib/voice.server");
          if (!v.voiceLiveReady()) return twiml("<Hangup/>");
          const wss = base.replace(/^http/, "ws") + "/api/public/voice/stream";
          const tok = await v.streamToken(logId);
          return twiml(
            `<Connect><Stream url="${m.xmlEscape(wss)}"><Parameter name="log" value="${m.xmlEscape(logId)}"/><Parameter name="token" value="${m.xmlEscape(tok)}"/><Parameter name="opening" value="booking"/>${await accentParam()}</Stream></Connect><Redirect method="POST">${m.xmlEscape(`${base}/api/public/twilio/gather?log=${logId}&step=after_stream`)}</Redirect>`,
          );
        }

        // V3 §64 campaign calls: AI disclosure first, account-holder confirmation, then task detail and acknowledgement.
        if (log.campaign_id) {
          const c = await import("@/lib/calling");
          const cs = await import("@/lib/calling.server");
          const base = m.env("APP_BASE_URL") ?? url.origin;
          const step = url.searchParams.get("step");
          if (params.action === "voice") {
            if ((form["AnsweredBy"] ?? "").startsWith("machine")) {
              // Voicemail policy: silent by default; the generic message never includes task detail (§64.4).
              const { data: vp } = await supabaseAdmin
                .from("profiles")
                .select("call_voicemail_policy")
                .eq("id", log.user_id)
                .maybeSingle();
              const vm = c.voicemailMessage(vp?.call_voicemail_policy);
              return twiml(
                vm
                  ? `<Say voice='Polly.Amy-Neural' language='en-GB'>${m.xmlEscape(vm)}</Say><Hangup/>`
                  : "<Hangup/>",
              );
            }
            // Answer -> live stream at once: the stream plays the opening line (same wording) while Coach
            // connects, then Coach answers the member's hello. Pick-up is recorded inside the stream.
            const v = await import("@/lib/voice.server");
            if (v.voiceLiveReady()) {
              const wss = base.replace(/^http/, "ws") + "/api/public/voice/stream";
              const tok = await v.streamToken(logId);
              return twiml(
                `<Connect><Stream url="${m.xmlEscape(wss)}"><Parameter name="log" value="${m.xmlEscape(logId)}"/><Parameter name="token" value="${m.xmlEscape(tok)}"/><Parameter name="opening" value="1"/>${await accentParam()}</Stream></Connect><Redirect method="POST">${m.xmlEscape(`${base}/api/public/twilio/gather?log=${logId}&step=after_stream`)}</Redirect>`,
              );
            }
            // Keypad-only fallback when live voice is switched off.
            return twiml(
              `<Gather input="speech dtmf" numDigits="1" timeout="6" speechTimeout="auto" language="en-GB" actionOnEmptyResult="false" action="${m.xmlEscape(`${base}/api/public/twilio/gather?log=${logId}&step=confirm`)}" method="POST"><Say voice='Polly.Amy-Neural' language='en-GB'>${m.xmlEscape(c.DISCLOSURE)} ${m.xmlEscape(c.CONFIRM_PROMPT)}</Say></Gather><Say voice='Polly.Amy-Neural' language='en-GB'>Goodbye.</Say>`,
            );
          }
          if (params.action === "amd") {
            // Async answering-machine result: only act on voicemail; a person is already talking to Coach.
            if ((form["AnsweredBy"] ?? "").startsWith("machine") && form["CallSid"]) {
              const { data: vp } = await supabaseAdmin
                .from("profiles")
                .select("call_voicemail_policy")
                .eq("id", log.user_id)
                .maybeSingle();
              const vm = log.campaign_id
                ? (await import("@/lib/calling")).voicemailMessage(vp?.call_voicemail_policy)
                : null;
              await m.twilioUpdateCall(
                form["CallSid"],
                `<Response>${vm ? `<Say voice='Polly.Amy-Neural' language='en-GB'>${m.xmlEscape(vm)}</Say>` : ""}<Hangup/></Response>`,
              );
            }
            return new Response("ok");
          }
          if (params.action === "gather" && step === "confirm") {
            const heard = !!form["Digits"] || !!(form["SpeechResult"] ?? "").trim();
            if (!heard)
              return twiml("<Say voice='Polly.Amy-Neural' language='en-GB'>Okay. Goodbye.</Say>");
            await cs.markConnected(supabaseAdmin, logId);
            // Step 48: live AI voice over a bidirectional Media Stream when configured; keypad otherwise.
            const v = await import("@/lib/voice.server");
            if (v.voiceLiveReady()) {
              const wss = base.replace(/^http/, "ws") + "/api/public/voice/stream";
              const tok = await v.streamToken(logId);
              return twiml(
                `<Connect><Stream url="${m.xmlEscape(wss)}"><Parameter name="log" value="${m.xmlEscape(logId)}"/><Parameter name="token" value="${m.xmlEscape(tok)}"/></Stream></Connect><Redirect method="POST">${m.xmlEscape(`${base}/api/public/twilio/gather?log=${logId}&step=after_stream`)}</Redirect>`,
              );
            }
            const { data: camp } = await supabaseAdmin
              .from("call_campaigns")
              .select("block_id,trigger")
              .eq("id", log.campaign_id)
              .single();
            const { data: blk } = camp?.block_id
              ? await supabaseAdmin
                  .from("plan_blocks")
                  .select("title")
                  .eq("id", camp.block_id)
                  .maybeSingle()
              : { data: null };
            const { data: sty } = await supabaseAdmin
              .from("profiles")
              .select("call_style,coaching_style")
              .eq("id", log.user_id)
              .maybeSingle();
            const lead = c.styleLine(sty?.call_style ?? sty?.coaching_style);
            let prompt = blk
              ? camp?.trigger === "missed"
                ? c.missedPrompt(blk.title)
                : c.taskPrompt(blk.title)
              : `Thanks. This is the check-in you asked for. ${c.DAY_MENU}`;
            if (!blk && (camp?.trigger === "morning" || camp?.trigger === "evening")) {
              const { data: tzRow } = await supabaseAdmin
                .from("profiles")
                .select("timezone")
                .eq("id", log.user_id)
                .maybeSingle();
              const [ds, de] = localDayRange(new Date(), tzRow?.timezone);
              const { data: today } = await supabaseAdmin
                .from("plan_blocks")
                .select("title,status,starts_at")
                .eq("user_id", log.user_id)
                .neq("source_type", "commitment")
                .gte("starts_at", ds.toISOString())
                .lt("starts_at", de.toISOString())
                .not("status", "in", "(rescheduled,cancelled)")
                .order("starts_at");
              prompt = c.dayPrompt(
                camp.trigger,
                (today ?? []).map((b) => ({ title: b.title, status: b.status })),
              );
            }
            return twiml(
              `<Gather numDigits="1" timeout="10" action="${m.xmlEscape(`${base}/api/public/twilio/gather?log=${logId}&step=ack`)}" method="POST"><Say voice='Polly.Amy-Neural' language='en-GB'>${m.xmlEscape(`${lead} ${prompt}`)}</Say></Gather><Say voice='Polly.Amy-Neural' language='en-GB'>Nothing chosen. Your session stays in your plan. Goodbye.</Say>`,
            );
          }
          if (params.action === "gather" && step === "after_stream") {
            // §64.12: never fabricate an outcome. Safety ends cleanly; degraded/no choice falls back to the keypad.
            const { data: lg } = await supabaseAdmin
              .from("call_logs")
              .select("voice_end_reason")
              .eq("id", logId)
              .single();
            const { data: cp } = await supabaseAdmin
              .from("call_campaigns")
              .select("acknowledgement,block_id")
              .eq("id", log.campaign_id)
              .single();
            const vo = await import("@/lib/voice");
            if (lg?.voice_end_reason === "safety") {
              const sf = await import("@/lib/safety.server");
              const s2 = await import("@/lib/safety");
              const { data: tzr } = await supabaseAdmin
                .from("profiles")
                .select("timezone")
                .eq("id", log.user_id)
                .maybeSingle();
              const msg =
                s2.safetyMessage(await sf.currentPolicy(log.user_id), tzr?.timezone) ??
                s2.GENERIC_EMERGENCY;
              return twiml(
                `<Say voice='Polly.Amy-Neural' language='en-GB'>${m.xmlEscape(`${vo.SAFETY_END_LINE} ${msg}`)}</Say><Hangup/>`,
              );
            }
            if (cp?.acknowledgement || lg?.voice_end_reason === "no_choice")
              return twiml("<Hangup/>");
            const lead = lg?.voice_end_reason === "degraded" ? `${vo.DEGRADED_LINE} ` : "";
            const menu = cp?.block_id ? c.ACK_MENU : c.DAY_MENU;
            return twiml(
              `<Gather numDigits="1" timeout="10" action="${m.xmlEscape(`${base}/api/public/twilio/gather?log=${logId}&step=ack`)}" method="POST"><Say voice='Polly.Amy-Neural' language='en-GB'>${m.xmlEscape(lead + menu)}</Say></Gather><Say voice='Polly.Amy-Neural' language='en-GB'>Nothing changed. Goodbye.</Say>`,
            );
          }
          if (params.action === "gather" && step === "ack") {
            const { data: camp2 } = await supabaseAdmin
              .from("call_campaigns")
              .select("block_id")
              .eq("id", log.campaign_id)
              .single();
            const ack = !camp2?.block_id
              ? form["Digits"] === "9"
                ? ("STOP_ALL_CALLS" as const)
                : form["Digits"] === "1"
                  ? ("START_NOW" as const)
                  : undefined
              : c.ACK_DIGITS[form["Digits"] ?? ""];
            if (!ack)
              return twiml(
                "<Say voice='Polly.Amy-Neural' language='en-GB'>Nothing changed. Your session stays in your plan. Goodbye.</Say>",
              );
            await cs.applyAck(supabaseAdmin, logId, ack);
            return twiml(
              `<Say voice='Polly.Amy-Neural' language='en-GB'>${m.xmlEscape(camp2?.block_id || ack === "STOP_ALL_CALLS" ? c.ACK_LABEL[ack] : "Thanks")}. Goodbye.</Say>`,
            );
          }
          return new Response("Not found", { status: 404 });
        }

        const { data: tzRow } = await supabaseAdmin
          .from("profiles")
          .select("timezone")
          .eq("id", log.user_id)
          .maybeSingle();
        const [start, end] = localDayRange(new Date(), tzRow?.timezone);
        const { data: blocks } = await supabaseAdmin
          .from("plan_blocks")
          .select("id,title,status")
          .eq("user_id", log.user_id)
          .gte("starts_at", start.toISOString())
          .lt("starts_at", end.toISOString())
          .order("starts_at");
        const planned = (blocks ?? []).filter((b) =>
          [
            "planned",
            "scheduled",
            "upcoming",
            "due",
            "contacting",
            "acknowledged",
            "snoozed",
          ].includes(b.status),
        );

        if (params.action === "voice") {
          const done = (blocks ?? []).filter((b) => b.status === "done").length;
          const say = planned.length
            ? `This is your Plexecute check-in. You have finished ${done} of ${blocks!.length} sessions today. Still open: ${planned
                .slice(0, 3)
                .map((b) => b.title)
                .join(
                  ", ",
                )}. Did you complete ${planned[0]!.title}? Press 1 for yes, 2 for not yet.`
            : `This is your Plexecute check-in. Everything planned for today is closed out. Well executed. Goodbye.`;
          if (!planned.length)
            return twiml(
              `<Say voice='Polly.Amy-Neural' language='en-GB'>${m.xmlEscape(say)}</Say>`,
            );
          await supabaseAdmin
            .from("plan_blocks")
            .update({ status: "contacting" })
            .eq("id", planned[0]!.id);
          await supabaseAdmin.from("plan_block_events").insert({
            user_id: log.user_id,
            block_id: planned[0]!.id,
            event_type: "contact",
            from_status: planned[0]!.status,
            to_status: "contacting",
            reason_code: "accountability_call",
            actor_type: "system",
            source_channel: "call",
            evidence_refs: [{ call_log: logId }],
            idempotency_key: `call:${logId}:contact`,
          });
          return twiml(
            `<Gather numDigits="1" action="${m.xmlEscape(`${m.env("APP_BASE_URL") ?? url.origin}/api/public/twilio/gather?log=${logId}`)}" method="POST"><Say voice='Polly.Amy-Neural' language='en-GB'>${m.xmlEscape(say)}</Say></Gather><Say voice='Polly.Amy-Neural' language='en-GB'>No answer recorded. Goodbye.</Say>`,
          );
        }

        if (params.action === "gather") {
          const digit = form["Digits"];
          const first = planned[0];
          if (first && digit === "1") {
            const { error: tErr } = await supabaseAdmin
              .from("plan_blocks")
              .update({ status: "done", completed_at: new Date().toISOString() })
              .eq("id", first.id);
            if (!tErr)
              await supabaseAdmin.from("plan_block_events").insert({
                user_id: log.user_id,
                block_id: first.id,
                event_type: "complete",
                from_status: first.status,
                to_status: "done",
                reason_code: "call_confirmed",
                actor_type: "call",
                source_channel: "call",
                evidence_refs: [{ call_log: logId }],
                idempotency_key: `call:${logId}:done`,
              });
            if (!tErr)
              await (
                await import("@/lib/verification.server")
              ).verifyBlock(supabaseAdmin, log.user_id, first.id);
          }
          await supabaseAdmin
            .from("call_logs")
            .update({ outcome: digit === "1" ? "confirmed_done" : "not_yet" })
            .eq("id", logId);
          return twiml(
            `<Say voice='Polly.Amy-Neural' language='en-GB'>${digit === "1" ? "Logged as done. Keep going." : "Understood. It stays in your plan. You can still do it."} Goodbye.</Say>`,
          );
        }
        return new Response("Not found", { status: 404 });
      },
    },
  },
});
