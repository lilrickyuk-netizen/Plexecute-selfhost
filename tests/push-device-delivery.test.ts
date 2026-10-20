import { afterEach, describe, expect, it, vi } from "vitest";
import { sendWebDevices } from "@/lib/notify.server";
import { requestPushPermission } from "@/lib/web-push-client";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/webpush.server", () => ({ sendWebPush: send }));
const n = { id: "notice", user_id: "member", title: "Task", body: null, link: "/app/session/task" };
const device = (id: string) => ({
  id,
  token: JSON.stringify({
    endpoint: `https://push.example/${id}`,
    keys: { p256dh: "key", auth: "key" },
  }),
});
const changes: unknown[] = [];
const db = {
  from: () => ({
    update: (v: unknown) => {
      changes.push(v);
      return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    },
  }),
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  changes.length = 0;
});

describe("real device registration and delivery boundaries", () => {
  it("requests iPhone permission synchronously on the tap before server work", async () => {
    const request = vi.fn().mockResolvedValue("granted");
    const win = { PushManager: {}, Notification: {}, matchMedia: () => ({ matches: true }) };
    Object.assign(win, { top: win, self: win });
    vi.stubGlobal("window", win);
    vi.stubGlobal("navigator", { userAgent: "iPhone", serviceWorker: {} });
    vi.stubGlobal("Notification", { permission: "default", requestPermission: request });
    const result = requestPushPermission();
    expect(request).toHaveBeenCalledTimes(1);
    expect(await result).toBe("granted");
  });
  it("requires Home Screen installation on iPhone", async () => {
    const win = { matchMedia: () => ({ matches: false }) };
    Object.assign(win, { top: win, self: win });
    vi.stubGlobal("window", win);
    vi.stubGlobal("navigator", { userAgent: "iPhone" });
    expect(await requestPushPermission()).toBe("home-screen-required");
  });
  it("logs mixed device outcomes and retries only the failed endpoint", async () => {
    send
      .mockResolvedValueOnce({ ok: true, status: 201, gone: false })
      .mockResolvedValueOnce({ ok: false, status: 503, gone: false });
    const first = await sendWebDevices(db as never, n, [device("phone"), device("other")]);
    expect(first.ok).toBe(false);
    const outcomes = first.result?.["devices"] as Array<{
      id: string;
      ok: boolean;
      status: number | null;
    }>;
    expect(outcomes).toMatchObject([
      { id: "phone", ok: true },
      { id: "other", ok: false, status: 503 },
    ]);
    send.mockResolvedValueOnce({ ok: true, status: 201, gone: false });
    expect(
      (await sendWebDevices(db as never, n, [device("phone"), device("other")], outcomes)).ok,
    ).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
  });
  it("retires an expired subscription rather than retrying it", async () => {
    send.mockResolvedValue({ ok: false, status: 410, gone: true });
    const result = await sendWebDevices(db as never, n, [device("expired")]);
    expect(result.ok).toBe(false);
    expect(changes).toContainEqual({ status: "invalid" });
  });
});
