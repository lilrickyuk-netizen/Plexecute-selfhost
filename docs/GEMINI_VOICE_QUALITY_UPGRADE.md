# Gemini/Twilio voice-quality upgrade — 17 October 2026

## Architecture found

Verified Twilio webhook → token-protected bidirectional Media Stream → direct Gemini Live WebSocket → streaming per-call 8 kHz mu-law / 16 kHz input PCM, 24 kHz output PCM / filtered 8 kHz mu-law conversion → Twilio playback. Model default: gemini-2.5-flash-native-audio-latest. Voice default: Charon. Deployed override values not verified; configured values and existing backup remain unchanged. High start/end VAD sensitivity, 200 ms prefix, 300 ms silence, zero thinking budget preserved.

## Root causes / changes

Member instructions were generic and lacked name/local commitment context. They now specify professional, confident, calm, warm, concise Coach speech with contractions, no generic filler or mechanical echoing. Existing first name, local time and next active commitment today are supplied. Business instructions use a separate polite professional register, responding naturally to alternative approved times; no unrelated member history is shared.

Member outcomes previously used a fixed four-second timer; booking outcomes immediately cleared live audio. VoiceClosing now gates a live farewell on model turn completion, Twilio playback acknowledgement and two seconds of recipient silence. Interrupted/cleared marks cannot confirm playback. Failed closing is bounded at 15 seconds. Booking farewells use the verified persisted result; successful playback avoids duplicate TTS, while the existing verified after-stream fallback remains and allows three seconds for acknowledgement. Repeated ordinary closing tools do not reapply outcomes; stop/safety actions retain precedence. Booking validation, payment safeguards, notifications, scheduling, retries and saved-result functions are unchanged.

## Latency before / after

No real audible baseline was available; no measured phone improvement is claimed. New secret-free diagnostics record stream-start-to-first-generated/sent-audio, opening buffer delay, observed mean/longest turn waits and interruptions, without transcripts or personal data. These are transport measurements, not actual answered-phone-to-audible-speech timing. No speculative model/voice/VAD change was made without audible baseline evidence.

Baseline: 18 targeted tests passed. Full regression: 832 passed, 102 skipped. Final targeted follow-up: 22 passed. Build OK; ESLint zero errors, 36 existing warnings. Deterministic tests cover playback beyond four seconds, acknowledgement waits, interruptions/cleared marks, bounded failure and adapter turn-completion ordering; they are not live conversation acceptance.

## Live A–E

A wake-up call: NOT VERIFIED.
B meeting reminder: NOT VERIFIED.
C restaurant reservation: NOT VERIFIED.
D requested restaurant time unavailable: NOT VERIFIED.
E appointment enquiry: NOT VERIFIED.

No calls placed; nothing published. Gemini credentials were not exposed in this sandbox, and safe real recipient scenarios were not established. Updated published calls with audible observation are required to assess naturalness, actual latency/silence, barge-in, audio glitches and outcomes.

## PASS / FAIL

FAIL pending real audible A–E tests. Code/regression checks pass, not voice-quality acceptance.