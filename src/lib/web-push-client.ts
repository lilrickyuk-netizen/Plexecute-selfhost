// Browser side of Coach prompts: subscribe this browser so prompts arrive with Plexecute closed.
export type EnableResult =
  | { status: "registered"; token: string }
  | {
      status:
        "unsupported" | "open-in-new-tab" | "denied" | "not-configured" | "home-screen-required";
    };

export async function requestPushPermission(): Promise<EnableResult["status"] | "granted"> {
  if (window.top !== window.self) return "open-in-new-tab";
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return "home-screen-required";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return "unsupported";
  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  return permission === "granted" ? "granted" : "denied";
}

export async function inspectPushDevice() {
  const supported = "serviceWorker" in navigator && "PushManager" in window;
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  const reg = supported ? await navigator.serviceWorker.getRegistration("/") : undefined;
  const workerActive = reg?.active?.scriptURL.endsWith("/push-sw.js") === true;
  const sub = workerActive ? await reg?.pushManager.getSubscription() : null;
  return {
    permission,
    workerActive,
    subscribed: !!sub,
    token: sub ? JSON.stringify(sub.toJSON()) : null,
  };
}

function keyBytes(b64u: string): Uint8Array {
  const t = b64u.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Call from a button press: browsers only ask for permission after a tap. */
export async function enableWebPush(publicKey: string | null): Promise<EnableResult> {
  if (!publicKey) return { status: "not-configured" };
  const permission = await requestPushPermission();
  if (permission !== "granted")
    return { status: permission === "registered" ? "unsupported" : permission };
  const reg = await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub)
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey) as BufferSource,
    });
  return { status: "registered", token: JSON.stringify(sub.toJSON()) };
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua)
    ? "iPhone"
    : /Android/.test(ua)
      ? "Android"
      : /Mac/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : "Browser";
  const br = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";
  return `${os}${br ? ` · ${br}` : ""}`.slice(0, 80);
}
