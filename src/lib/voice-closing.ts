/** Playback acknowledgement, not generation time, owns a normal call's closing. */
export type CallPhase =
  | "OPENING"
  | "REQUEST"
  | "DISCUSSION"
  | "CONFIRMATION"
  | "CLOSING"
  | "WAIT_FOR_OTHER_PERSON"
  | "END";

/** A saved booking's farewell cannot be reopened by ambient restaurant audio. */
export function acceptsCallAudio(bookingCall: boolean, phase: CallPhase): boolean {
  return (
    !bookingCall || (phase !== "CLOSING" && phase !== "WAIT_FOR_OTHER_PERSON" && phase !== "END")
  );
}

export class VoiceClosing {
  phase: CallPhase = "OPENING";
  private closingAt = 0;
  private playedAt = 0;
  private heardAt = 0;
  private audioPending = false;
  request() {
    this.phase = "REQUEST";
  }
  discussion() {
    if (this.phase === "REQUEST") this.phase = "DISCUSSION";
  }
  close(now: number) {
    this.phase = "CONFIRMATION";
    this.closingAt = now;
    this.phase = "CLOSING";
  }
  private sawAudio = false;
  audio() {
    if (this.phase === "CLOSING") {
      this.audioPending = true;
      this.sawAudio = true;
    }
  }
  completed() {
    if (this.phase !== "CLOSING" || !this.audioPending) return false;
    this.audioPending = false;
    return true;
  }
  played(now: number) {
    if (this.phase === "CLOSING") {
      this.phase = "WAIT_FOR_OTHER_PERSON";
      this.playedAt = now;
    }
  }
  heard(now: number) {
    this.heardAt = now;
  }
  interrupted() {
    if (this.phase === "CLOSING" || this.phase === "WAIT_FOR_OTHER_PERSON") {
      this.phase = "CLOSING";
      this.audioPending = false;
      this.playedAt = 0;
    }
  }
  /** The member raised something new after the goodbye: carry on the conversation. */
  reopen() {
    this.phase = "DISCUSSION";
    this.closingAt = 0;
    this.playedAt = 0;
    this.audioPending = false;
    this.sawAudio = false;
  }
  /** The goodbye was already spoken before the end was requested: wait for its playback mark. */
  goodbyeAlreadySpoken() {
    if (this.phase === "CLOSING") {
      this.audioPending = true;
      this.sawAudio = true;
    }
  }
  shouldEnd(now: number) {
    if (!this.closingAt) return false;
    // Bound a failed voice/mark without ever treating it as playback confirmation.
    if (now - this.closingAt >= 15000) return true;
    // No goodbye audio at all within 4s: nothing to wait for, so don't leave them on dead air.
    if (this.phase === "CLOSING" && !this.sawAudio && now - this.closingAt >= 4000) return true;
    if (this.phase !== "WAIT_FOR_OTHER_PERSON") return false;
    return now - Math.max(this.playedAt, this.heardAt) >= 2000;
  }
}

/** True when a spoken line is a farewell (used so a call never says goodbye twice). */
export function isGoodbye(text: string): boolean {
  return /\b(good ?bye|bye( now)?|take care|speak (to you )?soon|talk (to you )?soon|have a (good|great|lovely|nice) (day|evening|night|one|week|weekend)|cheerio|see you)\b/i.test(
    text,
  );
}

/** A reply that only closes the conversation (no new question or request). */
export function isSimpleSignoff(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/[^a-z' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return true;
  if (/\?/.test(text)) return false;
  return /^((ok(ay)?|alright|right|yes|yeah|yep|great|perfect|cool|lovely|brilliant|cheers|thanks?( you)?( very much)?( so much)?|thank you|no that's (it|all|everything)|that's (it|all)|you too|and you|bye( bye)?( now)?|good ?bye|take care|see you|speak soon|talk soon|cheerio|ta)\s*)+$/.test(
    t,
  );
}
