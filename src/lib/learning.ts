// V3 §51 Learning Engine: deterministic spaced review. Pure.
export const LEARNING_POLICY_VERSION = "learning_review_v1";
/** Initial review schedule from V3 §51 (days). */
export const REVIEW_INTERVALS = [1, 3, 7, 14, 30] as const;

/** Success advances one step; failure reduces the next interval by one step. Step index is 0-based. */
export function nextReview(step: number, correct: boolean) {
  const max = REVIEW_INTERVALS.length - 1;
  const cur = Math.max(0, Math.min(max, step));
  const toStep = correct ? Math.min(max, cur + 1) : Math.max(0, cur - 1);
  return { toStep, days: REVIEW_INTERVALS[toStep]! };
}

/** Topic progress across a syllabus tree (leaf topics count). */
export function syllabusProgress(
  topics: { id: string; parent_id: string | null; done_at: string | null }[],
) {
  const parents = new Set(topics.map((t) => t.parent_id).filter(Boolean));
  const leaves = topics.filter((t) => !parents.has(t.id));
  const done = leaves.filter((t) => t.done_at).length;
  return {
    done,
    total: leaves.length,
    pct: leaves.length ? Math.round((done / leaves.length) * 100) : 0,
  };
}
