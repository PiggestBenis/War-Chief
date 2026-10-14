// SITE — the person's own website, wired to the desk. Matt, 2026-10-04 20:47Z: "a generic stock
// inventory counter … you slap that on your site, it tracks real number live", "receive a payment
// it deducts it from shelf and a little alert shows up (one payment ready to ship!)" and
// "Successful payment subtracts from shelf moves one thing to be shipped with an alert".
//
// Inside the program only. The program holds the sign-in and speaks for the desk to the Iron Roots
// account (warchief-desktop/main.js: GET and POST /_/site, POST /_/stock, /_/inbox/taken and
// /_/alert, and window.deskInbox for the payments PayPal confirmed). A desk opened in a browser has
// no sign-in to hold, and the Shelf says so.
//   · after each save the desk publishes how many of each product the person put on their site can
//     still be sold (verbs.siteCounts), so the counter on their page follows the Shelf
//   · each payment PayPal confirmed is booked in one act (verbs.takePayment / takeRefund); only once
//     the books are saved (on this computer, or in the cloud) is the program told the notice is taken
//   · a payment with a line the desk cannot tie to a product waits at the top of Orders for one
//     pick, and the desk keeps that pick for the same PayPal name next time
//   · a payment that paid less than the Shelf's prices waits there too, booked only by a person
//     (verbs.shortPayment): Matt, 2026-10-05 01:35Z, "Don't want nobody getting free shit!"
import * as V from './verbs.mjs';
import { readIpn } from './files.mjs';
import { cell, copyText } from './ui.mjs';

const held = new Map(); // inbox id -> { id, at, pay, why, short, picks } : payments a person sorts on Orders
let shop = null;         // the program's answer: { shop, paypalEmail, sandbox, ipnUrl, scriptUrl }
let unreached = '';      // why the account could not be asked, said on the Shelf instead of a blank form
let sent = '';           // the counts last published: an unchanged shelf sends nothing
let failing = false;     // a failed publish is said once, not on every save
let timer = null;
let line = Promise.resolve();
let sending = Promise.resolve(true); // one count send at a time, in the order they were asked for

export const wired = () => !!shop?.shop;
export const shopOf = () => shop;
export const waiting = () => [...held.values()];

