// Timing and live progress for one Coach turn. Pure rules (no I/O) so they can be tested.
// The live site ends any single request at about 2 minutes, even while progress is streaming
// (observed 17 Oct: research still reading at 124s was cancelled and no reply was saved).
// So every turn must save its reply inside that window; these limits are sized to it.

/** Observed hard limit on one request on the live site. Nothing in a turn may run past it. */
export const PLATFORM_REQUEST_LIMIT_MS = 120_000;
/** After this long Coach stops calling tools and writes its reply from what it already has. */
export const COACH_REPLY_BY_MS = 85_000;
/** No new live web research starts after this point (one research run takes ~40-60s). */
export const COACH_RESEARCH_CUTOFF_MS = 40_000;
/** A research second pass (extra searches + re-read, ~40s) starts only while it can finish in time. */
export const COACH_RESEARCH_RETRY_BY_MS = 50_000;
/** Any research reading call in a chat turn is stopped here so the reply can still be written. */
export const RESEARCH_READ_DEADLINE_MS = 95_000;
/** Any Coach model call is stopped here so a reply is always saved before the request ends. */
export const COACH_CALL_DEADLINE_MS = 112_000;
/** How often the chat is told what Coach is doing; also keeps mobile connections from idling out. */
export const PROGRESS_EVERY_MS = 3_000;
/** The chat treats the connection as lost when no progress arrives for this long. */
export const PROGRESS_SILENCE_MS = 20_000;

export function turnPhase(elapsedMs: number) {
  return {
    mustReply: elapsedMs >= COACH_REPLY_BY_MS,
    researchAllowed: elapsedMs < COACH_RESEARCH_CUTOFF_MS,
  };
}

/** Whether research may run its second pass. Research outside chat keeps full retries. */
export function researchRetryAllowed(
  turnStarted: number | undefined,
  now: number,
  employerDemand: boolean,
): boolean {
  if (turnStarted === undefined) return true;
  // Employer checks keep their extra pass only while it can still finish inside the request.
  return (
    now - turnStarted <
    (employerDemand ? COACH_RESEARCH_RETRY_BY_MS + 10_000 : COACH_RESEARCH_RETRY_BY_MS)
  );
}

/** Milliseconds left before `deadlineMs` into the turn (minimum 1s), or undefined outside chat. */
export function msLeft(turnStarted: number | undefined, deadlineMs: number, now = Date.now()) {
  if (turnStarted === undefined) return undefined;
  return Math.max(1_000, turnStarted + deadlineMs - now);
}

export const STAGE_START = "Reading your message";
export const STAGE_THINKING = "Thinking it through with your plan and Plexecute's knowledge";

/** Plain-words label for what Coach is doing, from the tools it is running this step. */
export function stageFor(tools: string[]): string {
  const has = (re: RegExp) => tools.some((t) => re.test(t));
  if (has(/^research_topic$/)) return "Checking current sources online";
  if (has(/^get_research_findings$/)) return "Reading what the sources say";
  if (has(/knowledge/)) return "Checking Plexecute's coaching knowledge";
  if (has(/appointment|checkout/)) return "Sorting out the booking";
  if (has(/mission|pathway|propose_new_goal|update_goal|milestone/)) return "Building your plan";
  if (has(/schedule|replan|edit_plan|commitment|meals|queue|triage/))
    return "Putting it on your plan";
  if (has(/workout|training|cardio|mobility|exercise/)) return "Building your training";
  if (has(/meal|food|nutrition|energy/)) return "Working out your nutrition";
  if (has(/learning/)) return "Setting up your learning";
  if (has(/^get_|^list_|brief|review|life_intelligence|life_twin/))
    return "Reading your plan and history";
  return STAGE_THINKING;
}

export type CoachProgressEvent<R> =
  | { type: "progress"; stage: string; seconds: number }
  | { type: "result"; result: R }
  | { type: "error" };

/** Streams the current stage every few seconds, then the final result, so long turns never look frozen. */
export function progressStream<R>(
  run: Promise<R>,
  currentStage: () => string,
  everyMs = PROGRESS_EVERY_MS,
): ReadableStream<CoachProgressEvent<R>> {
  const started = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  return new ReadableStream<CoachProgressEvent<R>>({
    start(controller) {
      const send = (e: CoachProgressEvent<R>) => {
        try {
          controller.enqueue(e);
        } catch {
          /* reader gone; the turn still finishes and saves its reply */
        }
      };
      const tick = () =>
        send({
          type: "progress",
          stage: currentStage(),
          seconds: Math.round((Date.now() - started) / 1000),
        });
      tick();
      timer = setInterval(tick, everyMs);
      run.then(
        (result) => {
          clearInterval(timer);
          send({ type: "result", result });
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
        () => {
          clearInterval(timer);
          send({ type: "error" });
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
      );
    },
    cancel() {
      clearInterval(timer);
    },
  });
}
