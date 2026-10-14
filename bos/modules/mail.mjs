// MAIL — the seventh station: letters to customers, written from the order so nothing is typed
// twice. The letters began as the mill desk's own (public/warchief.html, Grok's set), with the price
// and the day filled in where a letter needs them. A tone changes the wording by fixed rules, not
// by a machine guessing, so what you see is exactly what will be sent. Copy it, or open it in your
// mail program; webmail opens beside the desk in the program. In the program a letter can also go
// from War Chief itself, through the person's own Resend account, and any letter can send itself:
// each is a chip with a switch, on at the top, off below, and each waits for its own moment (Matt,
// 2026-10-06 02:32Z: "flipping an email chip as active or inactive sets it to send or not send
// based on conditions … flipping the chip to inactive moves it to bottom and turns it off").
import * as V from './verbs.mjs';
import { copyText, outLink, cell, secretField } from './ui.mjs';
import { call } from './site.mjs';
import { trackingIn } from './files.mjs';

// The moments a letter can wait for, each read off the order itself. `carrier` ones are the parcel's
// own news, which War Chief learns by asking the carrier (below, through the person's Shippo key).
export const TRIGGERS = [
  { id: 'hand', label: 'sent by hand only' },
  { id: 'booked', label: 'a job is booked for a day' },
  { id: 'day-before', label: 'the day before its day' },
  { id: 'paid-ship', label: 'an order to ship is paid' },
  { id: 'paid-here', label: 'an order with nothing to ship is paid' },
  { id: 'unpaid', label: 'a week after its invoice, still unpaid' },
  { id: 'label', label: 'its label is bought' },
  { id: 'moving', label: 'the carrier scans it', carrier: true },
  { id: 'delivered', label: 'the carrier says it was delivered', carrier: true },
  { id: 'done', label: 'a job is marked done' },
  { id: 'refunded', label: 'an order is refunded' },
  { id: 'cancelled', label: 'an order is cancelled' },
];

// Every letter a small business sends, in the order the work happens. `when` is the moment it waits
// for until the person picks another; a letter that is only ever sent by hand waits for nothing.
export const LETTERS = [
  { id: 'quote', name: 'Quote', when: 'hand', subject: 'The price, before the work', body: '[NAME],\n\nThe price for [PRODUCT] is [TOTAL]. It holds for seven days. Nothing starts until you say yes.\n\nReply yes and [COMPANY] begins. Reply no and nothing is owed.\n\n—\n[COMPANY]' },
  { id: 'booked', name: 'Booked', when: 'booked', subject: 'You are on the book', body: '[NAME],\n\n[COMPANY] has you down for [PRODUCT] on [WHEN], as [ORDER].\n\nIf the time or the work is wrong, reply now.\n\n—\n[COMPANY]' },
  { id: 'reminder', name: 'Reminder', when: 'day-before', subject: 'Tomorrow: [PRODUCT]', body: '[NAME],\n\nA reminder: [COMPANY] has you down for [PRODUCT] tomorrow, [WHEN].\n\nIf the day no longer works, reply now.\n\n—\n[COMPANY]' },
  { id: 'in', name: 'Order in', when: 'paid-ship', subject: 'We have your order', body: '[NAME],\n\n[COMPANY] has [ORDER] for [PRODUCT]. It is in the work. You will hear when it ships.\n\n[ITEMS]\n\nIf the order is wrong, reply. A person reads it.\n\n—\n[COMPANY]' },
  // added 2026-10-05: Orders' Paid offers "Send the receipt", and no letter of the ten said the money had come in
  { id: 'receipt', name: 'Receipt', when: 'paid-here', subject: 'Your payment is in', body: '[NAME],\n\n[COMPANY] has your payment of [TOTAL] for [ORDER].\n\n[ITEMS]\n\nKeep this letter as your receipt. If the amount is wrong, reply. A person reads it.\n\n—\n[COMPANY]' },
  { id: 'invoice', name: 'Invoice', when: 'hand', subject: 'Invoice for [ORDER]', body: '[NAME],\n\nPayment for [ORDER] is due: [TOTAL].\n\n[ITEMS]\n\nPay the way you and [COMPANY] already use. Reply if the amount is wrong.\n\n—\n[COMPANY]' },
  { id: 'unpaid', name: 'Payment due', when: 'unpaid', subject: 'A reminder: [TOTAL] is due', body: '[NAME],\n\nA reminder that payment for [ORDER] is still due: [TOTAL].\n\n[ITEMS]\n\nIf you have paid it already, thank you: reply and say so, and [COMPANY] will mark it. If the amount is wrong, reply.\n\n—\n[COMPANY]' },
  // 'out' was "Shipped" until 2026-10-06, sent when the label was bought; Matt split it in two that
  // day: "'we are preparing to ship' … when you print the label" and "'your order has shipped!' …
  // when its tracking number has been received by parcel carrier". The id stays, so a switch already
  // on and the letters already sent keep meaning the label.
  { id: 'out', name: 'Preparing to ship', when: 'label', subject: 'We are preparing to ship your order', body: '[NAME],\n\n[COMPANY] is preparing to ship [PRODUCT]. Its label is made.\n\nTracking: [TRACKING]\n\nThe tracking starts to move once the carrier scans it. If it does not move for three days, reply here.\n\n—\n[COMPANY]' },
  { id: 'shipped', name: 'Shipped', when: 'moving', subject: 'Your order has shipped!', body: '[NAME],\n\nYour order of [PRODUCT] is on its way: the carrier has scanned it.\n\nTracking: [TRACKING]\n\nIf it stops moving for three days, reply here.\n\n—\n[COMPANY]' },
  { id: 'delivered', name: 'Delivered', when: 'delivered', subject: 'Your order arrived', body: '[NAME],\n\nThe carrier says your order of [PRODUCT] was delivered.\n\nIf it is not there, or something is wrong with it, reply. A person reads it.\n\n—\n[COMPANY]' },
  { id: 'ready', name: 'Ready', when: 'hand', subject: 'It is ready', body: '[NAME],\n\n[PRODUCT] is ready. Come take it, or tell [COMPANY] where to meet.\n\n—\n[COMPANY]' },
  { id: 'done', name: 'Finished', when: 'done', subject: 'The work is done', body: '[NAME],\n\n[COMPANY] has finished [PRODUCT] for [ORDER].\n\nIf something is not right, reply. [COMPANY] will look at it.\n\n—\n[COMPANY]' },
  { id: 'problem', name: 'Problem', when: 'hand', subject: 'Stopped until we hear', body: '[NAME],\n\nSomething is wrong with [ORDER]. [COMPANY] has stopped until you reply.\n\nSay what you want done. A person reads it.\n\n—\n[COMPANY]' },
  { id: 'refund', name: 'Refund', when: 'refunded', subject: 'The money is going back', body: '[NAME],\n\n[COMPANY] is sending back the money for [PRODUCT] on [ORDER]. It returns on the same rail it came in on.\n\nIf something about it is wrong, reply. A person reads it.\n\n—\n[COMPANY]' },
  { id: 'cancelled', name: 'Cancelled', when: 'cancelled', subject: 'Your order is cancelled', body: '[NAME],\n\n[COMPANY] has cancelled [ORDER] for [PRODUCT].\n\nIf you did not ask for this, reply. A person reads it.\n\n—\n[COMPANY]' },
  { id: 'note', name: 'Note', when: 'hand', subject: 'A note from [COMPANY]', body: '[NAME],\n\nA note from [COMPANY]. Nothing is owed unless this letter says so.\n\n—\n[COMPANY]' },
];

