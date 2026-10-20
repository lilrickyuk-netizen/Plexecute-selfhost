/**
 * ElevenLabs call voice (server-only). Gemini Live still runs the conversation, tools and reasoning;
 * its spoken words (output transcription) are streamed here and turned into speech with the UK or US
 * ElevenLabs voice. Gemini's own audio for the same turn is held as a safety net: if ElevenLabs fails,
 * that audio plays instead and the rest of the call uses the existing Gemini voice. Never logs keys or words.
 */
import { b64ToBytes, bytesToB64 } from "@/lib/voice";
import { elevenStreamUrl, elevenVoiceSettings } from "@/lib/elevenlabs-voice";
import { log as voiceLog } from "@/lib/observability.server";

type WS = {
  send(d: string): void;
  close(code?: number, reason?: string): void;
  accept(): void;
  addEventListener(t: string, f: (e: any) => void): void;
};

export type SpeakerHandlers = {
  onAudio(twilioB64: string): void;
  onInterrupt(): void;
  onSpoken?(t: string): void;
  onTurnComplete?(): void;
  /** Gemini has started replying (its audio is held while ElevenLabs voices it). */
  onGenerating?(): void;
  [k: string]: unknown;
};

export type ElevenSpeaker = {
  wrap<H extends SpeakerHandlers>(h: H): H;
  characters(): number;
  active(): boolean;
  close(): void;
};

async function openEleven(url: string, apiKey: string): Promise<WS> {
  const r = await fetch(url, { headers: { Upgrade: "websocket", "xi-api-key": apiKey } });
  const ws = (r as any).webSocket as WS | undefined;
  if (!ws) throw new Error(`elevenlabs refused (${r.status})`);
  ws.accept();
  return ws;
}

