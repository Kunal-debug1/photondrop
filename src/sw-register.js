if ('serviceWorker' in navigator) window.addEventListener('load', async () => {
  // Vite's dev server needs live module/HMR requests; do not serve cached development modules.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
    for (const key of await caches.keys()) if (key.startsWith('photondrop-')) await caches.delete(key);
    return;
  }
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
});