// The major webmail, each opening at its sign-in or as near it as could be seen: loaded 2026-10-05 in
// the program's own engine as a visitor not signed in. Gmail, Outlook, Proton and Zoho land on their
// sign-in; Yahoo, AOL and iCloud on their mail page, a press from it (their sign-in pages answered
// this test machine 429, too many requests). Outlook's outlook.live.com/mail/ landed on Microsoft's
// advertising page, so it opens at outlook.office.com/mail/, Microsoft's sign-in for every account:
// a personal Outlook.com sign-in through it was not tried here.
export const WEBMAIL = [
  { name: 'Gmail', url: 'https://mail.google.com/mail/' },
  { name: 'Outlook', url: 'https://outlook.office.com/mail/' },
  { name: 'Yahoo', url: 'https://mail.yahoo.com' },
  { name: 'iCloud', url: 'https://www.icloud.com/mail' },
  { name: 'AOL', url: 'https://mail.aol.com' },
  { name: 'Proton', url: 'https://mail.proton.me' },
  { name: 'Zoho', url: 'https://accounts.zoho.com/signin?servicename=VirtualOffice&serviceurl=https%3A%2F%2Fmail.zoho.com%2Fzm%2F' },
];
// Resend, the service War Chief sends through (below), at its sign-in: every one of its pages sends a
// visitor not signed in there (measured 2026-10-06: /api-keys, /domains and /emails answer 307 to
// /login). Matt, 2026-10-05 02:29Z: the web addresses are for "the resend email sender, banks and
// PayPal itself essentially but plug and play".
export const SENDER = { name: 'Resend', url: 'https://resend.com/login' };
const INVOICE_NOTE = 'Pay with the link you already use. We do not take a bank login.';
const TONES = ['plain', 'warm', 'brief'];

// view state
let orderId = '';
let letterId = 'in';
let to = '';
let subject = null;  // null = follow the letter; a string = what the person typed
let body = null;
let editing = null;  // a letter's words being changed, or a letter of their own: { id?, name, subject, body }
// sending from the program: its answer about the key ({ key, safe }; null until asked, and on the
// web), a Send it on its way, the order:letter pairs being sent (so a save landing meanwhile sends
// nothing twice), and the line they wait in
let mailer = null;
let sendingNow = false;
const busy = new Set();
let queue = Promise.resolve();

// A letter whose words the person changed is kept in settings.letters under the stock letter's own
// id, and stands in its place; a letter of their own has an id no stock letter has.
const kept = (store) => (store.settings.letters ?? []).filter((l) => l && l.id && l.name);
export function allLetters(store) {
  const own = kept(store);
  return [
    ...LETTERS.map((L) => { const o = own.find((x) => x.id === L.id); return o ? { ...L, name: o.name, subject: o.subject, body: o.body, restyled: true } : L; }),
    ...own.filter((x) => !LETTERS.some((L) => L.id === x.id)).map((x) => ({ ...x, custom: true, when: 'hand' })),
  ];
}
export const triggerOf = (store, L) => {
  const t = store.settings.letterWhen?.[L.id] ?? L.when ?? 'hand';
  return TRIGGERS.some((x) => x.id === t) ? t : 'hand';
};
const triggerLabel = (id) => TRIGGERS.find((t) => t.id === id)?.label ?? 'sent by hand only';
const toneOf = (store) => (TONES.includes(store.settings.tone) ? store.settings.tone : 'plain');
const emailOf = (store, o) => String(o?.email ?? store.resolve('person:' + o?.customerId)?.email ?? '').trim();
const ADDRESS = /^[^\s@<>",;:()[\]\\]+@[^\s@<>",;:()[\]\\]+\.[^\s@<>",;:()[\]\\]+$/;
const holesIn = (text) => [...new Set(String(text).match(/\[[A-Z]+\]/g) ?? [])];

// The goods or the work on an order, a line each, then what it comes to: the receipt a letter
// carries ([ITEMS]) and the invoice is drawn from. A payment PayPal reported shows its shipping and
// the tax PayPal or the desk found in it; one taken by hand, the tax the company's rate puts inside.
export function itemsText(store, o) {
  const rows = (o?.lines ?? []).map((ln) => {
    const p = store.resolve('product:' + ln.productId);
    const each = Number(ln.price ?? p?.price ?? 0);
    return `${ln.qty} × ${p?.name ?? ln.productId} at ${store.usd(each)}: ${store.usd(each * Number(ln.qty))}`;
  });
  if (!rows.length) return '';
  const total = V.orderTotal(store, o);
  const ship = Number(o.paypal?.shipping) || 0;
  const tax = o.paypal ? Number(o.paypal.tax) || 0 : V.splitTax(total, Number(V.rateFor(store, o)) || 0).tax;
  // a PayPal line tied to no product (takePayment notes it on the order), so the lines add up to the total
  const also = o.paypal ? /Also paid for, not on the shelf: (.+?)(?:\. Their note: |$)/s.exec(String(o.note ?? ''))?.[1] : '';
  return [...rows, ...(also ? [`Also paid for: ${also}`] : []), ...(ship > 0 ? [`Shipping: ${store.usd(ship)}`] : []), `Total: ${store.usd(total)}${tax > 0 ? ` (includes ${store.usd(tax)} sales tax)` : ''}`].join('\n');
}

// what the brackets become for one order (a missing value stays in brackets, so it shows)
export function fieldsFor(store, order) {
  const f = { '[COMPANY]': store.settings.company || 'the company' };
  if (!order) return f;
  const lines = (order.lines ?? []).map((ln) => {
    const p = store.resolve('product:' + ln.productId);
    return `${Number(ln.qty) === 1 ? '' : ln.qty + ' × '}${p?.name ?? ln.productId}`;
  });
  if (order.customer) f['[NAME]'] = order.customer;
  f['[ORDER]'] = 'order ' + V.orderName(order);
  if (lines.length) f['[PRODUCT]'] = lines.join(', ');
  if (lines.length) f['[ITEMS]'] = itemsText(store, order);
  // the carrier that carries it, by its own name, when the number or the name says which (a label
  // bought at Pirate Ship goes by USPS or UPS); else what the person typed, unless that names the
  // shop the label came from, which is no carrier: then the number alone
  if (order.tracking) {
    const typed = SELLER.test(String(order.carrier ?? '')) ? '' : order.carrier ?? '';
    const by = CARRIER_TOKENS.find(([id]) => id === carrierFor(order))?.[2] ?? typed;
    f['[TRACKING]'] = `${by ? by + ' ' : ''}${order.tracking}`;
  }
  f['[TOTAL]'] = store.usd(V.orderTotal(store, order));
  if (order.due) f['[WHEN]'] = order.due;
  return f;
}

// The tone rules: plain is the letter; warm greets and thanks; brief keeps the greeting, every
// paragraph that carries a fact (the order, the product, the tracking, the total, the day, the
// receipt) and the sign-off, so a short letter never loses the tracking number.
export function toned(text, how) {
  const parts = String(text).split('\n\n');
  if (how === 'warm') {
    if (/^\[NAME\],$|^[^\n]+,$/.test(parts[0])) parts[0] = 'Hi ' + parts[0];
    const at = parts.findIndex((p) => p.startsWith('—'));
    parts.splice(at < 0 ? parts.length : at, 0, 'Thank you for your business.');
    return parts.join('\n\n');
  }
  if (how === 'brief') {
    const [greet, ...rest] = parts;
    const at = rest.findIndex((p) => p.startsWith('—'));
    const middle = at < 0 ? rest : rest.slice(0, at);
    let keep = middle.filter((p) => /\[(ORDER|PRODUCT|TRACKING|TOTAL|WHEN|ITEMS)\]/.test(p));
    if (!keep.length) keep = middle.slice(0, 1);
    return [greet, ...keep, ...(at < 0 ? [] : rest.slice(at))].join('\n\n');
  }
  return text;
}

export function fill(store, text, fields) {
  let out = String(text);
  const sign = String(store.settings.signoff ?? '').trim();
  if (sign) out = out.replace(/—\n\[COMPANY\]$/, '—\n' + sign);
  const reply = String(store.settings.replyTo ?? '').trim();
  if (reply && out.includes('\n—\n')) out += `\nWrite back to ${reply}`;
  for (const [k, v] of Object.entries(fields)) out = out.split(k).join(v);
  return out;
}

// --- letters that send themselves ------------------------------------------------------------------
const DAY = 24 * 3600e3;
const HOUR = 3600e3;
const stepAt = (o, to) => [...(o?.history ?? [])].reverse().find((h) => h?.to === to)?.at ?? null;
const goodsOn = (store, o) => (o.lines ?? []).some((ln) => store.resolve('product:' + ln.productId)?.itemId);
const dayBefore = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] - 1)).toISOString().slice(0, 10) : '';
};
// The parcel's news as the carrier last gave it, for the tracking number the order holds now (a
// label taken back and bought again leaves an answer about the old number, which is not this one).
export const trackOf = (o) => (o?.track && o.tracking && o.track.n === o.tracking ? o.track : null);
const atCarrier = (o) => ['shipped', 'done'].includes(V.statusOf(o));
// The carrier's time, or the label's on this desk if that came later: an order reaches the carrier's
// moment here no earlier than its label did. A label typed in after the parcel was scanned, or one of
// Shippo's test parcels, whose made-up history is dated years back, would otherwise count as having
// moved before its letter was switched on, and get nothing.
const notBefore = (at, o) => { const l = stepAt(o, 'shipped'); return l && Date.parse(l) > Date.parse(at) ? l : at; };

