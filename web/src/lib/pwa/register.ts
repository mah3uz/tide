export function registerServiceWorker(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  if (location.pathname.startsWith('/egress-template')) return;
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}
