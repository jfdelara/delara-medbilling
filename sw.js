/* MedBilling Fee Desk is now an app only. This service worker replaces the old offline web app:
   it deletes the old offline copy and unregisters itself, so the next visit loads the "Get the app" page. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) { try { c.navigate(c.url); } catch (x) { /* ignore */ } }
  })());
});
