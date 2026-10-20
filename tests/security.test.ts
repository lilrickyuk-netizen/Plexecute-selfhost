import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { bearerMatches, imageMatchesType, isAllowedOutbound, safeEqual } from "@/lib/security";

describe("security primitives", () => {
  it("constant-time compare", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
    expect(bearerMatches("Bearer s3cret", undefined)).toBe(false);
  });
  it("blocks SSRF targets", () => {
    expect(isAllowedOutbound("https://api.stripe.com/v1/x")).toBe(true);
    for (const u of [
      "http://api.stripe.com/",
      "https://169.254.169.254/",
      "https://localhost/",
      "https://api.stripe.com.evil.io/",
      "https://u:p@api.stripe.com/",
      "https://api.stripe.com:8443/",
      "file:///etc/passwd",
    ])
      expect(isAllowedOutbound(u)).toBe(false);
  });
  it("upload type must match bytes", () => {
    const png =
      "data:image/png;base64," + btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10));
    expect(imageMatchesType(png)).toBe(true);
    expect(imageMatchesType(png.replace("png", "jpeg"))).toBe(false);
    expect(imageMatchesType("data:image/png;base64," + btoa("<svg onload=x>"))).toBe(false);
  });
  it("public routes all authenticate", () => {
    for (const f of readdirSync("src/routes/api/public")) {
      const s = readFileSync(`src/routes/api/public/${f}`, "utf8");
      expect(s, f).toMatch(
        /verify|bearerMatches|safeEqual|getUser|hashToken|Unauthorized|connectionFor|state|calendar_token|HMAC|authenticateCronRequest/i,
      );
    }
  });
});
