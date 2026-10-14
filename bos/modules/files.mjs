// files — what a dropped file says, read without a server. Pure and Node-importable; the Books
// station hands it the file's text and name and gets back lines it can show and book.
//
// Three kinds are told apart by what is inside them, never by the file's name:
//   money       a bank's CSV, PayPal's activity CSV, or a bank's OFX / QFX / QBO download
//               (the format every US bank's "download for Quicken or QuickBooks" button writes)
//   shipments   a label service's export: a row per label, with its tracking number and cost
//   unknown     anything else, said out loud with the first line it found
//
// Nothing is dropped silently: a row that cannot be read comes back in `unreadable`, and a PayPal
// row that is not a completed payment comes back in `skipped` with its status.
//
// ⚠ The shipments reader is tolerant on purpose. No real label-service export has been read from
// this desk's side, so its column names are matched by the words such files commonly use (tracking,
// cost or postage, order, recipient) rather than by one service's exact header. The first real
// export dropped on Books settles it: the screen lists every row it could not tie to an order.

export function fingerprintOf(date, amount, payee) {
  return `${date}|${Math.abs(Number(amount)).toFixed(2)}|${String(payee ?? '').trim()}`;
}

// The fingerprints already on the books: the stored tag, and for entries written before the tag
// existed, the same three fields read off the entry itself.
export function seenFingerprints(store) {
  const seen = new Set();
  for (const e of store.data.ledger.entries) {
    if (e?.tags?.fingerprint) { seen.add(e.tags.fingerprint); continue; }
    const paid = (e.postings ?? []).reduce((s, p) => s + (p.amount > 0 ? p.amount : 0), 0);
    seen.add(fingerprintOf(e.date, paid, e.tags?.payee ?? e.desc));
  }
  return seen;
}

const round2 = (n) => Math.round(n * 100) / 100;

