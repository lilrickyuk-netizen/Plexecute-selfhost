// Deterministic extraction of recurring life boundaries the member states in plain words, so planning never
// depends on the model remembering to save them. Only explicit phrases; anything unclear is left to Coach.
export type Boundary = {
  title: string;
  kind: "family" | "shift";
  days: number[];
  start_time: string;
  end_time: string;
};

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function clock(h: string, mi: string | undefined, ap: string | undefined): number | null {
  let H = Number(h);
  const M = Number(mi ?? 0);
  if (ap?.toLowerCase() === "pm" && H < 12) H += 12;
  if (ap?.toLowerCase() === "am" && H === 12) H = 0;
  if (!ap && H >= 1 && H <= 7) H += 12; // "bedtime is 7:30" means evening
  return H < 24 && M < 60 ? H * 60 + M : null;
}

export function extractBoundaries(text: string): Boundary[] {
  const t = text.toLowerCase();
  const out: Boundary[] = [];
  if (
    /\bweekends? (are|is) (for )?(family|my family|kids)|family (time )?(at|on) (the )?weekends?|weekends? with (my )?(family|kids)/.test(
      t,
    )
  )
    out.push({
      title: "Weekend family time",
      kind: "family",
      days: [6, 7],
      start_time: "00:00",
      end_time: "23:59",
    });
  const w =
    /\b(?:i )?work (\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?: on)? (weekdays|monday to friday|mon-fri|mon to fri)/.exec(
      t,
    );
  if (w) {
    let a = Number(w[1]) * 60 + Number(w[2] ?? 0);
    let b = Number(w[4]) * 60 + Number(w[5] ?? 0);
    if (w[3] === "pm" && a < 720) a += 720;
    if ((w[6] === "pm" || (!w[6] && b <= a)) && b < 720) b += 720;
    if (b > a)
      out.push({
        title: "Work",
        kind: "shift",
        days: [1, 2, 3, 4, 5],
        start_time: hhmm(a),
        end_time: hhmm(b),
      });
  }
  const bt =
    /\b(?:kids'?|children'?s|son'?s|daughter'?s|child'?s)\s+bedtime (?:is )?(?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(
      t,
    );
  if (bt) {
    const m = clock(bt[1]!, bt[2], bt[3]);
    if (m != null && m > 15 * 60)
      out.push({
        title: "Children's evening and bedtime routine",
        kind: "family",
        days: [1, 2, 3, 4, 5, 6, 7],
        start_time: hhmm(m - 120),
        end_time: hhmm(Math.min(1439, m + 15)),
      });
  }
  return out;
}

const DAY: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
  sat: 6,
  sun: 7,
};

/** Days/part of day the member offers FOR a goal ("6 hours a week on Monday, Wednesday and Thursday evenings"). */
export function extractAvailability(
  text: string,
): { days: number[]; part: "morning" | "evening" | null; weeklyMinutes?: number } | null {
  const t = text.toLowerCase();
  const m =
    /\b(?:have|got|can do|free|available)\b[^.]*?\bon ((?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*(?:,\s*|\s+and\s+|\s*&\s*|\s+)?)+)(mornings?|evenings?|nights?)?/.exec(
      t,
    );
  if (!m) return null;
  const days = [...m[1]!.matchAll(/(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*/g)]
    .map((x) => DAY[x[0]] ?? DAY[x[1]!])
    .filter((d): d is number => !!d);
  if (!days.length) return null;
  const part = m[2] ? (/morning/.test(m[2]) ? "morning" : "evening") : null;
  const hrs = /(\d+(?:\.\d+)?)\s*hours? (?:a|per) week/.exec(t);
  return {
    days: [...new Set(days)].sort(),
    part,
    ...(hrs ? { weeklyMinutes: Math.round(Number(hrs[1]) * 60) } : {}),
  };
}