// For each moment, when the order reached it, but only while it still stands there: a letter about
// a step the order has already left (paid, and shipped since) is never sent late.
const STEPS = {
  booked: (s, o) => (V.statusOf(o) === 'new' && o.due && !o.ship ? stepAt(o, 'new') : null),
  // the whole day before (on the person's clock), for a job or a pickup not yet done; a day missed
  // with the program shut is not made up the next morning, when the day has come
  'day-before': (s, o, now) => {
    const eve = dayBefore(o.due);
    return eve && !o.ship && ['new', 'paid'].includes(V.statusOf(o)) && V.dayOf({ now }) === eve ? eve + 'T00:00:00' : null;
  },
  'paid-ship': (s, o) => (V.statusOf(o) === 'paid' && o.ship ? stepAt(o, 'paid') : null),
  'paid-here': (s, o) => (V.statusOf(o) === 'paid' && !o.ship ? stepAt(o, 'paid') : null),
  // seven days after War Chief sent the order's Invoice (Copy and Open in your mail leave no record
  // here, so an invoice sent that way starts no reminder), while the order is still not paid
  unpaid: (s, o, now) => {
    if (V.statusOf(o) !== 'new') return null;
    const sent = Date.parse((o.letters ?? []).filter((l) => l?.id === 'invoice' && l.ok).at(-1)?.at ?? '');
    return !Number.isNaN(sent) && now >= sent + 7 * DAY ? new Date(sent + 7 * DAY).toISOString() : null;
  },
  label: (s, o) => (V.statusOf(o) === 'shipped' && o.tracking ? stepAt(o, 'shipped') : null),
  moving: (s, o) => { const t = trackOf(o); return t?.status === 'TRANSIT' && t.moving && atCarrier(o) ? notBefore(t.moving, o) : null; },
  delivered: (s, o) => { const t = trackOf(o); return t?.status === 'DELIVERED' && t.delivered && atCarrier(o) ? notBefore(t.delivered, o) : null; },
  done: (s, o) => (V.statusOf(o) === 'done' && !goodsOn(s, o) ? stepAt(o, 'done') : null),
  refunded: (s, o) => (V.statusOf(o) === 'refunded' ? stepAt(o, 'refunded') : null),
  cancelled: (s, o) => (V.statusOf(o) === 'cancelled' ? stepAt(o, 'cancelled') : null),
};
const sendsItself = (store, L) => !!STEPS[triggerOf(store, L)];
// switched on: settings.autoLetters[id] holds the moment it was, and only a time counts
const switchedOn = (store, id) => !Number.isNaN(Date.parse(store.settings.autoLetters?.[id] ?? ''));

// What the switches owe. A letter switched on (settings.autoLetters[id] holds the moment it was)
// goes once to each order that reached its moment on that day or later and still stands there, with
// an address to send to. Once a letter has been tried for an order, sent or refused, it leaves that
// order be: a refusal waits for a person (failed, below).
export function owed(store, now = Date.now()) {
  const out = [];
  for (const L of allLetters(store)) {
    const step = STEPS[triggerOf(store, L)];
    if (!step || !switchedOn(store, L.id)) continue;
    const since = V.dayOf({ now: store.settings.autoLetters[L.id] });
    for (const o of store.data.orders.orders) {
      if ((o.letters ?? []).some((l) => l?.id === L.id)) continue;
      const at = step(store, o, now);
      if (Number.isNaN(Date.parse(at ?? '')) || V.dayOf({ now: at }) < since) continue;
      if (!letterFor(store, o, L.id).to) continue;
      out.push({ order: o, id: L.id });
    }
  }
  return out;
}

// One letter as it goes by itself: its words (the person's own, if they changed them) in the
// company's tone, filled from the order, to the order's email. A test payment's (PayPal's sandbox)
// goes to the person's own address instead, its subject marked TEST, so a trial run never writes to
// a stranger. `holes` are the brackets the order could not fill.
export function letterFor(store, order, id) {
  const letter = allLetters(store).find((l) => l.id === id) ?? LETTERS[0];
  const fields = fieldsFor(store, order);
  const subj = fill(store, letter.subject, fields);
  const text = fill(store, toned(letter.body, toneOf(store)), fields);
  const test = !!order?.paypal?.test;
  const own = String(store.settings.replyTo || store.settings.mailFrom || '').trim();
  return { name: letter.name, to: test ? own : emailOf(store, order), subject: (test ? 'TEST: ' : '') + subj, text, test, holes: holesIn(subj + '\n' + text) };
}

// Each order's last try of each letter; the ones refused that nobody has left be are what Mail's
// badge counts.
const lastTries = (o) => { const m = new Map(); for (const l of o?.letters ?? []) if (l?.id) m.set(l.id, l); return [...m.values()]; };
// Leave it marks one refused try in a field of its own, `lettersLeft`, and Undo takes the mark back.
// It never goes in `letters`: Undo puts a field back as it stood before its act, so an Undo of a mark
// kept there would also take away the record of any letter sent after it.
export const leaveOps = (orderId, rec) => [{ op: 'set', ref: 'order:' + orderId, push: { lettersLeft: { id: rec.id, at: rec.at } } }];
const leftBe = (o, rec) => (o?.lettersLeft ?? []).some((x) => x?.id === rec.id && x?.at === rec.at);
export const failed = (store) => store.data.orders.orders.flatMap((o) => lastTries(o).filter((l) => !l.ok && !leftBe(o, l)).map((rec) => ({ order: o, rec })));

// --- the carrier's news: what Shipped and Delivered wait for -------------------------------------
// War Chief asks the carrier through the person's own Shippo account (the program's door,
// warchief-desktop/main.js trackDoor: GET api.goshippo.com/tracks/{carrier}/{number}, read at
// docs.goshippo.com 2026-10-06). Shippo prices tracking at 2¢ for a label not bought through it,
// and includes it for one that was (its API pricing page and its tracking guide, read that day). A
// desk cannot take Shippo's pushed updates (they need a web address of its own), so it asks: an
// hour after the label, then 2, 4, 8, 16 and 24 hours apart, ten times at most, for a parcel
// whose label is under two weeks old, and only while a letter that needs the answer is switched on.
let tracker = null;    // the program's answer about the Shippo key ({ key, test, safe }); null until asked
let trackBad = '';     // Shippo refused the key itself: nothing more is asked until a key is kept again
let checking = false;
let lastAnswer = null; // the latest answer, for the line on Mail: { order, status, at } or { order, why }
let ticking = null;
const FINAL = new Set(['DELIVERED', 'RETURNED', 'FAILURE']);
export const GAPS = [1, 2, 4, 8, 16, 24, 24, 24, 24, 24];
// the carriers a person would name, as Shippo's tracking knows them (docs.goshippo.com, Tracking
// Carriers, read 2026-10-06); Amazon is not among them
const CARRIER_TOKENS = [['usps', /\busps\b/i, 'USPS'], ['ups', /\bups\b/i, 'UPS'], ['fedex', /\bfed ?ex\b/i, 'FedEx'], ['dhl_express', /\bdhl\b/i, 'DHL Express'],
  ['ontrac', /\bon ?trac\b/i, 'OnTrac'], ['lasership', /\blaser ?ship\b/i, 'LaserShip']];
