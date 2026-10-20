// Plexecute Coach prompts. Notification-only worker: it caches nothing and never serves pages.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (_) {
    d = { title: "Plexecute", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || "Plexecute", {
      body: d.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: d.id || undefined,
      data: { link: d.link || "/app/today", id: d.id || null },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/app/today";
  let url;
  try {
    url = new URL(link, self.location.origin);
    if (url.origin !== self.location.origin || !url.pathname.startsWith("/app"))
      url = new URL("/app/today", self.location.origin);
  } catch {
    url = new URL("/app/today", self.location.origin);
  }
  if (event.notification.data && event.notification.data.id)
    url.searchParams.set("n", event.notification.data.id);
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          await w.navigate(url.href);
          return w.focus();
        }
      }
      return self.clients.openWindow(url.href);
    })(),
  );
});
