import { createFileRoute } from "@tanstack/react-router";

// Twilio Media Stream WebSocket. Callers are authenticated by a short-lived HMAC token sent in the
// stream "start" event (Twilio custom parameter), checked before any provider connection is made.
export const Route = createFileRoute("/api/public/voice/stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket")
          return new Response("Expected WebSocket", { status: 426 });
        const v = await import("@/lib/voice.server");
        if (!v.voiceLiveReady()) return new Response("Voice not switched on", { status: 503 });
        const runtimeRequest = request as Request & {
          waitUntil?: (work: Promise<unknown>) => void;
        };
        return v.handleVoiceStream(runtimeRequest.waitUntil?.bind(runtimeRequest));
      },
    },
  },
});
