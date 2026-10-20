/** ElevenLabs call voice: pure helpers (voice choice, request shape). Gemini decides the words; this is only how they sound. */

export const ELEVEN_MODEL = "eleven_turbo_v2_5";

/** UK-facing calls (British accent instructions) use the UK voice; every other call uses the US voice. */
export function elevenVoiceId(
  british: boolean,
  ids: { gb?: string | null; us?: string | null },
): string | null {
  const id = (british ? ids.gb : ids.us)?.trim();
  return id ? id : null;
}

/** Streaming endpoint: mu-law 8 kHz is exactly what the Twilio call plays, so no conversion is needed. */
export function elevenStreamUrl(voiceId: string): string {
  return `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream-input?model_id=${ELEVEN_MODEL}&output_format=ulaw_8000&inactivity_timeout=180&auto_mode=false`;
}

/** Calm, natural phone voice: member calls a little warmer, business calls a little steadier. */
export function elevenVoiceSettings(bookingCall: boolean) {
  return bookingCall
    ? { stability: 0.5, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true, speed: 1.05 }
    : { stability: 0.35, similarity_boost: 0.8, style: 0.5, use_speaker_boost: true, speed: 1.08 };
}

/** Extra speaking guidance while ElevenLabs is the voice (content and reasoning stay with Gemini). */
export const ELEVEN_SPEAKING_GUIDE =
  'Sound confident, upbeat and energetic, like a person talking, not reading: short spoken sentences, contractions, varied rhythm, natural pauses, no list-like phrasing. Use brief acknowledgements such as "Okay", "Perfect" or "Got it" only where they fit. Never repeat a confirmation you have already given. To finish, say only a short goodbye such as "Okay, speak soon. Bye." Never ask "Is there anything else I can help you with?" or any question in the goodbye. Say goodbye exactly once; then call end_call and say nothing more.';

/** "Anything else I can help with?" is never voiced on member calls; the goodbye stands on its own. */
export function isAnythingElseQuestion(sentence: string): boolean {
  return /\b(is there )?anything (else )?(i can|that i can|i could|to) (help|do|assist)|anything else (you need|for you|today)|can i help (you )?with anything else/i.test(
    sentence,
  );
}
