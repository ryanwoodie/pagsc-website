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

/** Count clicks on any Stripe checkout link: buy/single or buy/group, titled with the page. */
export function trackBuyClicks() {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href*="buy.stripe.com"]') as HTMLAnchorElement | null;
    if (!a) return;
    track(a.href.includes('7sY7sKdirdDC5dU9m0bV601') ? 'buy/group' : 'buy/single', `${location.pathname} · ${a.textContent?.trim() ?? ''}`);
  });
}

// Google Ads conversion events (Ad Grants account AW-18512596409). The base tag is
// installed in Base.astro. Like the GoatCounter wrapper above, a blocked or missing
// gtag must never break the page.
type Gtag = (...args: unknown[]) => void;

function gtag(...args: unknown[]) {
  try {
    (window as unknown as { gtag?: Gtag }).gtag?.(...args);
  } catch {
    /* analytics must never break the page */
  }
}

/** Fire when a booking request succeeds in the calendar (BookingCalendar.astro). */
export function adsBooking() {
  gtag('event', 'conversion', { send_to: 'AW-18512596409/6sU_CIqy4pwdELmbv_tE' });
}

/** Fire on the paid page once Stripe payment is confirmed and certificates are issued. */
export function adsPurchase(transactionId: string, value: number) {
  gtag('event', 'conversion', {
    send_to: 'AW-18512596409/vWIFCI2y4pwdELmbv_tE',
    value,
    currency: 'CAD',
    transaction_id: transactionId,
  });
}
