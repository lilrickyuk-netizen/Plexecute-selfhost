import { describe, it, expect } from "vitest";
import {
  COACHING_STYLES,
  normalizeStyle,
  stylePrompt,
  styleViolations,
} from "../src/lib/coaching-style";
describe("coaching styles", () => {
  it("has exactly the five V3 styles", () =>
    expect([...COACHING_STYLES]).toEqual([
      "supportive",
      "direct",
      "disciplined",
      "calm",
      "competitive",
    ]));
  it("unknown style falls back to direct", () =>
    expect(normalizeStyle("analytical")).toBe("direct"));
  it("every style carries the same boundaries", () => {
    for (const s of COACHING_STYLES) expect(stylePrompt(s)).toMatch(/never use: insults/);
  });
  it("flags prohibited language", () => {
    expect(styleViolations("You're lazy, push through the pain")).toEqual(
      expect.arrayContaining(["insult", "unsafe_discipline"]),
    );
    expect(styleViolations("I'm so disappointed. You need me.")).toEqual(
      expect.arrayContaining(["fabricated_disappointment", "dependency"]),
    );
    expect(styleViolations("Nice work. Next: 30 min walk at 18:00.")).toEqual([]);
  });
});

import { plainMessage } from "../src/lib/coaching-style";
import { describe as d2, it as i2, expect as e2 } from "vitest";
d2("plainMessage", () => {
  i2("removes markdown so replies read like a message", () => {
    e2(
      plainMessage("adding **about 100 g of salmon** brings it to **400–550 calories**, roughly."),
    ).toBe("adding about 100 g of salmon brings it to 400–550 calories, roughly.");
    e2(plainMessage("## Plan\n- **Yogurt:** about 250 kcal\n- *Eggs* 300")).toBe(
      "Plan\n• Yogurt: about 250 kcal\n• Eggs 300",
    );
    e2(plainMessage("Use 2 * 3 sets")).toBe("Use 2 * 3 sets");
  });
});
