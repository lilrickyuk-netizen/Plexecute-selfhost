import { describe, expect, it } from "vitest";
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  applyPromptChange,
  kindAllowed,
  pushCopy,
  pushKindForBlock,
  pushKindForCommitment,
  pushLink,
  stillValid,
} from "@/lib/push-plan";
import { dueStage } from "@/lib/push-schedule.server";
import { b64u, encryptPayload } from "@/lib/webpush.server";

const at = (hm: string) => new Date(`2026-10-19T${hm}:00Z`);

describe("Coach prompt timing (smart defaults)", () => {
  it("wake fires at wake time only, never early", () => {
    expect(dueStage("wake", at("07:00"), at("06:55"), 10)).toBe(null);
    expect(dueStage("wake", at("07:00"), at("07:00"), 10)).toBe("start");
  });
  it("workout warns 10 minutes before and prompts at start", () => {
    expect(dueStage("workout", at("18:00"), at("17:50"), 10)).toBe("prepare");
    expect(dueStage("workout", at("18:00"), at("18:00"), 10)).toBe("start");
    expect(dueStage("workout", at("18:00"), at("18:12"), 10)).toBe(null);
  });
  it("member lead of 15 minutes moves the warning", () => {
    expect(dueStage("learning", at("20:00"), at("19:45"), 15)).toBe("prepare");
    expect(dueStage("learning", at("20:00"), at("19:44"), 15)).toBe(null);
  });
  it("meals prompt only at meal time", () => {
    expect(dueStage("meal", at("07:30"), at("07:20"), 10)).toBe(null);
    expect(dueStage("meal", at("07:30"), at("07:30"), 10)).toBe("start");
  });
});

describe("contextual copy and destinations", () => {
  it("meal prompt names the planned meal", () => {
    const c = pushCopy("meal", "start", {
      title: "Greek yoghurt with berries",
      time: "07:30",
      minutes: 0,
    });
    expect(c.title).toBe("Breakfast time");
    expect(c.body).toContain("Greek yoghurt with berries");
  });
  it("learning prompt names the real subject", () => {
    const c = pushCopy("learning", "prepare", {
      title: "Organic marketing session",
      time: "20:00",
      minutes: 10,
    });
    expect(c.title).toBe("Organic marketing session starts at 20:00");
  });
  it.each(["task", "workout", "meal", "learning"] as const)(
    "%s notification opens the exact plan item",
    (kind) => expect(pushLink(kind, { blockId: "b1" })).toBe("/app/session/b1"),
  );
  it.each(["task", "workout", "meal", "learning", "appointment", "family"] as const)(
    "%s commitment notification opens the exact saved commitment",
    (kind) => expect(pushLink(kind, { commitmentId: "c1" })).toBe("/app/commitments?item=c1"),
  );
  it("kinds are recognised from saved plan state", () => {
    expect(pushKindForBlock({ occurrence_kind: "wake_for_work" })).toBe("wake");
    expect(pushKindForBlock({ occurrence_kind: "learning" })).toBe("learning");
    expect(pushKindForCommitment({ kind: "other", note: "Meal from nutrition plan" })).toBe("meal");
    expect(pushKindForCommitment({ kind: "appointment" })).toBe("appointment");
  });
});

describe("no stale prompts", () => {
  const now = at("18:00");
  it("moved session (different time) is not sent", () => {
    expect(
      stillValid(
        { at: at("18:00").toISOString() },
        { starts_at: at("19:00").toISOString(), status: "planned" },
        now,
      ),
    ).toBe(false);
  });
  it("completed or started session is not sent", () => {
    expect(
      stillValid(
        { at: at("18:00").toISOString() },
        { starts_at: at("18:00").toISOString(), status: "done" },
        now,
      ),
    ).toBe(false);
    expect(
      stillValid(
        { at: at("18:00").toISOString() },
        { starts_at: at("18:00").toISOString(), status: "started" },
        now,
      ),
    ).toBe(false);
  });
  it("deleted session is not sent", () => {
    expect(stillValid({ at: at("18:00").toISOString() }, null, now)).toBe(false);
  });
  it("unchanged session is sent", () => {
    expect(
      stillValid(
        { at: at("18:00").toISOString() },
        { starts_at: at("18:00").toISOString(), status: "due" },
        now,
      ),
    ).toBe(true);
  });
});

