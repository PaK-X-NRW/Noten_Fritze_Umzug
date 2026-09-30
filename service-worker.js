/* =========================================================================
   service-worker.js – löst den Service Worker der alten App ab
   Die alte App liefert sich cache-first aus dem Offline-Cache aus und würde
   ohne diesen Ersatz weiterlaufen. Sie prüft aber bei jedem Start per
   reg.update(), ob sich service-worker.js geändert hat. Dieser Ersatz:
     1. übernimmt sofort (skipWaiting + clients.claim),
     2. löscht den Offline-Cache der alten App,
     3. lädt offene Fenster neu – sie zeigen dann die Umzugsseite,
     4. meldet sich ab. Ohne fetch-Handler kommt alles direkt vom Server.
   Die Nutzdaten in IndexedDB bleiben unberührt.
   ========================================================================= */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((fenster) => Promise.all(fenster.map((f) => f.navigate(f.url).catch(() => null))))
      .then(() => self.registration.unregister())
  );
});