// one of the program's doors (warchief-desktop/main.js deskApp): a JSON answer, or its error in words
export async function call(path, body) {
  const r = await fetch(path, body === undefined ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw new Error(data?.error || text || 'the program answered ' + r.status);
  return data;
}

// what the account already has (asked once as the desk opens in the program)
export async function load(desk) {
  if (!desk.program) return null;
  try { shop = await call('/_/site'); unreached = ''; } catch (e) { shop = null; unreached = e?.message || String(e); }
  if (wired()) publish(desk, true);
  desk.rerender();
  return shop;
}

// make or change the shop: the PayPal email payments must be paid to, and test payments on or off
export async function save(desk, { paypalEmail, sandbox }) {
  shop = await call('/_/site', { paypalEmail, sandbox: !!sandbox });
  unreached = '';
  sent = '';
  publish(desk, true);
  return shop;
}

// the counts the site shows, sent when they change, a moment after the last save
export function publish(desk, now = false) {
  if (!desk.program || !wired()) return;
  clearTimeout(timer);
  timer = setTimeout(() => send(desk), now ? 0 : 800);
}
// true once the site holds the counts as they stand now. Sends run one at a time, so an older count
// never lands after a newer one.
function send(desk) {
  sending = sending.then(async () => {
    const rows = V.siteCounts(desk.store);
    const json = JSON.stringify(rows);
    if (json === sent) return true;
    try {
      await call('/_/stock', { rows });
      sent = json;
      failing = false;
      return true;
    } catch (e) {
      if (!failing) desk.toast('Your website’s counts were not sent (' + e.message + '). The desk tries again at the next change.', { error: true });
      failing = true;
      return false;
    }
  });
  return sending;
}

// The notices the program read: each payment that ties to the shelf is booked, each that does not
// waits for a person, and the program hears which are done only after the books are saved here.
// The same notice sent twice is refused by its PayPal transaction id, so nothing books twice.
export function take(desk, items) {
  line = line.then(() => takeNow(desk, items)).catch((e) => desk.toast('A PayPal payment could not be read: ' + (e?.message ?? e), { error: true }));
  return line;
}
async function takeNow(desk, items) {
  const store = desk.store;
  const done = [];
  const notes = [];
  const fresh = []; // payments this batch left waiting for a person
  let ready = 0;
  let test = false;
  const list = [...(items ?? [])].filter((it) => it?.id && it.payload && !held.has(it.id))
    .sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)));
  // Nothing new: the program hands a waiting payment over again every minute, and a re-draw for it
  // would wipe the mark on the line a link just landed on (Fable's pass on 0.5.0, 2026-10-05).
  if (!list.length) return;
  for (const it of list) {
    const pay = readIpn(it.payload);
    const deps = it.received_at ? { now: it.received_at } : {};
    try {
      if (pay.status === 'Completed') {
        if (V.paypalBooked(store, pay.txn)) { done.push(it.id); continue; }
        const short = pay.currency === 'USD' ? V.shortPayment(store, pay) : null;
        if (!V.sortPayment(store, pay).ready || pay.currency !== 'USD' || short) {
          held.set(it.id, { id: it.id, at: it.received_at, pay, short, why: pay.currency !== 'USD' ? `PayPal says this was paid in ${pay.currency}; the desk keeps its books in dollars. Book what reached you on Books.` : '' });
          fresh.push(held.get(it.id));
          continue;
        }
        const r = V.takePayment(store, pay, {}, deps);
        done.push(it.id);
        if (r.ship) ready++;
        if (pay.test) test = true;
        if (r.warning) notes.push(r.warning);
        continue;
      }
      // a refund or a reversal of a payment still waiting to be sorted: the two cancel, and nothing
      // is booked. A cancelled reversal gives money BACK, so it never cancels anything.
      const back = pay.status === 'Canceled_Reversal';
      const twin = !back && [...held.values()].find((h) => h.pay.txn === pay.parent);
      if (twin) {
        held.delete(twin.id);
        done.push(twin.id, it.id);
        notes.push(`a PayPal payment from ${twin.pay.buyer.name || 'a buyer'} was ${pay.status === 'Reversed' ? 'taken back by PayPal' : 'refunded'} before it was sorted, so nothing was booked`);
        continue;
      }
      if (!V.paypalBooked(store, pay.parent)) {
        done.push(it.id);
        notes.push(back
          ? `PayPal gave back ${store.usd(Math.abs(pay.gross))} of a payment this desk never booked (a reversal it cancelled); nothing changed here, so if it is yours, book it on Books`
          : `PayPal reported ${pay.status === 'Reversed' ? 'a payment taken back' : 'a refund'} for a payment this desk never booked; nothing changed`);
        continue;
      }
      const r = V.takeRefund(store, pay, deps);
      done.push(it.id);
      notes.push(r.act.label + (r.warning ? ': ' + r.warning : ''));
    } catch (e) {
      const why = e?.message ?? String(e);
      if (/already on the books/.test(why)) { done.push(it.id); continue; }
      held.set(it.id, { id: it.id, at: it.received_at, pay, why });
      fresh.push(held.get(it.id));
    }
  }
  if (done.length) await settle(desk, done);
  desk.rerender();
  tell(desk, ready, test, notes, fresh);
}

// Told only once the books are saved. A save that failed keeps the notices waiting: the program
// sends them again, the desk finds them booked, and they are marked taken with the next good save.
// The site gets the lower count BEFORE the notices are marked taken: the cloud holds a waiting
// notice's goods back from the count only until it is taken, so the other order shows those goods
// for sale again for the moment between, and for good if the count never arrives. A count that
// did not arrive leaves the notices waiting, still held back, and the next minute tries again.
async function settle(desk, ids) {
  await desk.store.flush();
  if (desk.store.saveNote) return;
  if (desk.program && wired()) {
    clearTimeout(timer);
    if (!(await send(desk))) return;
  }
  try { await call('/_/inbox/taken', { ids }); } catch {}
}