export function createElevenSpeaker(opts: {
  apiKey: string;
  voiceId: string;
  bookingCall: boolean;
  /** While true (goodbye already given), new speech is not voiced. */
  muted?: () => boolean;
  /** Sentences that must not be spoken (e.g. "anything else?" tacked onto a goodbye). */
  dropSentence?: (sentence: string) => boolean;
}): ElevenSpeaker {
  const url = elevenStreamUrl(opts.voiceId);
  let disabled = false;
  let chars = 0;
  let gen = 0;
  let next: Promise<WS> | null = null;
  let h: SpeakerHandlers | null = null;

  // Current turn
  let sock: Promise<WS> | null = null;
  let sockGen = -1;
  let pending = "";
  let sentText = false;
  let geminiBuf: string[] = [];
  let doneCb: (() => void) | null = null;
  let finalTimer: ReturnType<typeof setTimeout> | null = null;
  let audioTimer: ReturnType<typeof setTimeout> | null = null;
  let waitTextTimer: ReturnType<typeof setTimeout> | null = null;
  let mutedTurn = false;
  let turnStarted = false;
  let droppedAny = false;
  let receivedAudio = false;
  // Muting is decided when a turn starts, so a goodbye already under way is always finished.
  const beginTurnCheck = () => {
    if (turnStarted) return;
    turnStarted = true;
    mutedTurn = !!opts.muted?.();
  };

  const prewarm = () => {
    if (disabled || next) return;
    next = openEleven(url, opts.apiKey).then((ws) => {
      ws.send(JSON.stringify({ text: " ", voice_settings: elevenVoiceSettings(opts.bookingCall) }));
      return ws;
    });
    const mine = next;
    mine.catch(() => {
      // ElevenLabs unreachable: this and later turns use the existing voice.
      if (next === mine) next = null;
      fail("connect_failed");
    });
  };

  const fail = (why: string) => {
    if (disabled) return;
    disabled = true;
    voiceLog({
      level: "warn",
      action: "voice_tts_fallback",
      provider: "elevenlabs",
      result_code: why,
    });
    // Play this turn with the existing voice so the caller is never left on silence.
    for (const b of geminiBuf.splice(0)) h?.onAudio(b);
    geminiBuf = [];
    finishTurn();
  };

  const resetTurn = () => {
    pending = "";
    sentText = false;
    geminiBuf = [];
    mutedTurn = false;
    turnStarted = false;
    droppedAny = false;
    receivedAudio = false;
    sock = null;
    if (finalTimer) clearTimeout(finalTimer);
    if (waitTextTimer) clearTimeout(waitTextTimer);
    if (audioTimer) clearTimeout(audioTimer);
    audioTimer = null;
    finalTimer = waitTextTimer = null;
  };

  const finishTurn = () => {
    gen++; // Late final/audio events from this socket must never finish the next reply.
    const cb = doneCb;
    doneCb = null;
    const s = sock;
    resetTurn();
    s?.then((ws) => {
      try {
        ws.close(1000);
      } catch {
        /* closed */
      }
    }).catch(() => undefined);
    cb?.();
    prewarm();
  };

  const startTurn = () => {
    if (sock) return sock;
    const myGen = gen;
    sockGen = myGen;
    const s =
      next ??
      openEleven(url, opts.apiKey).then((ws) => {
        ws.send(
          JSON.stringify({ text: " ", voice_settings: elevenVoiceSettings(opts.bookingCall) }),
        );
        return ws;
      });
    next = null;
    sock = s;
    s.then((ws) => {
      ws.addEventListener("message", (e: { data: unknown }) => {
        if (myGen !== gen || sockGen !== myGen) return;
        let m: any;
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (m.error) return fail("provider_error");
        if (m.audio) {
          receivedAudio = true;
          if (audioTimer) clearTimeout(audioTimer);
          audioTimer = null;
          const bytes = b64ToBytes(m.audio);
          for (let i = 0; i < bytes.length; i += 1600)
            h?.onAudio(bytesToB64(bytes.subarray(i, i + 1600)));
          geminiBuf = []; // ElevenLabs is speaking this turn; the backup audio is no longer needed
          if (doneCb) {
            if (finalTimer) clearTimeout(finalTimer);
            finalTimer = setTimeout(finishTurn, 1500);
          }
        }
        if (m.isFinal) finishTurn();
      });
      ws.addEventListener("close", () => {
        if (myGen === gen && sock === s) fail("socket_closed");
      });
      ws.addEventListener("error", () => {
        if (myGen === gen && sock === s) fail("socket_error");
      });
    }).catch(() => {
      if (myGen === gen) fail("connect_failed");
    });
    return s;
  };

  const cleanSentence = (raw: string) => {
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t) return "";
    if (opts.dropSentence?.(t)) {
      droppedAny = true;
      return "";
    }
    return t;
  };
  const sendText = (text: string, flush: boolean, close = true) => {
    if (!text.trim() && !flush) return;
    chars += text.trim().length;
    sentText = sentText || !!text.trim();
    const s = startTurn();
    const myGen = gen;
    if (!receivedAudio && !audioTimer) {
      audioTimer = setTimeout(() => {
        audioTimer = null;
        if (myGen === gen && !receivedAudio) fail("audio_timeout");
      }, 1500);
    }
    s.then((ws) => {
      if (myGen !== gen) return;
      try {
        ws.send(JSON.stringify(flush ? { text, flush: true } : { text }));
        if (flush && close) ws.send(JSON.stringify({ text: "" }));
      } catch {
        fail("send_failed");
      }
    }).catch(() => undefined);
  };

  const onText = (t: string) => {
    if (disabled) return;
    beginTurnCheck();
    if (mutedTurn) return;
    if (waitTextTimer) {
      clearTimeout(waitTextTimer);
      waitTextTimer = null;
    }
    pending += t;
    // Whole sentences only: word-by-word input makes ElevenLabs sound like it is reading a script.
    const re = /[^.!?]*[.!?]+["')\]]*\s+/g;
    let m: RegExpExecArray | null;
    let used = 0;
    while ((m = re.exec(pending))) {
      const sentence = cleanSentence(m[0]);
      if (sentence) sendText(`${sentence} `, true, false);
      used = re.lastIndex;
    }
    if (used) pending = pending.slice(used);
    // Start speaking fast: the first words of a reply go out at the first comma or after a few words.
    if (!sentText && !used) {
      const words = pending.trim().split(/\s+/).length;
      const comma = pending.search(/[,;:—–]\s/);
      const cut = comma > 0 ? comma + 1 : words >= 5 ? pending.lastIndexOf(" ") : -1;
      if (cut > 0) {
        const part = cleanSentence(pending.slice(0, cut));
        if (part) sendText(`${part} `, true, false);
        pending = pending.slice(cut).replace(/^\s+/, "");
      }
    }
    // Long run with no full stop: speak up to the last comma so the reply doesn't stall.
    if (pending.length > 160) {
      const cut = Math.max(pending.lastIndexOf(", "), pending.lastIndexOf(" "));
      if (cut > 40) {
        const part = cleanSentence(pending.slice(0, cut + 1));
        if (part) sendText(`${part} `, true, false);
        pending = pending.slice(cut + 1);
      }
    }
    if (doneCb) endTurnNow();
  };

  const endTurnNow = () => {
    if (!sentText && !pending.trim()) {
      // No words arrived for this turn: play Gemini's own audio for it (or nothing, if muted).
      if (!mutedTurn) for (const b of geminiBuf.splice(0)) h?.onAudio(b);
      return finishTurn();
    }
    const last = cleanSentence(pending);
    if (!sentText && !last) {
      if (!mutedTurn && !droppedAny) for (const b of geminiBuf.splice(0)) h?.onAudio(b);
      return finishTurn();
    }
    sendText(last ? `${last} ` : " ", true);
    pending = "";
    if (finalTimer) clearTimeout(finalTimer);
    finalTimer = setTimeout(() => {
      if (receivedAudio) finishTurn();
      else fail("final_timeout");
    }, 1500);
  };

  prewarm();

  return {
    wrap<H extends SpeakerHandlers>(inner: H): H {
      h = inner;
      return {
        ...inner,
        onAudio: (b: string) => {
          if (disabled) return inner.onAudio(b);
          beginTurnCheck();
          if (mutedTurn) return;
          inner.onGenerating?.();
          if (geminiBuf.length < 3000) geminiBuf.push(b);
        },
        onSpoken: (t: string) => {
          inner.onSpoken?.(t);
          onText(t);
        },
        onTurnComplete: () => {
          if (disabled) return inner.onTurnComplete?.();
          doneCb = () => inner.onTurnComplete?.();
          if (sentText || pending.trim()) return endTurnNow();
          // The words can trail the audio slightly: wait briefly before falling back.
          waitTextTimer = setTimeout(() => {
            waitTextTimer = null;
            if (doneCb) endTurnNow();
          }, 250);
        },
        onInterrupt: () => {
          gen++;
          doneCb = null;
          const s = sock;
          resetTurn();
          s?.then((ws) => {
            try {
              ws.close(1000);
            } catch {
              /* closed */
            }
          }).catch(() => undefined);
          prewarm();
          inner.onInterrupt();
        },
      } as H;
    },
    characters: () => chars,
    active: () => !disabled,
    close: () => {
      gen++;
      disabled = true;
      for (const s of [sock, next])
        s?.then((ws) => {
          try {
            ws.close(1000);
          } catch {
            /* closed */
          }
        }).catch(() => undefined);
      sock = next = null;
    },
  };
}
