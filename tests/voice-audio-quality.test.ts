import { describe, it, expect } from "vitest";
import { createDownsampler24to8, resample } from "../src/lib/voice";

// A 5 kHz tone cannot exist on an 8 kHz phone line; a good downsampler removes it instead of folding it into audible hiss.
const tone = (hz: number, n: number) =>
  Int16Array.from({ length: n }, (_, i) =>
    Math.round(8000 * Math.sin((2 * Math.PI * hz * i) / 24000)),
  );
const rms = (p: Int16Array) => Math.sqrt(p.reduce((a, x) => a + x * x, 0) / p.length);
const chunks = (p: Int16Array, size: number) => {
  const out: Int16Array[] = [];
  for (let i = 0; i < p.length; i += size) out.push(p.subarray(i, i + size));
  return out;
};
const join = (a: Int16Array[]) => {
  const o = new Int16Array(a.reduce((n, x) => n + x.length, 0));
  let k = 0;
  for (const x of a) {
    o.set(x, k);
    k += x.length;
  }
  return o;
};

describe("call audio conversion", () => {
  it("removes out-of-band sound that the old converter folded into the call", () => {
    const hi = tone(5000, 24000);
    const down = createDownsampler24to8();
    const fresh = join(chunks(hi, 960).map(down)).subarray(100);
    const old = join(chunks(hi, 960).map((c) => resample(c, 24000, 8000))).subarray(100);
    expect(rms(fresh)).toBeLessThan(rms(old) / 10);
  });
  it("keeps speech-band sound at the same level and joins chunks without clicks", () => {
    const sp = tone(1000, 24000);
    const down = createDownsampler24to8();
    const odd = join(chunks(sp, 701).map(down)).subarray(100, 7900);
    const whole = createDownsampler24to8()(sp).subarray(100, 7900);
    expect(odd.length).toBe(whole.length);
    let maxDiff = 0;
    for (let i = 0; i < odd.length; i++) maxDiff = Math.max(maxDiff, Math.abs(odd[i]! - whole[i]!));
    expect(maxDiff).toBeLessThanOrEqual(1);
    expect(rms(odd)).toBeGreaterThan(rms(sp) * 0.9);
  });
});