// A real CSV reader: quoted fields, embedded commas and newlines, doubled quotes, CRLF, a BOM. A
// file whose first line holds more tabs than commas is read as tab-separated: that is what a .tsv
// file is, and what a table becomes when it is dragged or copied out of a web page.
export function csvRows(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  const nl = s.search(/[\r\n]/);
  const head = nl < 0 ? s : s.slice(0, nl);
  const sep = head.split('\t').length > head.split(',').length ? '\t' : ',';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export function isoDate(raw) {
  const t = String(raw ?? '').trim().replace(/\s.*$/, '');
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(t);
  if (m) return `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = /^(\d{4})(\d{2})(\d{2})/.exec(t); // OFX: 20261001120000[-5:EST]
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export function parseAmount(raw) {
  const t = String(raw ?? '').replace(/[$"\s]/g, '').replace(/,/g, '');
  if (t === '' || !/^[-+]?\(?\d+(\.\d+)?\)?$/.test(t)) return null;
  const neg = t.startsWith('(') && t.endsWith(')');
  const n = Number(t.replace(/[()+]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const norm = (h) => String(h ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const findCol = (header, names) => {
  const keys = header.map(norm);
  for (const n of names) {
    const i = keys.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
};

// --- money: a bank's CSV or PayPal's --------------------------------------------------------
function moneyCsv(rows) {
  const header = rows[0];
  const col = {
    date: findCol(header, ['date', 'posted date', 'posting date', 'transaction date', 'trans date', 'post date']),
    amount: findCol(header, ['net', 'amount', 'transaction amount']),
    gross: findCol(header, ['gross']),
    fee: findCol(header, ['fee']),
    debit: findCol(header, ['debit', 'withdrawal', 'withdrawals', 'money out']),
    credit: findCol(header, ['credit', 'deposit', 'deposits', 'money in']),
    payee: findCol(header, ['name', 'payee', 'description', 'merchant', 'details', 'memo']),
    status: findCol(header, ['status']),
    type: findCol(header, ['type']),
  };
  if (col.amount < 0 && col.gross >= 0) col.amount = col.gross;
  if (col.date < 0 || (col.amount < 0 && col.debit < 0 && col.credit < 0)) return null;
  const paypal = col.gross >= 0 && col.fee >= 0 && findCol(header, ['net']) >= 0;
  const source = paypal ? 'paypal' : 'bank';
  const lines = [], unreadable = [], skipped = [];
  for (const r of rows.slice(1)) {
    const status = col.status >= 0 ? String(r[col.status] ?? '').trim() : '';
    if (paypal && status && !/^completed$/i.test(status)) {
      skipped.push(`${r[col.date] ?? ''} ${r[col.payee] ?? ''} (${status})`);
      continue;
    }
    const date = isoDate(r[col.date]);
    let amount = col.amount >= 0 ? parseAmount(r[col.amount]) : null;
    if (amount === null && (col.debit >= 0 || col.credit >= 0)) {
      const d = col.debit >= 0 ? parseAmount(r[col.debit]) : null;
      const c = col.credit >= 0 ? parseAmount(r[col.credit]) : null;
      if (d) amount = -Math.abs(d); else if (c) amount = Math.abs(c);
    }
    let payee = col.payee >= 0 ? String(r[col.payee] ?? '').trim() : '';
    if (!payee && col.type >= 0) payee = String(r[col.type] ?? '').trim();
    payee = payee || 'Unknown';
    if (date === null || amount === null || amount === 0) {
      unreadable.push(r.join(','));
      continue;
    }
    const ln = { date, amount: round2(amount), payee, source, fingerprint: fingerprintOf(date, amount, payee) };
    if (paypal) {
      const gross = parseAmount(r[col.gross]);
      const fee = parseAmount(r[col.fee]) ?? 0;
      // only when the three agree to the cent; a malformed fee degrades to the plain amount
      if (gross !== null && fee !== 0 && Math.abs(gross + fee - amount) < 0.005) {
        ln.gross = round2(gross);
        ln.fee = round2(fee);
      }
    }
    lines.push(ln);
  }
  return { kind: 'money', source, lines, unreadable, skipped };
}

// --- money: OFX, QFX and QBO, the format a bank's Quicken / QuickBooks download writes ---------
// Old OFX is SGML (a field's closing tag may be missing), newer OFX is XML; one reader takes both
// by reading each field up to the next tag.
function ofxMoney(text) {
  const blocks = String(text).split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);
  if (!blocks.length) return null;
  const field = (b, tag) => {
    const m = new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i').exec(b);
    return m ? m[1].trim() : '';
  };
  const lines = [], unreadable = [];
  for (const b of blocks) {
    const date = isoDate(field(b, 'DTPOSTED'));
    const amount = parseAmount(field(b, 'TRNAMT'));
    const payee = (field(b, 'NAME') || field(b, 'MEMO') || 'Unknown').replace(/&amp;/g, '&');
    const fitid = field(b, 'FITID');
    if (date === null || amount === null || amount === 0) {
      unreadable.push(b.replace(/\s+/g, ' ').trim().slice(0, 160));
      continue;
    }
    lines.push({ date, amount: round2(amount), payee, source: 'bank',
      fingerprint: fitid ? 'ofx:' + fitid : fingerprintOf(date, amount, payee) });
  }
  return { kind: 'money', source: 'bank', lines, unreadable, skipped: [] };
}

// --- shipments: one row per label ------------------------------------------------------------
function shipmentsCsv(rows) {
  const header = rows[0];
  const col = {
    tracking: findCol(header, ['tracking number', 'tracking', 'tracking no', 'tracking code']),
    cost: findCol(header, ['cost', 'postage', 'total', 'label cost', 'price', 'rate', 'amount']),
    order: findCol(header, ['order id', 'order number', 'order', 'reference', 'order ref']),
    recipient: findCol(header, ['recipient', 'name', 'ship to name', 'to name', 'recipient name']),
    carrier: findCol(header, ['carrier', 'service', 'provider']),
    date: findCol(header, ['created date', 'date', 'ship date', 'created']),
  };
  if (col.tracking < 0 || col.cost < 0) return null;
  const lines = [], unreadable = [];
  for (const r of rows.slice(1)) {
    const tracking = String(r[col.tracking] ?? '').trim();
    const cost = parseAmount(r[col.cost]);
    if (!tracking || cost === null) {
      unreadable.push(r.join(','));
      continue;
    }
    lines.push({
      tracking, cost: round2(Math.abs(cost)),
      order: col.order >= 0 ? String(r[col.order] ?? '').trim() : '',
      recipient: col.recipient >= 0 ? String(r[col.recipient] ?? '').trim() : '',
      carrier: col.carrier >= 0 ? String(r[col.carrier] ?? '').trim() : '',
      date: col.date >= 0 ? isoDate(r[col.date]) : null,
    });
  }
  return { kind: 'shipments', source: 'shipments', lines, unreadable, skipped: [] };
}

// The one entry point: what is this file, and what does it say?
export function readFile(text, name = '') {
  const t = String(text ?? '');
  if (/<OFX>|<STMTTRN>|OFXHEADER/i.test(t) || /\.(ofx|qfx|qbo)$/i.test(name)) {
    const r = ofxMoney(t);
    if (r) return r;
  }
  const rows = csvRows(t);
  if (rows.length >= 1) {
    // PayPal's activity file is money even if it ever carries a tracking column
    const h = rows[0].map(norm);
    const paypal = ['gross', 'fee', 'net'].every((k) => h.includes(k));
    const ship = paypal ? null : shipmentsCsv(rows);
    if (ship) return ship;
    const money = moneyCsv(rows);
    if (money) return money;
  }
  const first = t.split(/\r?\n/).find((l) => l.trim()) ?? '';
  return { kind: 'unknown', source: null, lines: [], unreadable: [], skipped: [], first: first.slice(0, 160) };
}

// --- a piece of a web page dropped on the desk ------------------------------------------------
// What a person drags out of a web page is text: a table's rows, a label's receipt, one line of a
// bank's activity. Matt, 2026-10-04 01:53Z: "if you print on pirate ship you can drop that to the
// right and it updates your business desk with that info of the amount and date". Nothing read
// here is booked by itself: the desk shows what it read and one tap books it, so a misread is
// seen before it lands.
//
//   a table with a header row   read exactly as the same rows in a file would be (money, shipments)
//   a label                     a tracking number, with the dollar amounts beside it
//   money                       one transaction: its dollar amounts, its date, the words around them
//   receipt                     a supplier's order: its bought lines, their prices, shipping, tax, total
//   link                        a web address alone: where a material can be bought
//   unknown                     nothing to book, said with the reason

// USPS's printed tracking number, read at source on 2026-10-04 from USPS-2000508 Rev E (the
// Intelligent Mail package barcode specification, 2011-12-29): it starts with a channel
// identifier 91 to 95, is 22 digits (26 in the one construct with a 6-digit mailer ID and no ZIP
// Code), and ends in a check digit whose rule is the specification's Appendix E, worked here. A
// run of digits that fails the check is not taken for a USPS number.
export function uspsCheckOk(digits) {
  const d = String(digits ?? '');
  if (!/^9[1-5]\d{20}(\d{4})?$/.test(d)) return false;
  let even = 0, odd = 0;
  // positions count from the right: 1 is the check digit, 2 the digit before it
  for (let pos = 2; pos <= d.length; pos++) {
    const n = Number(d[d.length - pos]);
    if (pos % 2 === 0) even += n; else odd += n;
  }
  return (10 - ((even * 3 + odd) % 10)) % 10 === Number(d[d.length - 1]);
}

const CARRIER_WORDS = [['USPS', /\busps\b/i], ['UPS', /\bups\b/i], ['FedEx', /\bfed ?ex\b/i], ['DHL', /\bdhl\b/i]];

// The tracking number in a piece of text, strongest evidence first: a USPS number that passes its
// check digit; a UPS number (1Z and 16 letters or digits — ⚠ UPS's own pages refused this
// container, so that shape comes from search summaries of ups.com, not from a page read at
// source; the order's form shows it before anything is booked); else whatever follows the word
// "tracking", when it holds at least eight digits.
export function trackingIn(text) {
  const t = String(text ?? '');
  for (const m of t.matchAll(/(?<![\dA-Za-z])9[1-5](?:[ \u00a0]?\d){20}(?:(?:[ \u00a0]?\d){4})?(?!\d)/g)) {
    const d = m[0].replace(/\D/g, '');
    for (const c of [d, d.slice(0, 22)]) if (uspsCheckOk(c)) return { number: c, carrier: 'USPS' };
  }
  const ups = /(?<![\dA-Za-z])1Z(?:[ \u00a0]?[0-9A-Z]){16}(?![0-9A-Za-z])/i.exec(t);
  if (ups) return { number: ups[0].replace(/[ \u00a0]/g, '').toUpperCase(), carrier: 'UPS' };
  for (const m of t.matchAll(/tracking(?:\s*(?:number|no\.?|num|#|id|code))?\s*[:#]?/gi)) {
    // the number after the word: groups of capitals and digits, stopping at the first lowercase word
    const after = /^\s*((?:[0-9A-Z]+(?![0-9A-Za-z])[ \u00a0]?)+)/.exec(t.slice(m.index + m[0].length, m.index + m[0].length + 60));
    const token = after ? after[1].replace(/[ \u00a0]/g, '') : '';
    if ((token.match(/\d/g) ?? []).length >= 8) {
      return { number: token, carrier: CARRIER_WORDS.find(([, re]) => re.test(t))?.[0] ?? '' };
    }
  }
  return null;
}

// Dollar amounts: a $ before the digits or exactly two decimals after them, never a piece of a
// date, a phone number or a longer number, never a weight or a size. The sign is kept only where
// the text says it: a minus, a plus, or brackets around the amount.
export function amountsIn(text) {
  const t = String(text ?? '');
  const out = [];
  const re = /(?<![\w.\/$-])([-\u2212+])?(\()?(\$)?([-\u2212])?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?(\))?(?![\w.\/]|,\d)/g;
  for (const m of t.matchAll(re)) {
    if (!m[3] && !m[6]) continue;
    if (/^\s?(lbs?|oz|kg|g|in|cm|mm|ft|%|")(?![a-z])/i.test(t.slice(m.index + m[0].length))) continue;
    const abs = Math.round(Number((m[5] + (m[6] ?? '')).replace(/,/g, '')) * 100) / 100;
    if (!(abs > 0)) continue;
    const minus = /[-\u2212]/.test(m[1] ?? '') || /[-\u2212]/.test(m[4] ?? '') || (!!m[2] && !!m[7]);
    const plus = m[1] === '+';
    out.push({ abs, dir: minus ? 'out' : plus ? 'in' : null, at: m.index, raw: m[0] });
  }
  return out;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const pad = (n) => String(n).padStart(2, '0');
const realDay = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

// Dates in a piece of text, in the order they appear: 2026-10-03, 10/3/2026, 10/3/26, Oct 3, 2026,
// October 3 2026, 3 Oct 2026, and Oct 3 with no year, which is read as the latest such day on or
// before `today` (a page of activity shows days just past).
export function datesIn(text, today = localToday()) {
  const t = String(text ?? '');
  const found = [];
  const add = (at, iso) => { if (iso) found.push({ at, iso }); };
  for (const m of t.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) add(m.index, realDay(+m[1], +m[2], +m[3]));
  for (const m of t.matchAll(/(?<![\d\/])(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?![\d\/])/g)) add(m.index, realDay(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]));
  const year = (mo, d, y) => {
    if (y) return realDay(+y, mo, d);
    const ty = Number(String(today).slice(0, 4));
    const iso = realDay(ty, mo, d);
    return iso && iso > today ? realDay(ty - 1, mo, d) : iso;
  };
  const mon = (w) => MONTHS.indexOf(w.slice(0, 3).toLowerCase()) + 1;
  for (const m of t.matchAll(new RegExp('(?<![a-z])' + MONTH_RE + '\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?![\\d:])', 'gi'))) add(m.index, year(mon(m[1]), +m[2], m[3]));
  for (const m of t.matchAll(new RegExp('(?<![\\d/])(\\d{1,2})\\s+' + MONTH_RE + ',?\\s+(\\d{4})(?!\\d)', 'gi'))) add(m.index, year(mon(m[2]), +m[1], m[3]));
  return found.sort((a, b) => a.at - b.at).map((f) => f.iso);
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A dropped money line is settled once its amount and its direction are both known: then it has
// a signed amount and a fingerprint, like a line from a file.
export function settleDropLine(ln) {
  ln.amount = ln.abs != null && ln.dir ? (ln.dir === 'out' ? -ln.abs : ln.abs) : null;
  ln.fingerprint = ln.amount === null ? null : fingerprintOf(ln.date, ln.amount, ln.payee);
  return ln;
}

// the words of one transaction once its dates and amounts are taken out
const wordsOf = (text, amounts) => {
  let t = String(text);
  for (const a of [...amounts].sort((x, y) => y.at - x.at)) t = t.slice(0, a.at) + ' ' + t.slice(a.at + a.raw.length);
  t = t.replace(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)|(?<![\d\/])\d{1,2}\/\d{1,2}\/\d{2,4}(?![\d\/])/g, ' ')
    .replace(new RegExp('(?<![a-z])' + MONTH_RE + '\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?(?![\\d:])', 'gi'), ' ');
  return t.replace(/\s+/g, ' ').replace(/^[\s,;:|·•-]+|[\s,;:|·•-]+$/g, '').slice(0, 80);
};

function moneyLine(text, today) {
  const amounts = amountsIn(text);
  const picks = [];
  for (const a of amounts) if (!picks.some((p) => p.abs === a.abs && p.dir === a.dir)) picks.push({ abs: a.abs, dir: a.dir });
  const one = picks.length === 1 ? picks[0] : null;
  return settleDropLine({
    date: datesIn(text, today)[0] ?? today,
    payee: wordsOf(text, amounts) || 'Unknown',
    source: 'drop',
    abs: one ? one.abs : null,
    dir: one ? one.dir : null,
    picks: one ? [] : picks,
  });
}

// --- an order receipt dropped on the desk ----------------------------------------------------
// A supplier's order page or confirmation email, dragged onto the desk (Matt, 2026-10-04 20:47Z: "I
// can drag and drop my order receipt with the price and website and the inventory and ledger
// inventory supply is added ledger money is subtracted"). The reader only reads: Inventory ties
// each line to a material on file, and nothing is bought until Buy is pressed, so a misread is on
// screen before it is booked.
//
// A line that starts with a summary word (Subtotal, Shipping, Tax, Discount, Total …) is read by
// that word. Every other line that carries an amount is a bought line, and so is a name followed
// by a line that is only an amount (the shape a confirmation email's table takes when it is copied
// as text). Lines about the order (sold by, condition, ship to) are passed over, and a line with an
// amount that is neither comes back in `unread`, so nothing is dropped without being said.
//
// ⚠ No real receipt has been read here yet: the shapes below are the common ones (a store's order
// email, a marketplace's order page, an invoice table) written out by hand. The first real receipt
// from each supplier is its test; the form shows what was read before anything is booked.
const RECEIPT_WORDS = /\b(sub-?\s?total|order\s+(?:total|summary|number|no\.?|#|placed|confirmation|details)|grand\s+total|receipt|invoice|items?\s+subtotal|total\s+(?:paid|charged)|amount\s+(?:paid|charged)|thank you for your (?:order|purchase))\b/i;
const SUMMARY = [
  ['subtotal', /^(?:items?(?:\(s\))?\s*|merchandise\s+)?sub-?\s?total\b/i],
  ['beforeTax', /^total\s+before\s+tax\b/i],
  ['shipping', /^(?:shipping|delivery|freight|postage|handling)(?:\s*(?:&|and)\s*handling)?\b/i],
  ['tax', /^(?:estimated\s+)?(?:sales\s+)?(?:tax(?:es)?|vat|gst|hst)\b/i],
  ['discount', /^(?:discounts?|coupons?|promo(?:tion)?s?|savings|you saved|gift\s+card|store\s+credit|rewards?)\b/i],
  ['fee', /^(?:fees?|service\s+fee|processing\s+fee|tip|surcharge|shipping\s+protection|insurance)\b/i],
  ['total', /^(?:grand\s+total|order\s+total|total\s+(?:paid|charged)|amount\s+(?:paid|charged)|total)\b/i],
  ['paidWith', /^(?:paid\s+with|payment(?:\s+method)?|visa|mastercard|amex|american express|discover|paypal|card ending)\b/i],
];
const NOT_ITEM = /^(?:order\b|order\s*#|ordered\b|placed\b|date\b|sold by|shipped by|condition|ship(?:ping)?\s+to|bill(?:ing)?\s+to|deliver(?:y|ed)\s+to|arriving|estimated delivery|return|qty\b|quantity\b|price\b|product\b|item\b|description\b|sku\b|your\s+order|thank you|questions?|contact|view\s+order|track)/i;
const QTY = [
  /[×x]\s*(\d{1,4})\b/i,                 // "Beeswax × 2", "Beeswax x 2"
  /\b(?:qty|quantity)\s*[:.]?\s*(\d{1,4})\b/i,
  /^\s*(\d{1,4})\s+of:/i,                 // "2 of: Coconut oil"
  /^\s*(\d{1,4})\s*[×x]\s+/i,            // "2 x Beeswax"
];
const HOST = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|co|us|shop|store|biz|info|io|ca|uk))\b/gi;
// a pack size in the words, in the desk's own unit words ("1 lb", "54 Fl Oz", "2oz", "1 gal")
const SIZE = /(\d+(?:\.\d+)?)\s*-?\s*(fl\.?\s?oz|floz|oz|lbs?|pounds?|kg|kilograms?|grams?|g|ml|millilit(?:er|re)s?|lit(?:er|re)s?|l|gal(?:lon)?s?|qt|quarts?|pt|pints?)(?![a-z])/i;
const SIZE_UNIT = [[/^fl/i, 'floz'], [/^oz/i, 'oz'], [/^(lb|pound)/i, 'lb'], [/^(kg|kilo)/i, 'kg'], [/^(g|gram)/i, 'g'],
  [/^(ml|milli)/i, 'ml'], [/^(l|lit)/i, 'l'], [/^gal/i, 'gal'], [/^(qt|quart)/i, 'qt'], [/^(pt|pint)/i, 'pt']];

export function sizeIn(words) {
  const m = SIZE.exec(String(words ?? ''));
  if (!m) return null;
  const unit = SIZE_UNIT.find(([re]) => re.test(m[2].replace(/\s/g, '')))?.[1];
  return unit && Number(m[1]) > 0 ? { n: Number(m[1]), unit } : null;
}

function qtyOf(text) {
  for (const re of QTY) {
    const m = re.exec(text);
    if (m) return { qty: Number(m[1]), cut: m[0] };
  }
  return { qty: null, cut: '' };
}

const itemWords = (line, amounts, cut) => {
  let t = line;
  for (const a of [...amounts].sort((x, y) => y.at - x.at)) t = t.slice(0, a.at) + ' ' + t.slice(a.at + a.raw.length);
  if (cut) t = t.replace(cut, ' ');
  return t.replace(/\bUSD\b/g, ' ').replace(/[\t|]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,;:·•\-–—]+|[\s,;:·•\-–—]+$/g, '').trim();
};

export function readReceipt(text, { today = localToday() } = {}) {
  const t = String(text ?? '').replace(/ /g, ' ').replace(/\r/g, '');
  if (!RECEIPT_WORDS.test(t)) return null;
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const sums = {};
  const items = [];
  const unread = [];
  let pendingName = null; // a name line waiting for the price line under it
  let pendingQty = null;  // a "Qty: 2" line between that name and its price
  const amountOnly = (l, am) => am.length === 1 && itemWords(l, am, '') === '';
  const item = (words, qty, price, raw) => items.push({ words, qty, price, size: sizeIn(words), raw });
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const am = amountsIn(l);
    const kind = SUMMARY.find(([, re]) => re.test(l))?.[0];
    if (kind) {
      // its amount sits on this line, or alone on the next one
      let a = am.length ? am[am.length - 1] : null;
      if (!a && lines[i + 1] && amountOnly(lines[i + 1], amountsIn(lines[i + 1]))) { a = amountsIn(lines[i + 1])[0]; i++; }
      if (a && sums[kind] === undefined) sums[kind] = a.abs;
      if (kind === 'shipping' && /\bfree\b/i.test(l) && sums.shipping === undefined) sums.shipping = 0;
      pendingName = null;
      continue;
    }
    if (!am.length) {
      const qline = /^(?:qty|quantity)\s*[:.]?\s*(\d{1,4})$/i.exec(l);
      if (qline) { if (pendingName) pendingQty = Number(qline[1]); continue; }
      if (NOT_ITEM.test(l)) continue;
      pendingName = l.length > 140 ? null : l;
      pendingQty = null;
      continue;
    }
    if (amountOnly(l, am)) {
      if (pendingName) {
        const q = qtyOf(pendingName);
        item(itemWords(pendingName, [], q.cut), q.qty ?? pendingQty, am[0].abs, pendingName + ' · ' + l);
        pendingName = null;
        pendingQty = null;
      } else unread.push(l);
      continue;
    }
    pendingName = null;
    if (NOT_ITEM.test(l)) { unread.push(l); continue; }
    const q = qtyOf(l);
    // a table row "name <tab> 2 <tab> $12.00 <tab> $24.00": the quantity is the one bare number cell
    let qty = q.qty;
    if (qty === null && /\t/.test(l)) {
      const bare = l.split('\t').map((c) => c.trim()).filter((c) => /^\d{1,4}$/.test(c));
      if (bare.length === 1) qty = Number(bare[0]);
    }
    // two amounts: the each price and the line's total, when one is the quantity times the other
    let price = am[am.length - 1].abs;
    if (am.length >= 2) {
      const [a, b] = [am[am.length - 2].abs, am[am.length - 1].abs];
      if (qty && Math.abs(a * qty - b) < 0.011) price = b;
      else if (qty && Math.abs(b * qty - a) < 0.011) price = a;
      else price = Math.max(a, b);
    }
    const bareCut = l.replace(/\t\s*\d{1,4}\s*(?=\t|$)/, '\t');
    const words = itemWords(bareCut, amountsIn(bareCut), q.cut);
    if (!words) { unread.push(l); continue; }
    item(words, qty, price, l);
  }
  if (!items.length) return null;
  const hosts = [...new Set([...t.matchAll(HOST)].map((m) => m[1].toLowerCase().replace(/^www\./, '')))];
  const date = datesIn(t, today).find((d) => d <= today) ?? null;
  const itemsSum = Math.round(items.reduce((s, x) => s + x.price, 0) * 100) / 100;
  const total = sums.total ?? null;
  // does it add up: the lines, shipping, tax and fees, less discounts, against the total
  const expect = Math.round((itemsSum + (sums.shipping ?? 0) + (sums.tax ?? 0) + (sums.fee ?? 0) - (sums.discount ?? 0)) * 100) / 100;
  const gap = total === null ? null : Math.round((total - expect) * 100) / 100;
  return { kind: 'receipt', items, ...sums, total, itemsSum, gap, hosts, date, unread, text: t };
}

export function readDropped(text, { today = localToday() } = {}) {
  const t = String(text ?? '').replace(/\u00a0/g, ' ').trim();
  const none = (why) => ({ kind: 'unknown', source: null, lines: [], unreadable: [], skipped: [], why, first: (t.split(/\r?\n/).find((l) => l.trim()) ?? '').slice(0, 160) });
  if (!t) return none('it was empty');
  // a link alone: where a material can be bought (a supplier's product page)
  if (/^https?:\/\/\S+$/i.test(t)) {
    let host = '';
    try { host = new URL(t).hostname.replace(/^www\./, '').toLowerCase(); } catch {}
    if (host) return { kind: 'link', url: t, host };
  }
  // rows under a header, as from a bank's or a label service's page
  if (/\r?\n/.test(t)) {
    const table = readFile(t, 'dropped.txt');
    if (table.kind !== 'unknown' && table.lines.length) return { ...table, source: table.source === 'shipments' ? 'shipments' : 'drop' };
  }
  const tracking = trackingIn(t);
  if (tracking) {
    const amounts = amountsIn(t);
    const picks = [...new Set(amounts.map((a) => a.abs))];
    // more than one amount (a retail price beside the price paid): the one a cost word stands
    // in front of on its own line, else nobody guesses and the desk asks
    const worded = amounts.filter((a) => /(cost|paid|total|postage|charged|price|amount|rate)\b[^$\d\n]{0,14}$/i.test(t.slice(Math.max(0, a.at - 26), a.at)));
    const cost = picks.length === 1 ? picks[0] : new Set(worded.map((a) => a.abs)).size === 1 ? worded[0].abs : null;
    // the day it was bought: the one date the words carry, unless it is still to come (a delivery
    // estimate); two different dates, or none, leave it to the day it is booked
    const days = [...new Set(datesIn(t, today))];
    const date = days.length === 1 && days[0] <= today ? days[0] : null;
    return { kind: 'label', tracking: tracking.number, carrier: tracking.carrier, cost, amounts: picks, date, text: t };
  }
  // a supplier's receipt: bought lines and a total, read for Inventory's Buy form
  const receipt = readReceipt(t, { today });
  if (receipt) return receipt;
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  // several rows that each carry a date and one amount are several transactions; anything else
  // is one transaction, however many lines it spans
  const rows = lines.filter((l) => amountsIn(l).length === 1 && datesIn(l, today).length);
  if (rows.length >= 2 && rows.length === lines.filter((l) => amountsIn(l).length).length) {
    return { kind: 'money', source: 'drop', lines: rows.map((l) => moneyLine(l, today)), unreadable: [], skipped: [] };
  }
  if (lines.length > 1 && lines.filter((l) => amountsIn(l).length && datesIn(l, today).length).length >= 2) {
    return none('it has several rows with more than one amount each and no header row; drag the header row with them, or download the activity file and drop that');
  }
  if (!amountsIn(t).length) return none('it holds no tracking number and no dollar amount');
  return { kind: 'money', source: 'drop', lines: [moneyLine(t, today)], unreadable: [], skipped: [] };
}

// A PayPal payment notice (IPN, Instant Payment Notification): the form PayPal posted to the War
// Chief's inbox, already decoded to { field: value } by the warchief-ipn function. What the desk
// needs from it, and nothing invented: the lines as PayPal named them, the money as PayPal split
// it (the whole payment, its fee, the tax and shipping it charged), who paid and where it ships.
// Field names are PayPal's (developer.paypal.com/api/nvp-soap/ipn/IPNandPDTVariables, read
// 2026-10-04): a cart numbers its lines item_name1, quantity1, mc_gross_1; one item has none.
export function readIpn(f) {
  const s = (k) => String(f?.[k] ?? '').replace(/\r\n?/g, '\n').trim();
  const amt = (k) => { const v = s(k); if (v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  let count = Number(s('num_cart_items')) || 0;
  for (const k of Object.keys(f ?? {})) {
    const m = /^item_(?:name|number)(\d+)$/.exec(k);
    if (m) count = Math.max(count, Number(m[1]));
  }
  const lines = [];
  const take = (n) => {
    const name = s('item_name' + n);
    const id = s('item_number' + n);
    if (!name && !id) return;
    const q = Number(s('quantity' + n));
    lines.push({ id, name, qty: q > 0 ? q : 1, amount: n ? amt('mc_gross_' + n) : null });
  };
  if (count > 0) for (let i = 1; i <= count; i++) take(String(i));
  else take('');
  const perLine = (k) => (count ? lines.reduce((t, _, i) => t + (amt(k + (i + 1)) ?? 0), 0) : 0);
  const shipping = r2(amt('mc_shipping') ?? perLine('mc_shipping'));
  const handling = r2(amt('mc_handling') ?? perLine('mc_handling'));
  const street = s('address_street');
  const place = [s('address_city'), [s('address_state'), s('address_zip')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const country = s('address_country_code').toUpperCase();
  const address = [street, place, country && country !== 'US' ? s('address_country') || country : ''].filter(Boolean).join('\n');
  return {
    kind: 'paypal',
    txn: s('txn_id'),
    parent: s('parent_txn_id') || null,
    status: s('payment_status'),
    reason: s('reason_code') || null,
    type: s('txn_type') || null,
    test: s('test_ipn') === '1',
    currency: (s('mc_currency') || 'USD').toUpperCase(),
    gross: r2(amt('mc_gross')),
    fee: amt('mc_fee') === null ? null : r2(amt('mc_fee')),
    tax: r2(amt('tax')),
    shipping,
    handling,
    lines,
    buyer: {
      name: s('address_name') || [s('first_name'), s('last_name')].filter(Boolean).join(' '),
      email: s('payer_email').toLowerCase(),
      phone: s('contact_phone'),
      address,
      state: s('address_state').toUpperCase(),
      country,
    },
    memo: s('memo'),
  };
}
