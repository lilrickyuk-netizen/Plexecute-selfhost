import { describe, it, expect } from "vitest";
import {
  storeProducts,
  appleAppSiteAssociation,
  assetLinks,
  healthPermissions,
  PRIVACY_DECLARATION,
  STORE_BILLING,
} from "../src/lib/platform";
import { PRODUCTS } from "../src/lib/billing";
import { HEALTH_CATEGORIES } from "../src/lib/health";
import manifest from "../public/manifest.webmanifest?raw";

describe("step 91 store readiness", () => {
  it("store products mirror locked prices", () => {
    const p = storeProducts();
    expect(p).toHaveLength(4);
    for (const x of p) expect(x.pence).toBe(PRODUCTS[x.tier][x.interval].pence);
  });
  it("deep-link files stay off until configured", () => {
    expect(appleAppSiteAssociation({})).toBeNull();
    expect(assetLinks({})).toBeNull();
    expect(
      appleAppSiteAssociation({ APPLE_TEAM_ID: "T", IOS_BUNDLE_ID: "b" })!.applinks.details[0]
        .appIDs[0],
    ).toBe("T.b");
    expect(
      assetLinks({ ANDROID_PACKAGE_NAME: "p", ANDROID_SHA256_CERT_FINGERPRINTS: "A, B" })![0].target
        .sha256_cert_fingerprints,
    ).toEqual(["A", "B"]);
  });
  it("health permissions are read-only and cover every category", () => {
    const h = healthPermissions();
    expect(h.map((x) => x.category)).toEqual([...HEALTH_CATEGORIES]);
    expect(h.every((x) => !x.write)).toBe(true);
  });
  it("no tracking, no store purchase grants a tier, manifest valid", () => {
    expect(PRIVACY_DECLARATION.tracking).toBe(false);
    expect(STORE_BILLING.storeIapEnabled).toBe(false);
    expect(JSON.parse(manifest).start_url).toBe("/app");
  });
});