// Said once per payment, as it arrives. The program hands the waiting ones over again every minute
// and the desk leaves those be, so a payment that waits is not announced again each minute.
// Each kind is told what its own box on Orders asks: one paid in another currency, or one the desk
// hit an error on, offers only Leave it out, so "pick what it paid for" would be untrue for it.
function tell(desk, ready, test, notes, fresh) {
  const count = (f) => fresh.filter(f).length;
  const short = count((h) => h.short);
  const stuck = count((h) => h.why);
  const bare = count((h) => !h.short && !h.why && !h.pay.lines.length);
  const pick = fresh.length - short - stuck - bare;
  const ask = [
    short && (short === 1 ? 'a payment paid less than your Shelf price, so nothing was booked or taken off the Shelf for it: see it on Orders' : `${short} payments paid less than your Shelf prices, so nothing was booked or taken off the Shelf for them: see them on Orders`),
    stuck && (stuck === 1 ? 'a PayPal payment was not booked: see why on Orders' : `${stuck} PayPal payments were not booked: see why on Orders`),
    pick && (pick === 1 ? 'a PayPal payment needs you: pick what it paid for on Orders' : `${pick} PayPal payments need you: pick what each paid for on Orders`),
    bare && (bare === 1 ? 'a PayPal payment names no product: book it as a sale or leave it out on Orders' : `${bare} PayPal payments name no product: book each as a sale or leave it out on Orders`),
  ].filter(Boolean);
  const said = [...notes, ...ask].map((n) => n.charAt(0).toUpperCase() + n.slice(1)).join('. ');
  if (ready) {
    const words = ready === 1 ? 'One payment ready to ship!' : `${ready} payments ready to ship!`;
    desk.toast(words + (said ? ' ' + said : ''), { next: { label: 'Ship', hash: '#ship' } });
    call('/_/alert', { title: words, body: test ? 'A test payment from PayPal’s sandbox. It is on Ship.' : 'Paid through your website. It is on Ship, the goods already off the shelf.', go: 'ship' }).catch(() => {});
  } else if (said) desk.toast(said, { error: !!(short || stuck), next: { label: 'Orders', hash: '#orders' } });
  if (fresh.length) {
    const body = fresh.length > 1 ? 'Each one says on Orders what it needs. Nothing came off the Shelf for any of them.'
      : short ? 'It paid less than your Shelf price for what it names. Nothing came off the Shelf; see it on Orders before anything ships.'
        : stuck ? 'It was not booked, and nothing came off the Shelf. Orders says why.'
          : bare ? 'It names no product. Book it as a sale or leave it out on Orders.'
            : 'PayPal named something the desk does not know. Pick it on Orders.';
    call('/_/alert', { title: fresh.length === 1 ? 'A payment needs you' : `${fresh.length} payments need you`, body, go: 'orders' }).catch(() => {});
  }
}

// a person sorted a held payment: booked in one act, the picks kept for those PayPal names. One
// that paid less than the Shelf's prices for those picks is booked only by "Book it anyway".
export async function book(desk, id, picks, anyway = false) {
  const h = held.get(id);
  if (!h) return null;
  const short = anyway ? null : V.shortPayment(desk.store, h.pay, picks);
  if (short) {
    Object.assign(h, { short, picks });
    desk.rerender();
    desk.toast(`It paid ${desk.store.usd(short.paid)} for goods your Shelf prices at ${desk.store.usd(short.expected)}, so nothing was booked. If that is right, Book it anyway.`, { error: true });
    return null;
  }
  const r = desk.act(() => V.takePayment(desk.store, h.pay, { picks, remember: true }, h.at ? { now: h.at } : {}),
    { next: { label: 'Ship', hash: '#ship' } });
  if (!r) return null;
  held.delete(id);
  await settle(desk, [id]);
  desk.rerender();
  return r;
}

// left out: nothing booked, the notice marked taken (PayPal still shows the payment)
export async function leaveOut(desk, id) {
  if (!held.delete(id)) return;
  await settle(desk, [id]);
  desk.rerender();
  desk.toast('Left out: nothing was booked. The payment is still in your PayPal activity.');
}

