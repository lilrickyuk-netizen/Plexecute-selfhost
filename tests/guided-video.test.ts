import { describe, expect, it } from "vitest";
import {
  fitsDuration,
  parseWellnessIntent,
  rankChoices,
  reportsPainOrInjury,
  snapMinutes,
  type VideoCandidate,
} from "../src/lib/guided-video";

const v = (id: string, title: string, creator: string, min: number): VideoCandidate => ({
  videoId: id.padEnd(11, "x"),
  url: `https://www.youtube.com/watch?v=${id}`,
  title,
  creator,
  platform: "YouTube",
  seconds: min * 60,
  embeddable: true,
  verifiedAt: "2026-10-12T00:00:00Z",
});
const none = { avoidCreators: [], likedCreators: [], avoidVideos: [] };

describe("guided video matching", () => {
  const pool = [
    v("a", "15 Min Yoga for Lower Back Pain", "Yoga With Adriene", 16),
    v("b", "45 Minute Advanced Power Yoga Flow", "X", 45),
    v("c", "Back Stretches Yoga 15 min Beginner", "Mady Morrison", 14),
    v("d", "10 Minute Guided Meditation for Back", "Calm", 10),
    v("e", "Yoga for back and spine | 12 min", "Yoga with Kassandra", 12),
    v("f", "15 min HIIT back workout yoga", "Y", 15),
  ];
  it("returns only matching yoga of the right length", () => {
    const r = rankChoices(pool, { activity: "yoga", focus: "back", minutes: 15 }, none);
    expect(r.map((x) => x.videoId[0])).toEqual(expect.arrayContaining(["a", "c", "e"]));
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.seconds <= 19 * 60)).toBe(true);
  });
  it("never returns a video longer than the time available", () => {
    expect(fitsDuration(30 * 60, 15)).toBe(false);
    expect(fitsDuration(10 * 60, 10)).toBe(true);
  });
  it("respects not-for-me feedback", () => {
    const r = rankChoices(
      pool,
      { activity: "yoga", focus: "back", minutes: 15 },
      { ...none, avoidVideos: [pool[0]!.videoId] },
    );
    expect(r.some((x) => x.videoId === pool[0]!.videoId)).toBe(false);
  });
  it("reads plan and coach phrases", () => {
    expect(parseWellnessIntent("Yoga: Back · 15 min")).toEqual({
      activity: "yoga",
      focus: "back",
      minutes: 15,
    });
    expect(parseWellnessIntent("10-minute meditation to relax")).toMatchObject({
      activity: "meditation",
      minutes: 10,
      focus: "relaxation",
    });
    expect(snapMinutes("meditation", 4)).toBe(3);
  });
  it("flags injury language", () => {
    expect(reportsPainOrInjury("I had back surgery last month")).toBe(true);
    expect(reportsPainOrInjury("my back is a bit stiff")).toBe(false);
  });
});
