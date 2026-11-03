// Service worker for Web Push. It only shows alerts and opens the CRM on a
// tap; it caches nothing, so it never serves a stale page.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Nova mensagem", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Nova mensagem";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      // Same tag as the in-page notification, so the two replace each other
      // instead of stacking when the CRM is open.
      tag: data.tag || "wacrm-message",
      icon: "/pwa-icon?size=192",
      badge: "/icon",
      data: { url: data.url || "/inbox" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/inbox";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
