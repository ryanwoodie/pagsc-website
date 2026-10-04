// Small wrapper around GoatCounter events. Does nothing if GoatCounter has not loaded
// (blocked, offline, local preview). Event names read like paths in the GoatCounter dashboard.
type GC = { count?: (o: { path: string; title?: string; event: boolean }) => void };

export function track(path: string, title = location.pathname) {
  try {
    (window as unknown as { goatcounter?: GC }).goatcounter?.count?.({ path, title, event: true });
  } catch {
    /* analytics must never break the page */
  }
}

/** Count clicks on any Wave checkout link: buy/single or buy/group, titled with the page. */
export function trackBuyClicks() {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href*="link.waveapps.com"]') as HTMLAnchorElement | null;
    if (!a) return;
    track(a.href.includes('398m3y') ? 'buy/group' : 'buy/single', `${location.pathname} · ${a.textContent?.trim() ?? ''}`);
  });
}