// ── what Orders shows: the payments waiting for a pick ─────────────────────────────────────────
export function waitingHTML(desk) {
  const store = desk.store;
  const esc = store.esc;
  if (!held.size) return '';
  const products = store.data.products.products.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const options = (sel) => `<option value="">Pick what it is…</option>${products.map((p) => `<option value="${esc(p.id)}"${sel === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="${V.MONEY_ONLY}">Not on the shelf: book the money only</option>`;
  const rows = waiting().map((h) => {
    const p = h.pay;
    const sorted = V.sortPayment(store, p, h.picks ?? {});
    const lines = sorted.lines.map((l, i) => `<div class="row" style="align-items:center">
        <span style="flex:1 1 200px">“${esc(l.name || l.id || 'no name')}” ×${esc(l.qty)}${l.amount ? ' · ' + esc(store.usd(l.amount)) : ''}</span>
        ${h.why ? '' : `<select class="f" data-pp-line="${i}" style="flex:1 1 200px">${options(l.product && l.product !== V.MONEY_ONLY ? l.product.id : l.product === V.MONEY_ONLY ? V.MONEY_ONLY : '')}</select>`}
      </div>`).join('');
    return `<div class="open" data-pp="${esc(h.id)}" style="margin-bottom:10px">
      <p><b>${esc(p.buyer.name || 'Someone')}</b> paid ${esc(store.usd(p.gross))} through PayPal${p.test ? ' <span class="badge gold">test</span>' : ''}</p>
      ${h.why ? `<p class="truth">⚠ ${esc(h.why)}</p>` : lines || '<p class="note">It names no product (money sent, an invoice paid). Book it as a sale, or leave it out.</p>'}
      ${h.short && !h.why ? `<p class="truth">⚠ Paid ${esc(store.usd(h.short.paid))} for goods your Shelf prices at ${esc(store.usd(h.short.expected))}, so nothing was booked and nothing came off the Shelf. If you gave a discount, or changed a price after making the PayPal button, book it anyway. If not, the price on the button may have been changed before paying (it sits in your page, where anyone can edit it): refund it in PayPal, then leave it out.</p>` : ''}
      <div class="btns">
        ${h.why ? '' : `<button type="button" class="btn${h.short ? '' : ' fill'}" data-do="pp-book" data-id="${esc(h.id)}"${h.short ? ' data-anyway="1"' : ''}>${h.short ? 'Book it anyway' : lines ? 'Book it' : 'Book it as a sale'}</button>`}
        <button type="button" class="btn" data-do="pp-leave" data-id="${esc(h.id)}">Leave it out</button>
      </div>
    </div>`;
  }).join('');
  return `<h2 class="sect">From your website: ${held.size === 1 ? 'a payment needs you' : held.size + ' payments need you'}</h2>
    <p class="note">Nothing in these was booked or taken off the Shelf yet. Where PayPal named something the desk could not tie to the shelf, pick what each line is once; the desk keeps the answer for that PayPal name.</p>${rows}`;
}

// Orders' clicks for the box above; true when the click was one of these
export function onWaitingClick(desk, b) {
  const id = b.dataset.id;
  switch (b.dataset.do) {
    case 'pp-leave': leaveOut(desk, id); return true;
    case 'pp-book': {
      const box = b.closest('[data-pp]');
      const picks = {};
      box?.querySelectorAll('[data-pp-line]').forEach((s) => { if (s.value) picks[Number(s.dataset.ppLine)] = s.value; });
      if (!box?.querySelector('[data-pp-line]')) picks.money = true;
      book(desk, id, picks, b.dataset.anyway === '1');
      return true;
    }
    default: return false;
  }
}

// ── what the Shelf shows: the website, wired or not ────────────────────────────────────────────
export const listed = (store) => store.settings.site?.listed ?? [];
export function sectionHTML(desk) {
  const store = desk.store;
  const esc = store.esc;
  const head = '<h2 class="sect" data-ref="website">Your website</h2>';
  if (!desk.program) return head + '<p class="note">The count on your own website and the payments it takes reach the desk through the War Chief program, which holds your sign-in. Open the desk in the program to wire it.</p>';
  const s = shop ?? {};
  const st = store.settings.site ?? {};
  const form = `<div class="row">
      ${cell('The email your PayPal is paid to', `<input class="f" id="ws-email" type="email" autocomplete="email" placeholder="you@yourshop.com" value="${esc(s.paypalEmail ?? '')}" />`)}
      ${cell('Your state', `<input class="f" id="ws-state" maxlength="2" placeholder="MI" value="${esc(st.state ?? '')}" />`, 's')}
    </div>
    <label class="chip sm" style="cursor:pointer;margin:0 0 8px"><input type="checkbox" id="ws-test"${s.sandbox ? ' checked' : ''} /> Take test payments from PayPal’s sandbox (pretend money that books like a sale, marked TEST: turn it off before you sell for real)</label>
    <button type="button" class="btn${wired() ? '' : ' fill'}" data-do="ws-save">${wired() ? 'Save' : 'Wire my website'}</button>
    <p class="note">Your state: a payment shipped to another state books no sales tax here (a payment where PayPal charged tax books PayPal’s). Leave it empty and every payment is split at your rate on Books.</p>`;
  if (!wired() && unreached) {
    return head + `<p class="truth">⚠ Your account did not answer just now (${esc(unreached)}), so whether your website is wired cannot be shown. It is asked again the next time the desk opens.</p>`;
  }
  if (!wired()) {
    return head + `<p class="lede">Put a live count of what is on your Shelf on your own pages, and have a PayPal payment there take the goods off the Shelf, book the money and say <b>One payment ready to ship!</b></p>${form}`;
  }
  const items = store.data.products.products.filter((p) => listed(store).includes(p.id) && p.itemId);
  const tag = (p) => `<span data-warchief="${s.shop}:${p.id}"></span>`;
  const script = `<script src="${s.scriptUrl}" async></script>`;
  return head + `
    <h3 class="sub">1. In PayPal</h3>
    <p>Settings → Notifications → Instant payment notifications → Update. Paste this address, choose <b>Receive IPN messages (Enabled)</b>, and Save. Every payment PayPal takes for you then reaches this desk, the website’s and any other.</p>
    <pre class="letter" style="margin:8px 0;white-space:pre-wrap;word-break:break-all">${esc(s.ipnUrl)}</pre>
    <button type="button" class="chip sm" data-do="ws-copy" data-text="${esc(s.ipnUrl)}">Copy the address</button>
    <p class="truth">⚠ PayPal sends these notices to one address per account. If another app already listens there (a shop plugin), this replaces it and that app stops hearing about payments. PayPal calls the notices legacy and still supports them, its no-code payment buttons and links included (its own FAQ, read 2026-10-04); if it ever retires them, the desk will need its newer webhooks instead.</p>
    <h3 class="sub">2. On your page</h3>
    ${items.length ? `<p>Where each count should show, paste its tag; the number appears inside it and follows the Shelf:</p>
      ${items.map((p) => `<div class="row" style="align-items:center"><span style="flex:1 1 160px">${esc(p.name)}</span><code style="flex:2 1 240px;word-break:break-all">${esc(tag(p))}</code><button type="button" class="chip sm" data-do="ws-copy" data-text="${esc(tag(p))}">Copy</button></div>`).join('')}
      <p>And once anywhere on the page:</p>
      <div class="row" style="align-items:center"><code style="flex:2 1 240px;word-break:break-all">${esc(script)}</code><button type="button" class="chip sm" data-do="ws-copy" data-text="${esc(script)}">Copy</button></div>
      <p class="note">Add <code>data-show="price"</code> to a tag for the price instead of the count, and <code>data-warchief-hide="#your-buy-button"</code> to hide that button while the count is 0. Text you write inside a tag shows if the count cannot be read. The count is the Shelf less orders not yet taken off it. A payment drops the count of the product it names at once, even with the program closed; the rest (a pack drawn from the same goods, a name the desk had to ask about) follows when the desk books the payment, about a minute after it arrives while the program is open.</p>`
      : '<p class="note">Open a product above and tick <b>Show its count on my website</b>; its tag appears here.</p>'}
    <p class="note">Name each product on your PayPal buttons exactly as it is named on the Shelf: that is how a payment finds its product. A payment that names something else waits on Orders for one pick, and the desk keeps that pick for the name.</p>
    <h3 class="sub">3. Your settings</h3>${form}`;
}

// the Shelf's clicks for the box above; true when the click was one of these
export function onSectionClick(desk, b, el) {
  switch (b.dataset.do) {
    case 'ws-copy':
      copyText(b.dataset.text).then((ok) => desk.toast(ok ? 'Copied' : 'Could not copy; select it and copy by hand', { error: !ok }));
      return true;
    case 'ws-save': return saveClick(desk, b, el);
    default: return false;
  }
}
function saveClick(desk, b, el) {
  const email = el.querySelector('#ws-email')?.value.trim() ?? '';
  const sandbox = !!el.querySelector('#ws-test')?.checked;
  const r = desk.act(() => V.setSiteState(desk.store, el.querySelector('#ws-state')?.value ?? ''), { keep: true });
  if (!r) return true; // refused: the desk said why
  if (!email) { desk.toast('Type the email your PayPal is paid to: a payment made to any other PayPal account moves nothing here', { error: true }); return true; }
  const was = wired();
  b.disabled = true;
  save(desk, { paypalEmail: email, sandbox }).then(() => {
    desk.rerender();
    desk.toast(was ? 'Saved' : 'Wired. Next: paste the address under 1 into PayPal, then the tags under 2 onto your page');
  }, (e) => {
    b.disabled = false;
    desk.toast('Not wired: ' + (e?.message ?? e), { error: true });
  });
  return true;
}
