import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Mic, Square, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  appendTranscript,
  MAX_RECORD_SECONDS,
  startRecording,
  transcribe,
  VoiceError,
  VOICE_MESSAGES,
  type Recording,
} from "@/lib/voice-input";
import { cn } from "@/lib/utils";

type State = "idle" | "listening" | "processing" | "ready" | "error";

/**
 * Optional voice input beside a text field. Speech becomes text that is handed to onTranscript;
 * the caller appends it to the same field (see appendTranscript). Never submits anything.
 */
export function VoiceInputButton({
  onTranscript,
  disabled,
  label,
  className,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  label?: string | undefined;
  className?: string;
}) {
  const lbl = label ?? "Speak instead of typing";
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  const [secs, setSecs] = useState(0);
  const rec = useRef<Recording | null>(null);
  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      clearTimer();
      rec.current?.cancel();
      abort.current?.abort();
    },
    [],
  );

  async function start() {
    setMessage("");
    try {
      rec.current = await startRecording();
      setSecs(0);
      setState("listening");
      timer.current = setInterval(() => {
        setSecs((s) => {
          if (s + 1 >= MAX_RECORD_SECONDS) void stop();
          return s + 1;
        });
      }, 1000);
    } catch (e) {
      fail(e);
    }
  }

  function fail(e: unknown) {
    clearTimer();
    rec.current = null;
    if ((e as { name?: string })?.name === "AbortError") {
      setState("idle");
      return;
    }
    setMessage(e instanceof VoiceError ? e.message : VOICE_MESSAGES.failed);
    setState("error");
  }

  async function stop() {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    clearTimer();
    setState("processing");
    try {
      const file = await r.stop();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new VoiceError("failed", "Please sign in again to use voice input.");
      abort.current = new AbortController();
      const text = await transcribe(file, token, abort.current.signal);
      abort.current = null;
      onTranscript(text);
      setMessage("Transcript added — review or edit it before sending.");
      setState("ready");
    } catch (e) {
      fail(e);
    }
  }

  function cancel() {
    clearTimer();
    rec.current?.cancel();
    rec.current = null;
    abort.current?.abort();
    abort.current = null;
    setMessage("");
    setState("idle");
  }

  const busy = state === "listening" || state === "processing";
  return (
    <>
      <span className={cn("inline-flex shrink-0 items-center gap-1", className)}>
        {state === "listening" ? (
          <button
            type="button"
            onClick={() => void stop()}
            aria-label="Stop recording and add transcript"
            className="inline-flex h-9 items-center gap-1 rounded-md bg-destructive px-2 text-xs font-medium text-destructive-foreground"
          >
            <Square className="h-3.5 w-3.5" aria-hidden /> {secs}s
          </button>
        ) : state === "processing" ? (
          <span className="inline-flex h-9 w-9 items-center justify-center" aria-hidden>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={disabled}
            aria-label={lbl}
            title={lbl}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <Mic className="h-4 w-4" aria-hidden />
          </button>
        )}
        {busy && (
          <button
            type="button"
            onClick={cancel}
            aria-label="Cancel voice input"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </span>
      <span
        role="status"
        aria-live="polite"
        className={cn(
          "basis-full text-xs empty:hidden",
          state === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {state === "listening"
          ? "Listening… tap stop when you're done."
          : state === "processing"
            ? "Turning speech into text…"
            : message}
      </span>
    </>
  );
}

/** Places a microphone beside any existing text field; the transcript is appended to the same value. */
export function WithVoice({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  children: ReactNode;
  label?: string | undefined;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <div className="min-w-0 flex-1">{children}</div>
      <VoiceInputButton label={label} onTranscript={(t) => onChange(appendTranscript(value, t))} />
    </div>
  );
}