describe("Coach changes the same settings", () => {
  it("'stop meal notifications' mutes meals; muted kinds get nothing", () => {
    const r = applyPromptChange({ push_muted_kinds: [] }, { mute: ["meal"] });
    expect("patch" in r && r.patch["push_muted_kinds"]).toEqual(["meal"]);
    expect(kindAllowed("meal", ["meal"])).toBe(false);
  });
  it("'remind me 15 minutes before workouts' and 'not after 10pm'", () => {
    const r = applyPromptChange({}, { lead_minutes: 15, quiet_start: "22:00", quiet_end: "07:00" });
    expect("patch" in r && r.patch).toEqual({
      reminder_lead_min: 15,
      quiet_start: "22:00",
      quiet_end: "07:00",
    });
  });
});

describe("browser push encryption (RFC 8291)", () => {
  it("the receiving browser can decrypt the payload", async () => {
    const uaPriv = p256.utils.randomSecretKey();
    const uaPub = p256.getPublicKey(uaPriv, false);
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const body = await encryptPayload(
      { endpoint: "https://push.example/x", keys: { p256dh: b64u(uaPub), auth: b64u(auth) } },
      new TextEncoder().encode('{"title":"Time to train"}'),
    );
    const salt = body.slice(0, 16);
    const asPub = body.slice(21, 86);
    const ct = body.slice(86);
    const shared = p256.getSharedSecret(uaPriv, asPub).slice(1);
    const info = new Uint8Array([
      ...new TextEncoder().encode("WebPush: info\0"),
      ...uaPub,
      ...asPub,
    ]);
    const ikm = hkdf(sha256, shared, auth, info, 32);
    const cek = hkdf(
      sha256,
      ikm,
      salt,
      new TextEncoder().encode("Content-Encoding: aes128gcm\0"),
      16,
    );
    const nonce = hkdf(
      sha256,
      ikm,
      salt,
      new TextEncoder().encode("Content-Encoding: nonce\0"),
      12,
    );
    const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
    const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct));
    expect(new TextDecoder().decode(pt.slice(0, -1))).toBe('{"title":"Time to train"}');
    expect(pt[pt.length - 1]).toBe(2);
  });
});

import { stagesToQueue } from "@/lib/push-schedule.server";
describe("exact-time prompt queueing", () => {
  const at = (hm: string) => new Date(`2026-10-16T${hm}:00Z`);
  const L = 3 * 60000;
  it("queues a 07:00 wake for exactly 07:00, ahead of time", () => {
    expect(stagesToQueue("wake", at("07:00"), at("06:58"), 10, L)).toEqual([
      { stage: "start", sendAt: at("07:00") },
    ]);
  });
  it("queues an 18:00 workout warning for 17:50 and its start for 18:00", () => {
    expect(stagesToQueue("workout", at("18:00"), at("17:48"), 10, L)).toEqual([
      { stage: "prepare", sendAt: at("17:50") },
    ]);
    expect(stagesToQueue("workout", at("18:00"), at("17:58"), 10, L)).toContainEqual({
      stage: "start",
      sendAt: at("18:00"),
    });
  });
  it("queues a 20:00 learning start for exactly 20:00", () => {
    expect(stagesToQueue("learning", at("20:00"), at("19:57"), 15, L)).toContainEqual({
      stage: "start",
      sendAt: at("20:00"),
    });
  });
  it("nothing far ahead; late recovery sends immediately, never after the window", () => {
    expect(stagesToQueue("wake", at("07:00"), at("06:50"), 10, L)).toEqual([]);
    expect(stagesToQueue("wake", at("07:00"), at("07:04"), 10, L)).toEqual([
      { stage: "start", sendAt: at("07:04") },
    ]);
    expect(stagesToQueue("wake", at("07:00"), at("07:11"), 10, L)).toEqual([]);
  });
});
