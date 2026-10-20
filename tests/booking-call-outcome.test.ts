import { describe, expect, it } from "vitest";
import { parseTranscriptVerdict } from "@/lib/appointments";

describe("end-of-call booking check", () => {
  it("a clear yes with date and time confirms", () => {
    expect(
      parseTranscriptVerdict(
        '{"confirmed":true,"date":"2026-10-16","start":"22:00","reference":null}',
      ),
    ).toEqual({ date: "2026-10-16", start: "22:00", reference: null });
  });
  it("no yes, or a missing/invalid time, never confirms", () => {
    expect(parseTranscriptVerdict('{"confirmed":false,"date":"2026-10-16","start":"22:00"}')).toBe(
      null,
    );
    expect(parseTranscriptVerdict('{"confirmed":true,"date":"tonight","start":"22:00"}')).toBe(
      null,
    );
    expect(parseTranscriptVerdict('{"confirmed":true,"date":"2026-10-16","start":null}')).toBe(
      null,
    );
    expect(parseTranscriptVerdict("not json")).toBe(null);
  });
});