// the shops that sell labels on Ship's chips: a label bought there goes by a carrier of its own
const SELLER = /\bpirate ?ship\b|\bshippo\b/i;

// The carrier Shippo is asked about. A label seller (Pirate Ship, Shippo) is not a carrier, so its
// number says which one it is: a USPS number passes USPS's check digit, a UPS one starts 1Z
// (files.mjs, trackingIn). Shippo's own test parcels (SHIPPO_TRANSIT and the rest) answer a test key.
export function carrierFor(o) {
  const n = String(o?.tracking ?? '').trim();
  if (!n) return '';
  if (/^SHIPPO_[A-Z_]+$/.test(n)) return 'shippo';
  const named = CARRIER_TOKENS.find(([, re]) => re.test(String(o.carrier ?? '')));
  if (named) return named[0];
  const seen = trackingIn(n);
  return seen?.carrier === 'USPS' ? 'usps' : seen?.carrier === 'UPS' ? 'ups' : '';
}

// The parcels to ask about now: a tracking number, a carrier Shippo knows, a letter switched on that
// waits for the carrier and has not yet gone to this order, somewhere to send it, the parcel not yet
// at an end (or, if only Shipped still waits, not yet seen moving), under the cap, and due by the gaps
// above. A question can cost money, so nothing is asked unless a letter switched on still waits for
// the answer. With `all` (Ask the carriers now) the gaps are skipped and the cap still holds.
export function parcelsDue(store, now = Date.now(), hour = HOUR, all = false) {
  const wanted = allLetters(store).filter((L) => switchedOn(store, L.id) && TRIGGERS.find((t) => t.id === triggerOf(store, L))?.carrier);
  if (!wanted.length) return [];
  return store.data.orders.orders.filter((o) => {
    if (!o.tracking || !atCarrier(o) || !carrierFor(o)) return false;
    const waiting = wanted.filter((L) => !(o.letters ?? []).some((l) => l?.id === L.id)).map((L) => triggerOf(store, L));
    if (!waiting.length || !letterFor(store, o, wanted[0].id).to) return false;
    const t = trackOf(o);
    const tries = Number(t?.tries) || 0;
    if (t && FINAL.has(t.status)) return false;
    if (t?.moving && !waiting.includes('delivered')) return false;
    if (tries >= GAPS.length) return false;
    const label = Date.parse(stepAt(o, 'shipped') ?? '');
    if (Number.isNaN(label) || now - label > 14 * 24 * hour) return false;
    if (all) return true;
    const from = t ? Date.parse(t.at) : label;
    return !(now < (Number.isNaN(from) ? label : from) + GAPS[tries] * hour);
  });
}

// What one answer leaves on the order (`track`, written outside Undo: the carrier's word is a fact
// from outside, which Undo cannot take back, and no act Undo can take back writes this field). The
// first scan and the delivery keep the carrier's own times; a refusal keeps what was known before.
export function trackRecord(prev, ans, { n, carrier, at }) {
  const p = prev?.n === n ? prev : null;
  const base = { n, carrier, tries: (Number(p?.tries) || 0) + 1, at };
  if (!ans?.ok) return { ...(p ?? {}), ...base, why: String(ans?.why ?? 'no answer').slice(0, 300) };
  const seen = [...(Array.isArray(ans.history) ? ans.history : []), { status: ans.status, date: ans.date }]
    .filter((h) => h && !Number.isNaN(Date.parse(h.date ?? ''))).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const first = (st) => seen.find((h) => h.status === st)?.date ?? null;
  return { ...base, status: String(ans.status || 'UNKNOWN'), details: String(ans.details ?? '').slice(0, 300), moving: p?.moving ?? first('TRANSIT'), delivered: p?.delivered ?? first('DELIVERED') };
}

async function checkParcels(desk, all = false) {
  if (!desk.program || !tracker?.key || trackBad || checking) return;
  const due = parcelsDue(desk.store, Date.now(), tracker.unit || HOUR, all);
  if (!due.length) return;
  checking = true;
  try {
    for (const o of due) {
      const carrier = carrierFor(o);
      let ans;
      try { ans = await call('/_/track/check', { carrier, tracking: o.tracking }); } catch (e) { ans = { ok: false, offline: true, why: e?.message ?? String(e) }; }
      // not reached at all (offline): nothing is counted, and it is asked again on the next round
      if (ans?.offline) { lastAnswer = { order: o, why: ans.why, at: new Date().toISOString() }; break; }
      if (ans?.status === 401) { trackBad = ans.why || 'Shippo refused the key'; break; }
      const cur = desk.store.resolve('order:' + o.id);
      if (!cur || cur.tracking !== o.tracking) continue;
      const rec = trackRecord(trackOf(cur), ans, { n: o.tracking, carrier, at: new Date().toISOString() });
      lastAnswer = { order: cur, status: rec.status, why: rec.why, at: rec.at };
      try { desk.store.write(`the carrier on ${V.orderName(cur)}: ${rec.why ? 'no answer' : rec.status}`, [{ op: 'set', ref: 'order:' + o.id, patch: { track: rec } }], { undoable: false }); } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }
  } finally {
    checking = false;
  }
  desk.rerender();
}

// Asked once as the desk opens in the program: whether a Resend key and a Shippo key are kept, and
// whether this computer can keep one. Then whatever the switches owe goes (an order paid while the
// program was shut), and every five minutes after, for the letters that wait on the clock (the day
// before a job, a week after an invoice) and the parcels due an answer from their carrier.
export async function loadMailer(desk) {
  if (!desk.program) return;
  try { mailer = await call('/_/mail'); } catch { mailer = null; }
  try { tracker = await call('/_/track'); } catch { tracker = null; }
  desk.rerender();
  sendOwed(desk);
  checkParcels(desk);
  if (!ticking) ticking = setInterval(() => { sendOwed(desk); checkParcels(desk); }, Math.min(5 * 60e3, (tracker?.unit || HOUR) / 4));
}

// After every save (public/bos/index.html, store.onSave): each letter the switches owe, one at a time.
export function sendOwed(desk) {
  if (!desk.program || !mailer?.key || !desk.store.settings.mailFrom) return;
  for (const { order, id } of owed(desk.store)) {
    const k = order.id + ':' + id;
    if (busy.has(k)) continue;
    busy.add(k);
    // ponytail: one letter at a time, 0.6 s apart, so a burst stays under Resend's limit of requests a
    // second (its 429 rate_limit_exceeded); the tenth of ten paid at once waits about six seconds
    queue = queue.then(() => sendAuto(desk, order.id, id)).then(() => new Promise((r) => setTimeout(r, 600)))
      .catch(() => {}).finally(() => busy.delete(k));
  }
}
async function sendAuto(desk, oid, id) {
  // the order may have moved on, or been taken back, while its letter waited its turn
  const due = owed(desk.store).find((x) => x.order.id === oid && x.id === id);
  if (!due) return;
  const L = letterFor(desk.store, due.order, id);
  const res = L.holes.length ? { ok: false, why: `${L.holes.join(', ')} stayed in brackets: the order does not say it` }
    : await post(desk.store, L, `auto:${oid}:${id}`);
  record(desk, due.order, id, L, res);
}
// One letter to the program's door (warchief-desktop/main.js, mailDoor), which adds the key and asks
// Resend. The same idem twice within Resend's day is one letter; a person's own send has none.
async function post(store, { to: addr, subject: subj, text }, idem = '') {
  try {
    return await call('/_/mail/send', { to: addr, from: store.settings.mailFrom ?? '', name: store.settings.company ?? '', replyTo: store.settings.replyTo ?? '', subject: subj, text, idem });
  } catch (e) {
    return { ok: false, why: e?.message ?? String(e) };
  }
}
// What happened is kept on the order, in `letters`, outside Undo: Undo cannot unsend a letter, so it
// never takes this act back, and no act Undo can take back writes `letters` (Undo of the order's own
// making still takes the whole order, its letters with it).
function record(desk, order, id, L, res, hand = false) {
  const rec = { id, at: new Date().toISOString(), ok: !!res.ok, ...(L.to ? { to: L.to } : {}), ...(res.ok && res.id ? { resend: res.id } : {}),
    ...(res.ok ? {} : { why: String(res.why || 'not sent').slice(0, 300) }), ...(L.test ? { test: true } : {}), ...(hand ? { hand: true } : {}) };
  const who = order.customer || 'a customer';
  try { desk.store.write(`${L.name} ${res.ok ? 'sent' : 'not sent'} to ${who}`, [{ op: 'set', ref: 'order:' + order.id, push: { letters: rec } }], { undoable: false }); } catch {}
  desk.rerender();
  if (res.ok) desk.toast(`${L.test ? 'A test payment’s ' : ''}${L.name} went to ${L.test ? 'you' : who} (${L.to})`);
  else desk.toast(`${L.name} to ${who} was not sent: ${rec.why}`, { error: true, next: { label: 'Mail', hash: '#mail/order:' + order.id } });
}

