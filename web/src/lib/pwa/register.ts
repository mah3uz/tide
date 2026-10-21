export function registerServiceWorker(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  if (location.pathname.startsWith('/egress-template')) return;
  const register = () => navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  // The first install precaches the whole app; keep it off the join path.
  const idle = () => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(register, { timeout: 10_000 });
    else setTimeout(register, 3000);
  };
  if (document.readyState === 'complete') idle();
  else addEventListener('load', idle, { once: true });
}
