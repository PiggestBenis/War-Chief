/* War Chief's stock counter, for a seller's own website (Matt, 2026-10-04 20:47Z: "a generic stock
 * inventory counter … you slap that on your site, it tracks real number live").
 *
 * The Shelf of the War Chief program gives each product its tag. Paste the tag where the count
 * should show, and this script once anywhere on the page:
 *
 *   <span data-warchief="SHOPKEY:product-id">in stock</span>
 *   <script src="https://ironroots.us/warchief-stock.js" async></script>
 *
 * The number appears inside the tag: what the seller's desk last published for that product, less
 * the payments PayPal confirmed that the desk has not booked yet, read again every minute while the
 * page is in view. On a tag:
 *   data-show="price"                 the price instead of the count
 *   data-warchief-hide="#buy-button"  hides what that selector names while the count is 0
 * Text written inside a tag stays when the count cannot be read, and then nothing is hidden: a page
 * the counter cannot reach sells as the page was written, rather than selling nothing. Each tag
 * also gets data-warchief-state "in", "out" or "unknown", for a page's own styles.
 *
 * It asks one public question per shop (the database function warchief_counts), which answers only
 * the products that shop put on its site: their names, prices and counts. It sends nothing about
 * the page or its visitor beyond what any web request carries, and keeps nothing.
 */
(() => {
  'use strict';
  const API = 'https://oilygfntezdgbasylfaq.supabase.co/rest/v1/rpc/warchief_counts';
  const KEY = 'sb_publishable_qyDodreVm1-XZRohSEdPZA_C80AeyOl'; // Iron Roots' public key: it reaches only what the database lets anyone read
  const EVERY = 60000;
  const TAG = /^([0-9a-f]{20}):([a-z0-9][a-z0-9-]{0,63})$/;
  const own = new WeakMap();    // each tag's own text, shown when a count cannot be read
  const hidden = new WeakMap(); // what this script hid, and the display it had before
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  const ask = async (shop) => {
    const r = await fetch(API + '?p_shop=' + shop, { headers: { apikey: KEY, accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) throw new Error('the counts answered ' + r.status);
    const rows = await r.json();
    return new Map((Array.isArray(rows) ? rows : []).map((x) => [x.product, x]));
  };
  const hide = (selector, out) => {
    if (!selector) return;
    let list;
    try { list = document.querySelectorAll(selector); } catch { return; }
    for (const x of list) {
      if (out && !hidden.has(x)) { hidden.set(x, x.style.display); x.style.display = 'none'; }
      else if (!out && hidden.has(x)) { x.style.display = hidden.get(x); hidden.delete(x); }
    }
  };
  const paint = (el, row) => {
    if (!own.has(el)) own.set(el, el.textContent);
    const selector = el.getAttribute('data-warchief-hide');
    if (!row) {
      el.textContent = own.get(el);
      el.setAttribute('data-warchief-state', 'unknown');
      hide(selector, false);
      return;
    }
    const n = Math.max(0, Math.floor(Number(row.available) || 0));
    const price = row.price === null || row.price === undefined || row.price === '' ? null : Number(row.price);
    el.textContent = el.getAttribute('data-show') === 'price' ? (Number.isFinite(price) ? usd.format(price) : own.get(el)) : String(n);
    el.setAttribute('data-warchief-state', n > 0 ? 'in' : 'out');
    hide(selector, n === 0);
  };
  const run = async () => {
    const shops = new Map();
    for (const el of document.querySelectorAll('[data-warchief]')) {
      const m = TAG.exec(String(el.getAttribute('data-warchief') || '').trim());
      if (!m) continue;
      if (!shops.has(m[1])) shops.set(m[1], []);
      shops.get(m[1]).push([el, m[2]]);
    }
    await Promise.all([...shops].map(async ([shop, tags]) => {
      let rows = null;
      try { rows = await ask(shop); } catch { rows = null; }
      for (const [el, product] of tags) paint(el, rows && rows.get(product));
    }));
  };
  const start = () => {
    run();
    setInterval(() => { if (document.visibilityState !== 'hidden') run(); }, EVERY);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