function defaultLetter(store, o) {
  const refused = lastTries(o).filter((l) => !l.ok && !leftBe(o, l)).at(-1);
  if (refused) return refused.id;
  const st = V.statusOf(o);
  const goods = goodsOn(store, o);
  const t = trackOf(o);
  const carried = t?.status === 'DELIVERED' ? 'delivered' : t?.moving ? 'shipped' : 'out';
  if (st === 'shipped') return carried;
  if (st === 'refunded') return 'refund';
  if (st === 'cancelled') return 'cancelled';
  if (st === 'paid') return 'receipt';
  if (st === 'done') return goods ? (o.ship ? (carried === 'out' ? 'shipped' : carried) : 'ready') : 'done';
  return goods ? 'in' : 'booked';
}

function invoiceText(store, o) {
  if (!o) return '';
  return [
    store.settings.company || 'Company',
    `Invoice ${V.orderName(o)} · ${o.date ?? ''}`,
    '',
    `For: ${o.customer || '—'}`,
    ...(o.address ? [String(o.address)] : []),
    '',
    itemsText(store, o),
    '',
    String(store.settings.invoiceNote ?? INVOICE_NOTE),
  ].join('\n');
}

const mailtoOf = (addr, subj, text) => `mailto:${encodeURIComponent(addr.trim())}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(text)}`;
const stamp = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

// The chips: each letter's name opens it; in the program, once letters can be sent, a letter that
// waits for a moment has a switch that makes it send itself. Those switched on stand at the top with
// the moment they wait for; the rest below, in the order the work happens.
function lettersPart(store, esc, letters, open, canSwitch) {
  const isOn = (l) => canSwitch && switchedOn(store, l.id) && sendsItself(store, l);
  const chip = (l) => {
    const lit = isOn(l);
    const when = triggerLabel(triggerOf(store, l));
    const sw = canSwitch && sendsItself(store, l)
      ? `<button type="button" class="sw" data-do="auto" data-v="${esc(l.id)}" role="switch" aria-checked="${lit}" aria-label="${esc(l.name)} sends itself" title="${esc(lit ? `On: it sends itself when ${when}. Press to turn it off.` : `Off. Press and it sends itself when ${when}.`)}"></button>` : '';
    return `<span class="lt${lit ? ' on' : ''}">${sw}<button type="button" class="nm${l.id === open.id ? ' on' : ''}" data-do="letter" data-v="${esc(l.id)}" aria-pressed="${l.id === open.id}">${esc(l.name)}${lit ? `<small>when ${esc(when)}</small>` : ''}</button></span>`;
  };
  const lit = letters.filter(isOn);
  const rest = letters.filter((l) => !isOn(l));
  const custom = '<button type="button" class="chip sm" data-do="new-letter">+ Custom</button>';
  if (!canSwitch) return `<div class="chips" id="ml-letters">${letters.map(chip).join('')}${custom}</div>`;
  return `<div id="ml-letters">
    ${lit.length ? `<p class="k">Sending themselves</p><div class="chips">${lit.map(chip).join('')}</div>` : ''}
    <p class="k">${lit.length ? 'Off: sent by hand' : 'Letters: switch one on and it sends itself'}</p><div class="chips">${rest.map(chip).join('')}${custom}</div>
  </div>`;
}

// The program's part of the page: where letters are sent from, the carrier's answers, and what was
// refused.
function sendingPart(store, esc, letters) {
  if (!mailer) return '';
  const head = '<h2 class="sect">Sending</h2>';
  if (!mailer.safe && !mailer.key) return head + '<p class="truth">⚠ This computer has no safe place to keep a Resend key, so War Chief cannot send from it. Copy the letter or open it in your mail.</p>';
  const ready = !!(mailer.key && store.settings.mailFrom);
  const name = String(store.settings.company ?? '').replace(/[\r\n<>",;:()[\]\\@]+/g, ' ').replace(/\s+/g, ' ').trim();
  const refused = failed(store);
  const switched = letters.filter((l) => switchedOn(store, l.id) && sendsItself(store, l));
  const carrierOn = switched.filter((l) => TRIGGERS.find((t) => t.id === triggerOf(store, l))?.carrier);
  const watching = parcelsDue(store, Date.now(), tracker?.unit || HOUR, true);
  return `${head}
    ${ready ? '' : `<p class="note">War Chief sends your letters through your own <b>Resend</b> account: free for 100 letters a day and 3,000 a month. Resend sends only from a domain you own and have proven to it there, so an address at gmail.com or outlook.com cannot send from here; for those, Copy and Open in your mail still work.</p>`}
    ${!ready && switched.length ? '<p class="truth">⚠ A letter is switched on in your settings, but this computer keeps no Resend key and From address, so nothing is sent from it until both are kept here.</p>' : ''}
    <div class="row">
      ${cell('From address', `<input class="f" id="ml-from" type="email" placeholder="orders@ your own domain" value="${esc(store.settings.mailFrom ?? '')}" />`)}
      ${mailer.key ? '' : cell('Resend key', secretField('ml-key', 're_…', 'off'))}
      <button type="button" class="btn inline" data-do="keep-mailer">Keep</button>
    </div>
    ${mailer.key ? '' : `<p class="note">Make the key at Resend with Sending access. War Chief keeps it on this computer, encrypted by Windows for your account, sends it to Resend and nowhere else, and never puts it in your desk’s files or backups. ${outLink('https://resend.com/api-keys', 'Make a key at Resend', esc, 'chip sm')}</p>`}
    ${ready ? `<p class="note">A letter switched on above goes once to the order’s email, for orders that reach its moment from the day it is switched on; a test payment’s goes to you instead. A letter sent or refused is never sent again by itself. From: ${esc(name ? `${name} <${store.settings.mailFrom}>` : store.settings.mailFrom)}.</p>` : ''}
    ${mailer.key ? `<div class="btns">${ready ? '<button type="button" class="btn" data-do="test-letter">Send a test to me</button>' : ''}<button type="button" class="btn" data-do="forget-key">Forget the key</button></div>` : ''}
    <h3 class="sub">The carrier’s scans</h3>
    ${trackerPart(store, esc, carrierOn, watching)}
    ${refused.length ? `<div class="list" id="ml-refused">${refused.map(({ order: o, rec }) => `<div class="line">
      <span class="nm">⚠ ${esc(letters.find((l) => l.id === rec.id)?.name ?? 'A letter')} to ${esc(o.customer || 'a customer')} was not sent<small>${esc(rec.why ?? '')} · ${esc(stamp(rec.at))}</small></span>
      <span class="amt"><a class="chip sm" href="#mail/order:${esc(o.id)}">Open it</a> <button type="button" class="chip sm" data-do="leave-letter" data-order="${esc(o.id)}" data-v="${esc(rec.id)}" data-at="${esc(rec.at ?? '')}">Leave it</button></span></div>`).join('')}</div>` : ''}`;
}

function trackerPart(store, esc, carrierOn, watching) {
  if (!tracker) return '<p class="note">The program could not say whether a Shippo key is kept. Close War Chief and open it again.</p>';
  const names = carrierOn.map((l) => l.name).join(' and ');
  const why = `Shipped and Delivered wait for the carrier’s own word. War Chief asks for it through your own <b>Shippo</b> account: free to open; Shippo charges 2¢ a tracking number for a label not bought through it, and includes tracking with one that was. It asks about a parcel at most ${GAPS.length} times over about six days, so if Shippo counted every question rather than every number, one parcel would cost at most ${GAPS.length * 2}¢.`;
  if (!tracker.key) {
    return `${carrierOn.length ? `<p class="truth">⚠ ${esc(names)} ${carrierOn.length > 1 ? 'are' : 'is'} switched on, but no Shippo key is kept here, so ${carrierOn.length > 1 ? 'they wait' : 'it waits'} for nothing.</p>` : ''}
      <p class="note">${why}</p>
      ${tracker.safe ? `<div class="row">${cell('Shippo key', secretField('ml-track', 'shippo_live_…', 'off'))}
        <button type="button" class="btn inline" data-do="keep-tracker">Keep</button></div>
      <p class="note">Make it in Shippo’s API settings, under Developer keys: a live key asks about real parcels; a test key answers only Shippo’s test parcels (SHIPPO_TRANSIT, SHIPPO_DELIVERED as the tracking number). War Chief checks the key with Shippo, keeps it on this computer encrypted, and sends it to Shippo and nowhere else. ${outLink('https://portal.goshippo.com/api-config/api', 'Make a key at Shippo', esc, 'chip sm')}</p>`
        : '<p class="truth">⚠ This computer has no safe place to keep a Shippo key.</p>'}`;
  }
  const last = lastAnswer ? `The last answer: ${esc(lastAnswer.order.customer || 'an order')} (${esc(V.orderName(lastAnswer.order))}), ${esc(lastAnswer.why ? 'no answer: ' + lastAnswer.why : lastAnswer.status)}, ${esc(stamp(lastAnswer.at))}.` : '';
  return `${trackBad ? `<p class="truth">⚠ Shippo refused the key: ${esc(trackBad)}. Forget it and keep a new one.</p>` : ''}
    <p class="note">A Shippo ${tracker.test ? '<b>test</b> key is kept: only Shippo’s test parcels answer it' : 'key is kept'}. ${carrierOn.length ? `${esc(names)} ${carrierOn.length > 1 ? 'wait' : 'waits'} for the carrier. Parcels being asked about: ${watching.length}.` : 'No letter that waits for the carrier is switched on, so no parcel is asked about.'} ${last}</p>
    <div class="btns">${carrierOn.length && watching.length ? '<button type="button" class="btn" data-do="check-now">Ask the carriers now</button>' : ''}<button type="button" class="btn" data-do="forget-tracker">Forget the Shippo key</button></div>`;
}

export const station = {
  id: 'mail',
  title: 'Mail',
  commands: () => [{ label: 'Write to a customer', hint: 'Mail', hash: '#mail' }, { label: 'Make an invoice', hint: 'Mail', hash: '#mail' }],
  // the chips at the foot of the program's left bar (public/bos/index.html, sitesOf)
  web: { presets: [...WEBMAIL, SENDER], keys: ['webmail'] },
  // the letters refused, waiting for a person to send again or leave
  badge: (store) => failed(store).length,
  render(el, desk) {
    const store = desk.store;
    const esc = store.esc;
    const ref = store.route.ref ?? '';
    if (desk.fresh && ref.startsWith('order:') && store.resolve(ref)) {
      const o = store.resolve(ref);
      orderId = o.id;
      letterId = defaultLetter(store, o);
      to = emailOf(store, o);
      subject = null; body = null;
    }
    if (desk.fresh && ref.startsWith('person:') && store.resolve(ref)) {
      const p = store.resolve(ref);
      const last = store.data.orders.orders.filter((o) => o.customerId === p.id).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      orderId = last?.id ?? '';
      letterId = last ? defaultLetter(store, last) : 'note';
      to = p.email ?? '';
      subject = null; body = null;
    }
    const orders = store.data.orders.orders.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 80);
    const order = orderId ? store.resolve('order:' + orderId) : null;
    const letters = allLetters(store);
    const letter = letters.find((l) => l.id === letterId) ?? letters[0];
    const tone = toneOf(store);
    const fields = fieldsFor(store, order);
    const subj = subject ?? fill(store, letter.subject, fields);
    const text = body ?? fill(store, toned(letter.body, tone), fields);
    const holes = holesIn(subj + '\n' + text);
    const canSend = desk.program && !!(mailer?.key && store.settings.mailFrom);
    const tries = order ? (order.letters ?? []).slice(-5) : [];
    const trig = triggerOf(store, letter);
    // what is in the boxes now: the person may have typed since the page was drawn (2026-10-06: Copy
    // and Open in your mail sent the letter as first drawn, whatever had been typed over it)
    const now = () => ({ to: to.trim(), subj: subject ?? subj, text: body ?? text });

    el.innerHTML = `
      <h1 class="title">Mail</h1>
      <h2 class="sect">Filed by the address</h2>
      <p class="note">Each channel on the site points at its own address, and mail to that address lands in that bin. Any company can do this: suggestions@yourcompany.com files into Suggestions, orders@yourcompany.com into Orders. Add the addresses you use. A reply written in sentences is not read.</p>
      <div class="list">
        ${(store.settings.mailRoutes ?? []).filter((r) => r && r.addr && r.bin).map((r) => `<div class="line"><span class="nm">${esc(r.bin)}<small>${esc(r.addr)} · A route you added.</small></span><button type="button" class="btn inline" data-do="drop-route" data-v="${esc(r.addr)}">Take off</button></div>`).join('') || '<p class="note">No routes yet. Add one below.</p>'}
      </div>
      <div class="row">
        ${cell('Address', '<input class="f" id="rt-addr" type="email" placeholder="orders@yourcompany.com" autocomplete="off" />')}
        ${cell('Bin', '<input class="f" id="rt-bin" placeholder="Wholesale" maxlength="40" autocomplete="off" />', 'm')}
        <button type="button" class="btn inline" data-do="add-route">Add the route</button>
      </div>
      ${cell('Which order', `<select class="f" id="ml-order">
        <option value="">No order (a general letter)</option>
        ${orders.map((o) => `<option value="${esc(o.id)}"${o.id === orderId ? ' selected' : ''}>${esc(o.customer || 'A customer')} · ${esc(V.orderName(o))} · ${esc(V.statusOf(o))}</option>`).join('')}
      </select>`)}
      <p class="k">How every letter reads</p>
      <div class="chips">${TONES.map((t) => `<button type="button" class="chip${tone === t ? ' on' : ''}" data-do="tone" data-v="${t}" aria-pressed="${tone === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
      ${lettersPart(store, esc, letters, letter, canSend)}
      <div class="btns">
        ${canSend ? `<label class="cell" style="flex:2 1 260px;margin:0"><span class="cap">${esc(letter.name)} sends itself when</span><select class="f" id="ml-when">
          ${TRIGGERS.map((t) => `<option value="${t.id}"${t.id === trig ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>` : ''}
        <button type="button" class="btn" data-do="edit-letter">Change its words</button>
        ${letter.restyled ? '<button type="button" class="btn" data-do="stock-words">Back to the stock words</button>' : ''}
      </div>
      ${editing ? `<div class="card">
        <h3 class="sub" style="margin-top:0">${editing.id ? `The words of ${esc(letter.name)}` : 'A letter of your own'}</h3>
        ${cell('Its name', `<input class="f" id="ed-name" placeholder="Thank you, Reminder…" value="${esc(editing.name)}" />`)}
        ${cell('Subject', `<input class="f" id="ed-subject" value="${esc(editing.subject)}" />`)}
        ${cell('The letter', `<textarea class="f" id="ed-body" style="min-height:200px">${esc(editing.body)}</textarea>`)}
        <p class="note">These fill themselves in from the order: [NAME] [COMPANY] [ORDER] [PRODUCT] [ITEMS] [TOTAL] [TRACKING] [WHEN]. [ITEMS] is the receipt: a line for each thing, then the total and the tax in it.</p>
        <div class="btns"><button type="button" class="btn fill" data-do="save-letter">Keep it</button>
          ${editing.id && !LETTERS.some((L) => L.id === editing.id) ? '<button type="button" class="btn" data-do="drop-letter">Delete it</button>' : ''}
          <button type="button" class="btn" data-do="cancel-letter">Cancel</button></div>
      </div>` : ''}
      ${cell('To', `<input class="f" id="ml-to" type="email" placeholder="Their email" value="${esc(to)}" />`)}
      ${cell('Subject', `<input class="f" id="ml-subject" value="${esc(subj)}" />`)}
      ${cell('The letter', `<textarea class="f" id="ml-body" style="min-height:240px">${esc(text)}</textarea>`)}
      ${holes.length ? `<p class="truth">⚠ Still in brackets: ${holes.map(esc).join(', ')}. ${order ? 'This order does not say it yet; type it in before sending.' : 'Pick an order to fill these in, or type them.'}</p>` : ''}
      <div class="btns">
        ${canSend ? `<button type="button" class="btn fill" data-do="send-letter"${sendingNow ? ' disabled' : ''}>${sendingNow ? 'Sending…' : 'Send it'}</button>` : ''}
        <button type="button" class="btn${canSend ? '' : ' fill'}" data-do="copy-letter">Copy the letter</button>
        <a class="btn" id="ml-mailto" href="${esc(mailtoOf(to, subj, text))}">Open in your mail</a>
      </div>
      ${tries.length ? `<p class="note">For this order: ${tries.map((l) => `${esc(letters.find((x) => x.id === l.id)?.name ?? 'a letter')} ${l.ok ? 'sent to ' + esc(l.to ?? '') : leftBe(order, l) ? 'not sent, left be' : 'not sent'}${l.hand ? ' by hand' : ''}, ${esc(stamp(l.at))}`).join(' · ')}.</p>` : ''}
      ${desk.program ? '' : `<div class="chips">${[...WEBMAIL, ...(store.settings.webmail ?? []).filter((w) => w?.name && /^https:\/\//i.test(w.url ?? ''))].map((w) => outLink(w.url, w.name, esc, 'chip sm')).join('')}</div>`}
      <p class="note">“Open in your mail” starts a new message in this computer’s mail program with all of it filled in. ${desk.program ? 'Webmail opens from the left bar' : 'Webmail opens on its own page'}: copy the letter first, then paste it into a new message there.${desk.program ? (canSend ? '' : ' Once a Resend key and a From address are kept below, each letter has a switch and can send itself.') : ' In the War Chief program each letter can send itself: when an order is paid, its label is bought, the carrier scans it, a job is booked, and more.'}</p>

      ${desk.program ? sendingPart(store, esc, letters) : ''}

      <h2 class="sect">How you sign</h2>
      <div class="row">
        ${cell('Sign-off', `<input class="f" id="ml-sign" placeholder="Your name, or the company" value="${esc(store.settings.signoff ?? '')}" />`)}
        ${cell('Reply address', `<input class="f" id="ml-reply" type="email" placeholder="Optional" value="${esc(store.settings.replyTo ?? '')}" />`)}
        <button type="button" class="btn inline" data-do="save-sign">Keep</button>
      </div>

      <h2 class="sect">Invoice</h2>
      ${order ? `<pre class="letter card" id="ml-invoice">${esc(invoiceText(store, order))}</pre>
        <div class="row">
          ${cell('The line at the bottom', `<input class="f" id="ml-invnote" value="${esc(store.settings.invoiceNote ?? INVOICE_NOTE)}" />`)}
          <button type="button" class="btn inline" data-do="save-invnote">Keep</button>
        </div>
        <div class="btns"><button type="button" class="btn" data-do="copy-invoice">Copy the invoice</button>
          <button type="button" class="btn" data-do="letter" data-v="invoice">Write the invoice letter</button></div>`
        : '<p class="note">Pick an order above and its invoice is drawn here: what, how many, the total and the tax inside it. The Invoice letter carries the same lines.</p>'}

      <p class="note">Posts and your social pages are on <a href="#marketing">Marketing</a>.</p>`;

    el.oninput = (e) => {
      const id = e.target.id;
      if (id === 'ml-to') to = e.target.value;
      else if (id === 'ml-subject') subject = e.target.value;
      else if (id === 'ml-body') body = e.target.value;
      else if (editing && id === 'ed-name') editing.name = e.target.value;
      else if (editing && id === 'ed-subject') editing.subject = e.target.value;
      else if (editing && id === 'ed-body') editing.body = e.target.value;
      if (['ml-to', 'ml-subject', 'ml-body'].includes(id)) {
        const n = now();
        const a = el.querySelector('#ml-mailto');
        if (a) a.href = mailtoOf(n.to, n.subj, n.text);
      }
    };
    el.onchange = (e) => {
      if (e.target.id === 'ml-order') {
        orderId = e.target.value;
        const o = orderId ? store.resolve('order:' + orderId) : null;
        if (o) { letterId = defaultLetter(store, o); to = emailOf(store, o) || to; }
        subject = null; body = null;
        desk.rerender();
      }
      // a new moment for the open letter; switched on, it counts from now, so orders that met the new
      // moment before it was picked get nothing by surprise, and "sent by hand only" switches it off
      if (e.target.id === 'ml-when') {
        const v = e.target.value;
        const stock = LETTERS.find((L) => L.id === letter.id);
        const lw = { ...(store.settings.letterWhen ?? {}) };
        if (v === (stock?.when ?? 'hand')) delete lw[letter.id]; else lw[letter.id] = v;
        const auto = { ...(store.settings.autoLetters ?? {}) };
        if (switchedOn(store, letter.id)) { if (STEPS[v]) auto[letter.id] = new Date().toISOString(); else delete auto[letter.id]; }
        desk.act(() => ({ act: store.conf({ letterWhen: lw, autoLetters: auto }, `${letter.name} waits for: ${triggerLabel(v)}`) }), { keep: true });
        sendOwed(desk);
        checkParcels(desk);
      }
    };
    el.onclick = async (e) => {
      const b = e.target.closest('[data-do]');
      if (!b) return;
      const said = (ok, what) => desk.toast(ok ? 'Copied ' + what : 'Could not copy; select it and copy by hand', { error: !ok });
      switch (b.dataset.do) {
        case 'tone':
          if (b.dataset.v !== tone) desk.act(() => ({ act: store.conf({ tone: b.dataset.v }, 'every letter reads ' + b.dataset.v) }), { keep: true });
          body = null;
          desk.rerender();
          return;
        case 'letter': letterId = b.dataset.v; subject = null; body = null; editing = null; desk.rerender(); el.querySelector('#ml-body')?.scrollIntoView({ block: 'center' }); return;
        case 'copy-letter': { const n = now(); said(await copyText(`${n.subj}\n\n${n.text}`), 'the letter'); return; }
        case 'copy-invoice': said(await copyText(invoiceText(store, order)), 'the invoice'); return;
        case 'new-letter': editing = { name: '', subject: '', body: '[NAME],\n\n\n\n—\n[COMPANY]' }; desk.rerender(); return;
        case 'edit-letter': editing = { id: letter.id, name: letter.name, subject: letter.subject, body: letter.body }; desk.rerender(); return;
        case 'cancel-letter': editing = null; desk.rerender(); return;
        case 'save-letter': {
          if (!String(editing.name).trim()) { desk.toast('Name the letter', { error: true }); return; }
          const id = editing.id ?? 'l-' + Date.now().toString(36);
          const stock = LETTERS.find((L) => L.id === id);
          const mine = (store.settings.letters ?? []).filter((l) => l.id !== id);
          const rec = { id, name: editing.name.trim(), subject: editing.subject, body: editing.body, ...(stock ? {} : { custom: true }) };
          const same = stock && rec.name === stock.name && rec.subject === stock.subject && rec.body === stock.body;
          const r = desk.act(() => ({ act: store.conf({ letters: same ? mine : [...mine, rec] }, (stock ? 'new words for ' : 'kept the letter ') + rec.name) }));
          if (r) { editing = null; letterId = id; subject = null; body = null; desk.rerender(); }
          return;
        }
        case 'drop-letter': {
          const id = editing.id;
          const lw = { ...(store.settings.letterWhen ?? {}) };
          const auto = { ...(store.settings.autoLetters ?? {}) };
          delete lw[id]; delete auto[id];
          const r = desk.act(() => ({ act: store.conf({ letters: (store.settings.letters ?? []).filter((l) => l.id !== id), letterWhen: lw, autoLetters: auto }, 'deleted the letter ' + editing.name) }));
          if (r) { editing = null; letterId = 'in'; desk.rerender(); }
          return;
        }
        case 'stock-words': {
          const r = desk.act(() => ({ act: store.conf({ letters: (store.settings.letters ?? []).filter((l) => l.id !== letter.id) }, `${letter.name} back to the stock words`) }));
          if (r) { editing = null; subject = null; body = null; desk.rerender(); }
          return;
        }
        case 'save-sign':
          desk.act(() => ({ act: store.conf({ signoff: el.querySelector('#ml-sign').value.trim(), replyTo: el.querySelector('#ml-reply').value.trim() }, 'how you sign') }));
          body = null;
          desk.rerender();
          return;
        case 'add-route': {
          const addr = el.querySelector('#rt-addr').value.trim().toLowerCase();
          const bin = el.querySelector('#rt-bin').value.trim();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) { desk.toast('That needs to be an email address', { error: true }); return; }
          if (!bin) { desk.toast('Name the bin', { error: true }); return; }
          const cur = (store.settings.mailRoutes ?? []).filter((r) => r?.addr !== addr);
          desk.act(() => ({ act: store.conf({ mailRoutes: [...cur, { addr, bin: bin.slice(0, 40) }] }, 'a route for ' + addr) }));
          return;
        }
        case 'drop-route':
          desk.act(() => ({ act: store.conf({ mailRoutes: (store.settings.mailRoutes ?? []).filter((r) => r?.addr !== d.v) }, 'took a route off') }));
          return;
        case 'save-invnote': desk.act(() => ({ act: store.conf({ invoiceNote: el.querySelector('#ml-invnote').value }, 'the invoice’s last line') })); return;
        // --- the program: sending from the desk ---------------------------------------------------
        case 'send-letter': {
          const n = now();
          if (sendingNow) return;
          const left = holesIn(n.subj + '\n' + n.text);
          if (left.length) { desk.toast(`Fill in ${left.join(', ')} before sending`, { error: true }); return; }
          if (!ADDRESS.test(n.to)) { desk.toast('Type the one email address it goes to', { error: true }); return; }
          sendingNow = true;
          desk.rerender();
          const res = await post(store, { to: n.to, subject: n.subj, text: n.text });
          sendingNow = false;
          const o = orderId ? store.resolve('order:' + orderId) : null;
          if (res.ok) { subject = null; body = null; }
          if (o) record(desk, o, letter.id, { name: letter.name, to: n.to }, res, true);
          else { desk.rerender(); desk.toast(res.ok ? `Sent to ${n.to}` : 'Not sent: ' + res.why, { error: !res.ok }); }
          return;
        }
        case 'keep-mailer': {
          const from = (el.querySelector('#ml-from')?.value ?? '').trim();
          const key = (el.querySelector('#ml-key')?.value ?? '').trim();
          if (from && !ADDRESS.test(from)) { desk.toast('The From address is not an email address', { error: true }); return; }
          if (key) {
            try { mailer = await call('/_/mail/key', { key }); } catch (err) { desk.toast('The key was not kept: ' + err.message, { error: true }); return; }
          }
          if (from !== String(store.settings.mailFrom ?? '')) desk.act(() => ({ act: store.conf({ mailFrom: from }, from ? 'letters go from ' + from : 'no From address') }), { keep: true });
          else desk.rerender();
          if (key) desk.toast(store.settings.mailFrom ? 'The key is kept on this computer. Switch a letter on, or send a test to yourself.' : 'The key is kept on this computer. Type the From address and Keep it.');
          return;
        }
        case 'forget-key': {
          try { mailer = await call('/_/mail/key', { key: '' }); } catch (err) { desk.toast('The key was not forgotten: ' + err.message, { error: true }); return; }
          // no key, no letters: every switch goes off with it, so a key kept later sends nothing old by surprise
          if (Object.keys(store.settings.autoLetters ?? {}).length) desk.act(() => ({ act: store.conf({ autoLetters: {} }, 'forgot the Resend key; every letter off') }));
          else { desk.rerender(); desk.toast('The Resend key is gone from this computer'); }
          return;
        }
        case 'auto': {
          const L = letters.find((x) => x.id === b.dataset.v);
          if (!L || !sendsItself(store, L)) return;
          const cur = { ...(store.settings.autoLetters ?? {}) };
          if (switchedOn(store, L.id)) delete cur[L.id]; else cur[L.id] = new Date().toISOString();
          desk.act(() => ({ act: store.conf({ autoLetters: cur }, `${L.name} sends itself: ${cur[L.id] ? 'on' : 'off'}`) }), { keep: true });
          sendOwed(desk);
          checkParcels(desk);
          return;
        }
        case 'test-letter': {
          const own = String(store.settings.replyTo || store.settings.mailFrom || '').trim();
          const res = await post(store, { to: own, subject: 'TEST: War Chief can send your letters', text: fill(store, 'This is a test from War Chief.\n\nIf it reached you, Resend took a letter from your domain, and your letters can send themselves.\n\n—\n[COMPANY]', fieldsFor(store, null)) });
          desk.toast(res.ok ? `Resend took the test letter: look for it at ${own}` : 'The test was not sent: ' + res.why, { error: !res.ok });
          return;
        }
        case 'keep-tracker': {
          const key = (el.querySelector('#ml-track')?.value ?? '').trim();
          if (!key) { desk.toast('Paste the Shippo key first', { error: true }); return; }
          try { tracker = await call('/_/track/key', { key }); } catch (err) { desk.toast('The Shippo key was not kept: ' + err.message, { error: true }); return; }
          trackBad = '';
          desk.rerender();
          desk.toast(tracker.test ? 'Shippo knows the key: a test key, so only its test parcels answer' : 'Shippo knows the key. It is kept on this computer.');
          checkParcels(desk);
          return;
        }
        case 'forget-tracker': {
          try { tracker = await call('/_/track/key', { key: '' }); } catch (err) { desk.toast('The Shippo key was not forgotten: ' + err.message, { error: true }); return; }
          trackBad = '';
          desk.rerender();
          desk.toast('The Shippo key is gone from this computer');
          return;
        }
        case 'check-now': {
          const n = parcelsDue(store, Date.now(), tracker?.unit || HOUR, true).length;
          desk.toast(`Asking the carrier about ${n} parcel${n === 1 ? '' : 's'}`);
          await checkParcels(desk, true);
          return;
        }
        case 'leave-letter': {
          const o = store.resolve('order:' + b.dataset.order);
          if (!o) return;
          desk.act(() => ({ act: store.write(`left ${o.customer || 'a customer'}’s letter unsent`, leaveOps(o.id, { id: b.dataset.v, at: b.dataset.at })) }), { keep: true });
        }
      }
    };
  },
};
