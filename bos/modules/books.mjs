// BOOKS — the eighth station: the money. What came in, what went out, the sales tax you owe and
// what you kept. A bank's, a card's or PayPal's file dropped anywhere on the desk is read here,
// line by line, sorted into money in and money out: a line that is money the desk already booked
// (a buy, a label, a sale) is tied to that entry instead of being counted twice, and every other
// line is filed with one tap, with the account you picked last time for that payee already chosen.
// The company's settings and the desk's backup live at the foot of this page.
//
// THE LAYOUT (Matt, 2026-10-05 22:26Z: "study the top 3-5 other comparable options and see what
// layout they use … in our own style but layout anf formatting closer to our top competitors"),
// read on 2026-10-05 from each one's own help pages, each quote found again in the raw page on
// 2026-10-06: QuickBooks Online's Home (Profit & Loss, an Expenses chart "broken down by
// category", Cash Flow, bank balances), FreshBooks' dashboard (Revenue and Expenses by month,
// Spending "broken down by expense parent category" with a click
// through to the expenses, Revenue by Client as its top four and the rest grouped, "This year" by
// default) and Zoho Books' Home (Income and Expense, Top Expenses as a pie where a click on a slice
// shows its transactions, "This Fiscal Year" by default). Wave and Xero stay leads only: Wave's help
// pages answered 403 (refused) and Xero's help page came back empty. So, top to bottom: the period,
// four totals, files waiting to be sorted, income and expenses by month, the two pies with their
// tables, then the entries a pressed slice narrows.
import * as V from './verbs.mjs';
import { activeCompanyId, blankCompany, plugCompany, readRoster } from './store.mjs';
import { salesTaxOf, salesTaxWords } from './compliance.mjs';
import { seenFingerprints, settleDropLine } from './files.mjs';
import { themeChips, saveAs, todayIso, outLink, toast, cell, secretField } from './ui.mjs';
import { PAPERS, LINES } from './theme.mjs';

// The usual ways a business takes money online, each opening at its sign-in (Matt, 2026-10-05 22:26Z:
// "the preset bottom chips on bottom left are main usual online ways of taking payments"); a bank is
// the person's own, added with + Custom. Loaded 2026-10-05 in the program's own engine as a visitor
// not signed in: PayPal's /signin answered, Stripe, Square, Venmo, Cash App and Clover each landed on
// their sign-in. Nothing here moves money: a tab is the site itself, signed in by its owner.
const PAY_PAGES = [
  { name: 'PayPal', url: 'https://www.paypal.com/signin' },
  { name: 'Square', url: 'https://app.squareup.com/dashboard' },
  { name: 'Stripe', url: 'https://dashboard.stripe.com' },
  { name: 'Venmo', url: 'https://account.venmo.com/' },
  { name: 'Cash App', url: 'https://cash.app/account' },
  { name: 'Clover', url: 'https://www.clover.com/dashboard' },
];

let period = String(new Date().getFullYear()); // a year ('2026'), a month ('2026-10') or 'all'
let side = null;          // 'in' or 'out': the entries show only income, or only expenses
let slice = null;         // a slice pressed on that side's pie: its key ('fees', 'product:…', 'rest')
let sideWas = null;       // what the entries showed before a slice was pressed
let showAll = false;
let inbox = [];           // files read and not yet put away: { id, name, result, notSame: Set }
let backup = null;        // a backup file waiting for a yes: { name, json }
let addingBank = false;
let cloudAsk = false;     // the sign-in for moving this company to the cloud is open

const nonZero = (n) => Math.abs(n) >= 0.005;
// the one number a person reads for an entry: what it did to cash (+ in, − out), else its
// biggest leg with no sign (a sale's cost moving off the shelf, money moved between accounts)
function headline(store, e) {
  let cash = 0;
  for (const p of e.postings ?? []) if (String(p.account) === V.ACCT.cash) cash += Number(p.amount) || 0;
  if (nonZero(cash)) return (cash > 0 ? '+' : '−') + store.usd(Math.abs(V.round2(cash)));
  return store.usd(V.round2((e.postings ?? []).reduce((m, p) => Math.max(m, Number(p.amount) || 0), 0)));
}
const words = (account) => {
  const c = V.categoryOfAccount(account);
  if (c) return V.categoryById(c).label;
  const known = { 'Income:Sales': 'Sales', 'Expenses:COGS': 'What sales cost', [V.SHRINKAGE]: 'Stock lost', [V.SHIP_IN]: 'Shipping buyers paid',
    'Income:Other': 'Other money in', 'Assets:Inventory': 'Stock', 'Assets:Cash': 'Cash',
    'Liabilities:SalesTaxPayable': 'Sales tax owed', 'Equity:OwnerContributions': 'Your own money in', 'Equity:OwnerDraws': 'Taken out for you' };
  return known[account] ?? String(account).split(':').slice(-1)[0];
};
const years = (store) => {
  const ys = new Set(store.data.ledger.entries.map((e) => String(e.date ?? '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y)));
  ys.add(String(new Date().getFullYear()));
  return [...ys].sort().reverse();
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isMonth = (p) => /^\d{4}-\d{2}$/.test(p);
const monthOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const periodWords = (p) => (p === 'all' ? 'all time' : isMonth(p) ? `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}` : p);

// The pies' colours: the desk's own line colours, drawn as each paper draws them, kept at 3:1 or
// more against all nine papers and their fields (the bar for a shape, WCAG 1.4.11; measured every run). Never the
// house red: red means danger, and an expense is not one (CLAUDE.md §8b). Clay, the reddish line,
// is left out for the same reason. What sales cost takes the paper's muted ink, stock lost its
// full ink, and the income pie's seventh slice or "Everything else" the muted ink again.
const OUT_HUE = { materials: 'pine', labor: 'ink', shipping: 'sea', fees: 'plum', tools: 'copper', other: 'gold' };
const IN_HUES = ['pine', 'sea', 'ink', 'plum', 'copper', 'gold'];
export const PIE_HUES = [...new Set([...IN_HUES, ...Object.values(OUT_HUE)])]; // measured by scripts/warchief-line.mjs
const hue = (store, name) => LINES[name][PAPERS[store.settings.paper]?.dark ? 'dark' : 'light'];
const pct = (part, whole) => {
  if (!(part > 0 && whole > 0)) return '—';
  const p = Math.round((part / whole) * 100);
  return p < 1 ? '<1%' : p + '%';
};

// One pie: the ring in slices, the total in its middle, and its table under it. Only money above
// zero is drawn (a month of refunds can leave a product below it); every slice is in the table.
// Each slice is an arc of its own, not a dash of one circle, so a tap lands on the slice under the
// finger whatever the browser does with a dashed line.
const R = 16;
const onRing = (f) => {
  const a = 2 * Math.PI * f - Math.PI / 2; // from twelve o'clock, clockwise
  return `${(21 + R * Math.cos(a)).toFixed(3)} ${(21 + R * Math.sin(a)).toFixed(3)}`;
};
function pie(store, side, title, data, on) {
  const esc = store.esc;
  const drawn = data.slices.filter((x) => x.amount > 0);
  const whole = drawn.reduce((s, x) => s + x.amount, 0);
  let at = 0;
  const ring = drawn.map((x) => {
    const f = x.amount / whole;
    const gap = drawn.length > 1 ? Math.min(0.002, f / 4) : 0; // a hairline of the card between slices
    const attrs = `class="sl${on && on !== x.key ? ' dim' : ''}" style="stroke:${x.colour}" data-do="slice" data-side="${side}" data-v="${esc(x.key)}"`;
    const tip = `<title>${esc(x.label)}: ${esc(store.usd(x.amount))}, ${pct(x.amount, whole)}</title>`;
    const svg = drawn.length === 1
      ? `<circle cx="21" cy="21" r="${R}" ${attrs}>${tip}</circle>`
      : `<path d="M ${onRing(at + gap)} A ${R} ${R} 0 ${f - 2 * gap > 0.5 ? 1 : 0} 1 ${onRing(at + f - gap)}" ${attrs}>${tip}</path>`;
    at += f;
    return svg;
  }).join('');
  const rows = data.slices.map((x) => `<button type="button" class="leg${on === x.key ? ' on' : ''}" data-do="slice" data-side="${side}" data-v="${esc(x.key)}" aria-pressed="${on === x.key}">
      <i class="sw" style="background:${x.colour}"></i><span class="ln">${esc(x.label)}</span><span class="la">${esc(store.usd(x.amount))}</span><span class="lp">${pct(x.amount, whole)}</span></button>`).join('');
  return `<div class="pie">
    <h3 class="sub">${esc(title)}</h3>
    <div class="donut"><svg viewBox="0 0 42 42" aria-hidden="true">${ring || `<circle class="hole" cx="21" cy="21" r="${R}" />`}</svg>
      <div class="mid"><b>${esc(store.usd(data.total))}</b><small>${esc(title.toLowerCase())}</small></div></div>
    ${rows ? `<div class="legend" role="group" aria-label="${esc(title)} by ${side === 'in' ? 'where it came from' : 'what it paid for'}">${rows}</div>` : `<p class="note">None for this time yet.</p>`}
  </div>`;
}

// Income and expenses month by month: the twelve months the period sits in (a year's own, a month's
// year, or the last twelve for all time), each a button that picks that month.
function months(store, period) {
  const by = V.byMonth(store);
  const end = period === 'all' ? new Date() : new Date(Number(period.slice(0, 4)), 11, 1);
  const keys = Array.from({ length: 12 }, (_, i) => monthOf(new Date(end.getFullYear(), end.getMonth() - 11 + i, 1)));
  const top = Math.max(0, ...keys.flatMap((k) => [by.get(k)?.in ?? 0, by.get(k)?.out ?? 0]));
  if (!(top > 0)) return '';
  const h = (v) => (Math.max(0, v) / top * 100).toFixed(1);
  const esc = store.esc;
  return `<h2 class="sect">By month${period === 'all' ? ', the last twelve' : ''}</h2>
    <p class="key"><i class="sw bi"></i>Income <i class="sw bo"></i>Expenses</p>
    <div class="months">${keys.map((k) => {
      const m = by.get(k) ?? { in: 0, out: 0 };
      const says = `${periodWords(k)}: income ${store.usd(m.in)}, expenses ${store.usd(m.out)}`;
      return `<button type="button" class="mo${period === k ? ' on' : ''}" data-do="period" data-v="${k}" aria-pressed="${period === k}" aria-label="${esc(says)}" title="${esc(says)}">
        <span class="bars"><i class="bi" style="height:${h(m.in)}%"></i><i class="bo" style="height:${h(m.out)}%"></i></span><span class="ml">${MONTHS[Number(k.slice(5)) - 1].slice(0, 3)}</span></button>`;
    }).join('')}</div>`;
}

function inboxCard(store, f) {
  const esc = store.esc;
  const seen = seenFingerprints(store);
  const lines = f.result.lines.filter((ln) => !seen.has(ln.fingerprint));
  const known = f.result.lines.length - lines.length;
  const picks = [];
  // sorted into money in and money out as it is read (Matt, 22:26Z: "drag and drop expense files from
  // bank it sorts it into income or expense"), with a line whose amount or way is not yet known first
  const group = (ln) => (ln.amount === null || ln.amount === undefined ? 0 : ln.amount > 0 ? 1 : 2);
  const sorted = lines.map((ln, n) => [ln, n]).sort((a, b) => group(a[0]) - group(b[0]) || a[1] - b[1]).map(([ln]) => ln);
  const heads = ['Not sure yet', 'Money in', 'Money out'];
  const rows = sorted.map((ln, n) => {
    const g = group(ln);
    const head = n === 0 || group(sorted[n - 1]) !== g ? (() => {
      const same = sorted.filter((x) => group(x) === g);
      const sum = g ? V.round2(same.reduce((s, x) => s + Number(x.amount), 0)) : 0;
      return `<div class="grp"><span class="k">${heads[g]} · ${same.length}</span>${g ? `<span class="k">${sum > 0 ? '+' : '−'}${esc(store.usd(Math.abs(sum)))}</span>` : ''}</div>`;
    })() : '';
    const i = f.result.lines.indexOf(ln);
    // a line dropped from a web page may not say yet which amount is the money, or which way it
    // went: those are asked first, one tap each, and nothing is filed until they are answered
    const unsettled = ln.amount === null || ln.amount === undefined;
    const out = ln.amount < 0;
    const match = unsettled || f.notSame.has(i) ? null : V.matchFor(store, ln);
    const rule = V.ruleFor(store, ln.payee);
    if (!unsettled && !match && rule) picks.push({ line: ln, account: rule });
    const choices = V.LINE_CHOICES[out ? 'out' : 'in'].filter((c) => c.id !== V.UNTAXED || Number(store.settings.taxRate) > 0);
    return `${head}<div class="line" style="display:block">
      <div style="display:flex;gap:10px"><span class="nm">${esc(ln.payee)}<small>${esc(ln.date)}${ln.fee ? ` · gross ${esc(store.usd(ln.gross))}, fee ${esc(store.usd(Math.abs(ln.fee)))}` : ''}</small></span>
        <span class="amt">${unsettled ? (ln.abs != null ? esc(store.usd(ln.abs)) : '?') : `${ln.amount > 0 ? '+' : '−'}${esc(store.usd(Math.abs(ln.amount)))}`}</span></div>
      ${unsettled
        ? (ln.abs == null
          ? `<p class="note" style="margin:6px 0">Which of these is the money?</p>
             <div class="chips">${(ln.picks ?? []).map((p, k) => `<button type="button" class="chip sm" data-do="pick-amt" data-f="${esc(f.id)}" data-i="${i}" data-k="${k}">${p.dir === 'out' ? '−' : p.dir === 'in' ? '+' : ''}${esc(store.usd(p.abs))}</button>`).join('')}</div>`
          : `<p class="note" style="margin:6px 0">Did this money come in or go out?</p>
             <div class="chips"><button type="button" class="chip sm" data-do="pick-dir" data-f="${esc(f.id)}" data-i="${i}" data-v="out">Money out</button>
               <button type="button" class="chip sm" data-do="pick-dir" data-f="${esc(f.id)}" data-i="${i}" data-v="in">Money in</button></div>`)
        : match
        ? `<p class="note" style="margin:6px 0">The same money as ${store.chip('ledger:' + match.entry.id)}, already in the books${match.viaGross ? ' (PayPal’s fee comes off it)' : ''}?</p>
           <div class="chips"><button type="button" class="chip on" data-do="same" data-f="${esc(f.id)}" data-i="${i}" data-entry="${esc(match.entry.id)}">Yes, the same</button>
             <button type="button" class="chip" data-do="not-same" data-f="${esc(f.id)}" data-i="${i}">No, it is new</button></div>`
        : `<div class="chips">${choices.map((c) => `<button type="button" class="chip sm${rule === c.id ? ' on' : ''}" data-do="file" data-f="${esc(f.id)}" data-i="${i}" data-account="${esc(c.id)}">${esc(c.label)}${c.id === V.ACCT.sales && Number(store.settings.taxRate) > 0 ? ' (tax split out)' : ''}</button>`).join('')}</div>`}
    </div>`;
  }).join('');
  const r = f.result;
  return { picks, html: `<div class="card" data-ref="file:${esc(f.id)}">
    <h3 class="sub" style="margin-top:0">${esc(f.name)}</h3>
    <p class="note">${lines.length} to file${known ? ` · ${known} already in the books` : ''}${r.unreadable.length ? ` · ${r.unreadable.length} row${r.unreadable.length === 1 ? '' : 's'} could not be read` : ''}${r.skipped.length ? ` · ${r.skipped.length} not completed (left out)` : ''}</p>
    ${lines.length ? `<div class="list">${rows}</div>` : '<p>Every line in this file is in the books.</p>'}
    ${picks.length > 1 ? `<button type="button" class="btn fill" data-do="file-picked" data-f="${esc(f.id)}">Book the ${picks.length} already picked</button>` : ''}
    ${r.unreadable.length ? `<p class="truth">⚠ Rows the desk could not read, shown so nothing vanishes: ${r.unreadable.slice(0, 3).map((u) => '“' + esc(String(u).slice(0, 80)) + '”').join(', ')}${r.unreadable.length > 3 ? '…' : ''}</p>` : ''}
    <button type="button" class="btn" data-do="put-away" data-f="${esc(f.id)}">Put this file away</button>
  </div>` };
}

function ownerJournal(store) {
  const b = store.books;
  if (!b || typeof b.bought !== 'number' || typeof b.spent !== 'number') return '';
  const esc = store.esc;
  return `<h2 class="sect">Your bank’s own journal</h2>
    <p class="note">Read from the journal kept beside this desk (generated ${esc(b.generated ?? '')}, ${esc(b.span?.first ?? '')} to ${esc(b.span?.last ?? '')}).</p>
    <div class="boxes"><div class="box"><span class="k">On the shelf</span><div class="v">${esc(store.usd(b.bought))}</div><span class="sub">bought and still yours</span></div>
      <div class="box"><span class="k">Spent</span><div class="v">${esc(store.usd(b.spent))}</div><span class="sub">gone</span></div></div>
    <table class="tbl">${(b.accounts ?? []).map((a) => `<tr><td>${esc(a.account)}</td><td class="r">${esc(store.usd(Number(a.amount) || 0))}</td></tr>`).join('')}</table>`;
}

function csvOf(store, entries) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['date', 'description', 'account', 'amount', 'payee', 'linked to', 'entry'].join(',')];
  for (const e of entries) {
    for (const p of e.postings ?? []) {
      rows.push([q(e.date), q(e.desc), q(p.account), Number(p.amount).toFixed(2), q(e.tags?.payee ?? ''), q((e.links ?? []).join(' ')), q(e.id)].join(','));
    }
  }
  return rows.join('\r\n') + '\r\n';
}

function taxNote(store) {
  const products = store.data.products?.products ?? [];
  const first = products.find((p) => p && Number(p.price) > 0);
  const price = first ? Number(first.price) : 100;
  const set = Number(store.settings.taxRate) > 0;
  const rate = set ? Number(store.settings.taxRate) : 0.06;
  const split = V.splitTax(price, rate);
  const pct = String(V.round2(rate * 100)).replace(/\.00$/, '');
  const what = first ? `${store.esc(first.name)} at ${store.esc(store.usd(price))}` : `a ${store.esc(store.usd(100))} sample`;
  const rateWords = set ? `your ${pct}% rate` : `a sample ${pct}%`;
  const where = store.settings.state ? ` Your state is ${store.esc(store.settings.state)}.` : '';
  return `The sales tax is taken out of each price (${what} at ${rateWords} is ${store.esc(store.usd(split.revenue))} of the sale and ${store.esc(store.usd(split.tax))} owed to the state).${where} Leave it empty where you collect none. A sale with no tax in it (shipped out of state, an exempt buyer) is marked so where it is taken, and nothing is split from it. Ask your state what applies to you; this desk does not know your state’s rules.`;
}

export function renderSettings(el, desk, opts = {}) {
  const store = desk.store;
  const esc = store.esc;
  const s = store.settings;
  const pane = opts.pane === 'customize' || opts.pane === 'account' ? opts.pane : 'companies';
  const taxShown = Number(s.taxRate) ? V.round2(Number(s.taxRate) * 100) : (!s.taxExempt && s.state && salesTaxOf(s.state) ? String(Math.round(salesTaxOf(s.state) * 10000) / 100) : '');
  const companyFields = `
    ${cell('Company name', `<input class="f" id="co-name-in" value="${esc(s.company)}" maxlength="120" />`)}
    <div class="row tight">
      ${cell('State', `<select class="f" id="co-state"><option value="">State</option>${['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'].map((c) => `<option value="${c}"${s.state === c ? ' selected' : ''}>${c}</option>`).join('')}</select>`)}
      ${cell('Kind', `<select class="f" id="co-entity"><option value="">Kind</option>${[['sole','Sole prop'],['llc','LLC'],['partnership','Partnership'],['s','S corp'],['c','C corp'],['nonprofit','Nonprofit']].map(([k,w]) => `<option value="${k}"${s.entity === k ? ' selected' : ''}>${w}</option>`).join('')}</select>`)}
      ${cell('Formed', `<select class="f" id="co-formed"><option value="">Month</option>${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((n,i) => { const v = String(i+1).padStart(2,'0'); return `<option value="${v}"${s.formed === v ? ' selected' : ''}>${n}</option>`; }).join('')}</select>`)}
      ${cell('Sales tax %', `<input class="f" id="co-tax" inputmode="decimal" placeholder="None" value="${esc(taxShown)}" />`)}
    </div>
    <label class="chip" style="cursor:pointer"><input type="checkbox" id="co-exempt" ${s.taxExempt ? 'checked' : ''} /> Tax exempt</label>
    <p class="note" id="co-tax-live">${esc(salesTaxWords(s.state, s.taxExempt))}</p>
    <p class="note">${taxNote(store)}</p>
    <div class="row">
      <label class="chip" style="cursor:pointer">${s.logo ? 'Change the logo' : 'Add a logo'}<input type="file" id="co-logo" accept="image/png,image/jpeg,image/webp" hidden /></label>
      ${s.logo ? '<button type="button" class="chip" data-do="logo-off">Remove the logo</button>' : ''}
    </div>`;
  el.innerHTML = `
    <h1 class="title">${pane === 'customize' ? 'Customize' : pane === 'account' ? 'Account' : 'Companies'}</h1>
    ${pane === 'companies' && backup ? `<div class="card"><h3 class="sub" style="margin-top:0">Bring in ${esc(backup.name)}?</h3>
      <p>It is a backup from ${esc(String(backup.json.exported ?? '').slice(0, 10) || 'an unknown day')}. Bringing it in replaces everything on this desk with what it holds; one Undo puts this desk back as it was.</p>
      <div class="btns"><button type="button" class="btn fill" data-do="backup-yes">Bring it in</button><button type="button" class="btn" data-do="backup-no">Not now</button></div></div>` : ''}
    ${pane === 'companies' ? `<p class="note">A tap opens that company. Initiate a new one and this page goes back to the first screen. Close this to go back.</p>
    <div class="chips">
      ${readRoster().map((r) => `<button type="button" class="chip${r.id === activeCompanyId() ? ' on' : ''}" data-do="plug" data-v="${esc(r.id)}">${esc(r.name)}</button>`).join('')}
      <button type="button" class="chip" data-do="new-co">Initiate a new company</button>
    </div>
    ${companyFields}
    <div class="chips" role="group" aria-label="Where this company is kept">
      <button type="button" class="chip${store.where === 'cloud' ? '' : ' on'}" data-do="where" data-v="computer" aria-pressed="${store.where !== 'cloud'}">On this phone</button>
      <button type="button" class="chip${store.where === 'cloud' ? ' on' : ''}" data-do="where" data-v="cloud" aria-pressed="${store.where === 'cloud'}">In the cloud</button>
    </div>
    ${cloudAsk ? `<div class="card">
      <p class="note">Locked on this phone first, then sent to <b>${esc(window.BOS_GATE?.user?.email || 'the Iron Roots account you signed in with')}</b>. The passphrase is not that account’s password, and it is not sent. A different email is not asked for.</p>
      ${secretField('cloud-phrase', 'Passphrase, at least 8 characters', 'new-password')}
      ${secretField('cloud-phrase2', 'The passphrase again', 'new-password')}
      <button type="button" class="btn fill" data-do="cloud-go">Lock it and move it to the cloud</button>
    </div>` : ''}
    <button type="button" class="btn" data-do="save-co">Save</button>
    <div class="btns">
      <button type="button" class="btn" data-do="export">Download a backup</button>
      <label class="btn" style="cursor:pointer">Bring in a backup<input type="file" id="co-backup" accept=".json,application/json" hidden /></label>
    </div>
    <p class="note">${store.where === 'cloud'
      ? 'The cloud holds a locked copy under the account you signed in with. Nothing stored there can be read back as your books. On this phone stops sending. Forgetting the passphrase locks that copy for good.'
      : 'Kept on this phone, in this browser. In the cloud locks the books here first, then sends only the locked copy to the account you signed in with.'}</p>` : ''}
    ${pane === 'customize' ? `${themeChips(s.paper, s.line, esc)}
    <p class="k" style="margin-top:16px">Search</p>
    <div class="chips" role="group" aria-label="Default search">
      ${[['duck', 'DuckDuckGo'], ['google', 'Google'], ['bing', 'Bing']].map(([k, w]) => `<button type="button" class="chip${(s.search || 'duck') === k ? ' on' : ''}" data-do="search" data-v="${k}" aria-pressed="${(s.search || 'duck') === k}">${w}</button>`).join('')}
    </div>
    <p class="note">A new tab opens this search page. DuckDuckGo does not keep a profile of what you look up. Google and Bing do.</p>
    <button type="button" class="btn" data-do="save-co">Save</button>` : ''}
    ${pane === 'account' ? `<p class="k">Intelligence</p>
    <div class="chips" role="group" aria-label="Intelligence">
      <button type="button" class="chip${store.settings.ai ? '' : ' on'}" data-do="ai" data-v="0" aria-pressed="${!store.settings.ai}">Off</button>
      <button type="button" class="chip${store.settings.ai ? ' on' : ''}" data-do="ai" data-v="1" aria-pressed="${!!store.settings.ai}">On, when it is connected</button>
    </div>
    <p class="note">${store.settings.ai
      ? 'Asked for, and not connected. A reply written in sentences is still not read. The day’s counts, the shelf, and mail filed by its address keep working without it.'
      : 'Off. The desk counts the day, files mail by the address it came to, and does the batch and shelf arithmetic itself. Reading a reply written in sentences waits until you connect it.'}</p>
    <div class="btns"><button type="button" class="btn" data-do="sign-out">Sign out</button></div>
    <p class="note">Signs this phone out. The desk closes and the login comes back. The company stays where it was kept. A membership is asked again once a day, even if this stays open.</p>` : ''}`;

  el.onchange = async (e) => {
    const tg = e.target;
    if (tg.id === 'co-backup' && tg.files?.[0]) { await desk.takeFile(tg.files[0]); return; }
    if (tg.id === 'co-logo' && tg.files?.[0]) {
      const file = tg.files[0];
      if (file.size > 200 * 1024) { toast('That logo is ' + Math.round(file.size / 1024) + ' KB; use one under 200 KB', { error: true }); return; }
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('A logo must be a PNG, JPEG or WebP picture', { error: true }); return; }
      const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
      desk.act(() => ({ act: store.conf({ logo: String(url) }, 'a new logo') }));
    }
  };
  el.onclick = async (e) => {
    const b = e.target.closest('[data-do]');
    if (!b || b.tagName === 'SELECT') return;
    const d = b.dataset;
    switch (d.do) {
      case 'save-co': {
        const nameEl = el.querySelector('#co-name-in');
        if (!nameEl) {
          const search = el.querySelector('[data-do="search"].on')?.dataset.v || store.settings.search || 'duck';
          try { localStorage.setItem('wc.search', search); } catch {}
          desk.act(() => ({ act: store.conf({ search }, 'search') }));
          return;
        }
        const company = nameEl.value.trim();
        const pct = el.querySelector('#co-tax').value.trim();
        const taxRate = pct === '' ? 0 : Number(pct.replace('%', '')) / 100;
        const search = store.settings.search || 'duck';
        const state = el.querySelector('#co-state').value;
        const entity = el.querySelector('#co-entity').value;
        const formed = el.querySelector('#co-formed').value;
        const taxExempt = !!el.querySelector('#co-exempt')?.checked;
        if (!company) { toast('The company needs a name', { error: true }); return; }
        desk.act(() => ({ act: store.conf({ company, taxRate: V.round2(taxRate * 10000) / 10000, search, state, entity, formed, taxExempt }, 'company settings') }));
        return;
      }
      case 'plug': {
        if (d.v === activeCompanyId()) return;
        if (!plugCompany(d.v)) return;
        window.parent?.postMessage({ source: 'wc-desk', type: 'booting' }, location.origin);
        location.reload();
        return;
      }
      case 'new-co': {
        blankCompany();
        try { window.parent?.postMessage({ source: 'wc-desk', type: 'first-screen' }, location.origin); } catch {}
        try { window.parent?.postMessage({ source: 'wc-desk', type: 'booting' }, location.origin); } catch {}
        location.replace(location.href.replace(/#.*$/, ''));
        return;
      }
      case 'search':
        b.parentElement.querySelectorAll('[data-do="search"]').forEach((c) => c.classList.toggle('on', c === b));
        try { localStorage.setItem('wc.search', d.v); } catch {}
        return;
      case 'ai':
        desk.act(() => ({ act: store.conf({ ai: d.v === '1' }, d.v === '1' ? 'intelligence asked for' : 'intelligence off') }));
        if (d.v === '1') toast('Not connected yet. Mail still files by the address it was sent to.');
        return;
      case 'where': {
        if (d.v !== 'cloud') { cloudAsk = false; store.keepLocal(); desk.rerender(); return; }
        if (!window.BOS_GATE?.user) { toast('Sign in with your Iron Roots account first. The books go to that account and no other.', { error: true }); return; }
        cloudAsk = true;
        desk.rerender();
        return;
      }
      case 'cloud-go': {
        const phrase = el.querySelector('#cloud-phrase')?.value || '';
        const again = el.querySelector('#cloud-phrase2')?.value || '';
        if (phrase !== again) { toast('Type the passphrase the same way twice', { error: true }); return; }
        store.moveToCloud({ phrase }).then(() => { cloudAsk = false; toast('The locked copy is in the cloud.'); desk.rerender(); })
          .catch((err) => toast(err?.message || 'The cloud did not take it', { error: true }));
        return;
      }
      case 'foot':
        return;
      case 'sign-out':
        try { await window.BOS_GATE?.sb?.auth.signOut(); } catch {}
        try { window.BOS_GATE.user = null; window.BOS_TOKEN = null; } catch {}
        try { const prev = JSON.parse(localStorage.getItem('wc.shell') || '{}'); prev.account = ''; localStorage.setItem('wc.shell', JSON.stringify(prev)); } catch {}
        try { window.parent?.postMessage({ source: 'wc-desk', type: 'sign-out' }, location.origin); } catch {}
        return;
      case 'logo-off': desk.act(() => ({ act: store.conf({ logo: '' }, 'took the logo off') })); return;
      case 'export': saveAs(`war-chief-backup-${todayIso()}.json`, JSON.stringify(store.exportAll(), null, 1)); return;
      case 'backup-yes': {
        const r = desk.act(() => ({ act: store.importAll(backup.json) }), { say: 'Brought in ' + backup.name });
        if (r) { backup = null; desk.rerender(); }
        return;
      }
      case 'backup-no': backup = null; desk.rerender(); return;
      default: return;
    }
  };
  const readTax = () => {
    const pct = el.querySelector('#co-tax')?.value.trim() ?? '';
    return pct === '' ? 0 : V.round2(Number(pct.replace('%', '')) * 100) / 10000;
  };
  const writeLive = (state, taxExempt) => {
    const live = el.querySelector('#co-tax-live');
    if (live) live.textContent = salesTaxWords(state, taxExempt);
  };
  el.querySelector('#co-state')?.addEventListener('change', () => {
    const state = el.querySelector('#co-state')?.value || '';
    const taxExempt = !!el.querySelector('#co-exempt')?.checked;
    const taxRate = taxExempt ? 0 : salesTaxOf(state);
    const tax = el.querySelector('#co-tax');
    if (tax) tax.value = taxRate ? String(Math.round(taxRate * 10000) / 100) : '';
    writeLive(state, taxExempt);
    desk.act(() => ({ act: store.conf({ state, taxExempt, taxRate }, 'sales tax for ' + (state || 'no state')) }), { keep: true });
  });
  el.querySelector('#co-exempt')?.addEventListener('change', () => {
    const state = el.querySelector('#co-state')?.value || '';
    const taxExempt = !!el.querySelector('#co-exempt')?.checked;
    const taxRate = taxExempt ? 0 : salesTaxOf(state);
    const tax = el.querySelector('#co-tax');
    if (tax) tax.value = taxExempt ? '' : (taxRate ? String(Math.round(taxRate * 10000) / 100) : '');
    writeLive(state, taxExempt);
    desk.act(() => ({ act: store.conf({ state, taxExempt, taxRate }, taxExempt ? 'tax exempt' : 'sales tax for ' + (state || 'no state')) }), { keep: true });
  });
  el.querySelector('#co-tax')?.addEventListener('change', () => {
    const state = el.querySelector('#co-state')?.value || '';
    const taxExempt = !!el.querySelector('#co-exempt')?.checked;
    const taxRate = taxExempt ? 0 : readTax();
    writeLive(state, taxExempt);
    desk.act(() => ({ act: store.conf({ taxRate }, 'city sales tax') }), { keep: true });
  });
  el.querySelectorAll('[data-paper]').forEach((c) => c.addEventListener('click', () => desk.act(() => ({ act: store.conf({ paper: c.dataset.paper }, 'the paper') }), { keep: true })));
  el.querySelectorAll('[data-line]').forEach((c) => c.addEventListener('click', () => desk.act(() => ({ act: store.conf({ line: c.dataset.line }, 'the line colour') }), { keep: true })));
}

export const station = {
  id: 'books',
  title: 'Books',
  badge: (store) => {
    const seen = seenFingerprints(store);
    return inbox.reduce((n, f) => n + f.result.lines.filter((ln) => !seen.has(ln.fingerprint)).length, 0);
  },
  commands: () => [
    { label: 'Read a bank or PayPal file', hint: 'Books', hash: '#books/drop' },
    { label: 'Paid for something', hint: 'Books', hash: '#books/paid' },
    { label: 'Company settings', hint: 'Books', hash: '#settings' },
    { label: 'Download a backup', hint: 'Books', hash: '#settings' },
  ],
  // the chips at the foot of the program's left bar (public/bos/index.html, sitesOf)
  web: { presets: PAY_PAGES, keys: ['banks'] },
  // a file read anywhere on the desk; the id it is given lets the desk open Books right at its card
  take(result, name) {
    const id = 'f' + Date.now().toString(36);
    inbox = inbox.filter((f) => f.name !== name);
    inbox.unshift({ id, name, result, notSame: new Set() });
    return id;
  },
  takeBackup(json, name) { backup = { name, json }; },
  render(el, desk) {
    const store = desk.store;
    const esc = store.esc;
    const ys = years(store);
    if (period !== 'all' && !isMonth(period) && !ys.includes(period)) period = ys[0];
    // a link to one entry shows it: its period, and no slice hiding it (Fable's pass of 0.4.0 found a
    // link landing under the Fees box with the entry it named not drawn)
    const linked = desk.fresh && String(store.route.ref ?? '').startsWith('ledger:') ? store.resolve(store.route.ref) : null;
    if (linked && !V.inPeriod(linked, period)) {
      const y = String(linked.date ?? '').slice(0, 4);
      period = ys.includes(y) ? y : 'all';
    }
    const inc = V.moneyIn(store, period);
    const spent = V.moneyOut(store, period);
    // the colours, and the income pie's top six with the rest as one slice (FreshBooks' Revenue by
    // Client: "top four clients, and all remaining clients grouped as Other Client(s)")
    const rest = inc.slices.length > 7 ? inc.slices.slice(6) : [];
    const restKeys = new Set(rest.map((x) => x.key));
    const ins = (rest.length ? [...inc.slices.slice(0, 6), { key: 'rest', label: 'Everything else', amount: V.round2(rest.reduce((a, x) => a + x.amount, 0)) }] : inc.slices)
      .map((x, n) => ({ ...x, colour: n < 6 ? hue(store, IN_HUES[n]) : 'var(--muted)' }));
    const outs = spent.slices.map((x) => ({ ...x, colour: OUT_HUE[x.key] ? hue(store, OUT_HUE[x.key]) : x.key === 'lost' ? 'var(--fg)' : 'var(--muted)' }));
    if (slice && !(side === 'in' ? ins : outs).some((x) => x.key === slice)) slice = null; // gone from this period's pie
    // an entry is listed when it is on the side asked for, and in the slice pressed: the same
    // classifier the pies are drawn from (verbs.mjs, slicesOf), so a slice and its list agree
    const keys = slice === 'rest' ? restKeys : slice ? new Set([slice]) : null;
    const hits = (e) => !side || V.slicesOf(store, e).some((x) => x.side === side && x.amount !== 0 && (!keys || keys.has(x.key)));
    if (linked && !hits(linked)) { side = null; slice = null; }
    const t = V.booksTotals(store, period);
    const kept = V.round2(inc.total - spent.total);
    // newest first, and within a day the last booked first, so what was just done is on top
    const entries = store.data.ledger.entries.filter((e) => V.inPeriod(e, period) && hits(e))
      .reverse().sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
    if (linked && entries.findIndex((e) => e.id === linked.id) >= 50) showAll = true; // and past the first fifty
    const shown = showAll ? entries : entries.slice(0, 50);
    const noCost = store.data.orders.orders.filter((o) => {
      const tr = V.orderTrail(store, o);
      return tr.sale && tr.out && !tr.cost && V.inPeriod(tr.sale, period) && (o.lines ?? []).some((ln) => store.resolve('product:' + ln.productId)?.itemId);
    }).length;
    const jars = store.data.jars.jars.map((j) => ({ j, filled: V.round2(store.sum(store.data.ledger.entries, 'Assets:Cash:Jar:' + j.id)) }));
    const banks = [...PAY_PAGES, ...(store.settings.banks ?? []).filter((b) => b?.name && b?.url)];
    const files = inbox.map((f) => inboxCard(store, f));
    const label = periodWords(period);
    const s = store.settings;
    const now = new Date();
    const thisMonth = monthOf(now);
    const lastMonth = monthOf(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const periods = [[thisMonth, 'This month'], [lastMonth, 'Last month'], ...ys.map((y) => [y, y]), ['all', 'All time']];
    if (isMonth(period) && period !== thisMonth && period !== lastMonth) periods.splice(2, 0, [period, label]);
    const named = slice ? (side === 'in' ? ins : outs).find((x) => x.key === slice)?.label : null;

    el.innerHTML = `
      <h1 class="title">Books</h1>
      <div class="chips" role="group" aria-label="Which time">${periods.map(([v, w]) => `<button type="button" class="chip sm${period === v ? ' on' : ''}" data-do="period" data-v="${esc(v)}" aria-pressed="${period === v}">${esc(w)}</button>`).join('')}</div>
      <div class="boxes kpi">
        <div class="box"><span class="k">Income</span><div class="v">${esc(store.usd(inc.total))}</div><span class="sub">${esc(label)}, sales tax taken out</span></div>
        <div class="box"><span class="k">Expenses</span><div class="v">${esc(store.usd(spent.total))}</div><span class="sub">${esc(label)}, stock counted as it sells</span></div>
        <div class="box"><span class="k">Kept</span><div class="v">${esc(store.usd(kept))}</div><span class="sub">income less expenses, before income tax</span></div>
        <div class="box"><span class="k">Cash</span><div class="v">${esc(store.usd(t.cash))}</div><span class="sub">${t.taxOwed > 0 ? `${esc(store.usd(t.taxOwed))} of it is sales tax you owe` : t.taxOwed < 0 ? `the state was paid ${esc(store.usd(-t.taxOwed))} more than the books say was owed` : 'in the business’s accounts, by the books'}</span></div>
      </div>
      <p class="truth">${nonZero(t.stock) ? `Stock is an expense when it sells, not when it is bought: ${esc(store.usd(t.stock))} of it is on the shelf now, at what it cost. ` : ''}${noCost ? `⚠ ${noCost} sale${noCost === 1 ? '' : 's'} ${noCost === 1 ? 'has' : 'have'} no cost in the books, because a material behind ${noCost === 1 ? 'it' : 'them'} has no price; Kept is higher than the truth by that unknown cost. ` : ''}Your own money in or out, money moved between your accounts and the sales tax you hold are neither income nor expenses.</p>
      ${files.length ? `<h2 class="sect">To sort</h2>${files.map((f) => f.html).join('')}` : ''}

      ${months(store, period)}

      <div class="pies">
        ${pie(store, 'in', 'Income', { total: inc.total, slices: ins }, side === 'in' ? slice : null)}
        ${pie(store, 'out', 'Expenses', { total: spent.total, slices: outs }, side === 'out' ? slice : null)}
      </div>
      ${V.laborOwed(store) > 0 ? `<p class="truth">⚠ ${esc(store.usd(V.laborOwed(store)))} of the labor counted here is not paid yet: batches made on Inventory booked it as owed. A pay run on Labor draws it down first.</p>` : ''}


      <div class="drop" id="bk-drop" data-ref="drop">Drop a bank, card or PayPal file here (CSV, OFX, QFX or QBO), or <label class="chip sm" style="display:inline-flex">pick one<input type="file" id="bk-file" accept=".csv,.ofx,.qfx,.qbo,text/csv" hidden /></label>
        ${desk.program ? '' /* the program has them at the foot of its left bar */ : `<div class="chips" style="justify-content:center">${banks.map((b) => outLink(b.url, b.name, esc, 'chip sm')).join('')}<button type="button" class="chip sm" data-do="add-bank">+ Custom</button></div>`}
        <p class="note" style="margin:0">Open your bank ${desk.program ? 'from the left bar (+ Custom adds it)' : 'here'}, download its activity file, and drop it on the desk. Your login stays with your bank; the desk only reads the file.</p>
      </div>
      ${addingBank && !desk.program ? `<div class="row">${cell('Your bank’s name', '<input class="f" id="bn-name" autocomplete="off" />')}${cell('Its sign-in page', '<input class="f" id="bn-url" inputmode="url" placeholder="https://…" />')}<button type="button" class="btn inline" data-do="save-bank">Add</button></div>` : ''}
      <h2 class="sect" data-ref="paid">Paid for something</h2>
      <div class="row">
        ${cell('What', '<input class="f" id="ex-what" placeholder="A mower blade, printer ink, a market fee" autocomplete="off" />')}
        ${cell('How much', '<input class="f" id="ex-amt" inputmode="decimal" placeholder="$" />', 's')}
        ${cell('Day', `<input class="f" id="ex-date" type="date" value="${esc(todayIso())}" />`, 'm')}
      </div>
      <div class="chips" id="ex-cat">${V.CATEGORIES.map((c, i) => `<button type="button" class="chip sm${i === 5 ? ' on' : ''}" data-do="ex-cat" data-v="${c.id}">${esc(c.label)}</button>`).join('')}</div>
      <div class="chips"><button type="button" class="chip sm on" data-do="ex-own" data-v="0">Business money</button><button type="button" class="chip sm" data-do="ex-own" data-v="1">My own money</button></div>
      <button type="button" class="btn" data-do="expense">Book it</button>
      <p class="note">Materials you will use or sell are better bought on Inventory, so they land on hand at what they cost.</p>

      <h2 class="sect">Entries${named ? ' · ' + esc(named) : ''}</h2>
      <div class="chips" role="group" aria-label="Show">${[['', 'Everything'], ['in', 'Income'], ['out', 'Expenses']].map(([v, w]) => `<button type="button" class="chip sm${(side ?? '') === v ? ' on' : ''}" data-do="side" data-v="${v}" aria-pressed="${(side ?? '') === v}">${w}</button>`).join('')}</div>
      ${shown.length ? `<div class="ents"><div class="ehead" aria-hidden="true"><span>Date</span><span>What</span><span>Filed under</span><span class="r">Amount</span></div>${shown.map((e) => {
        // a refile moves an expense between the six; what sales cost and stock lost are the shelf's, not a pick
        const exp = (e.postings ?? []).find((p) => p.amount > 0 && String(p.account).startsWith('Expenses:') && !String(p.account).startsWith(V.ACCT.cogs));
        const filed = [...new Set((e.postings ?? []).filter((p) => p.account !== V.ACCT.cash).map((p) => words(p.account)))].join(', ');
        const links = (e.links ?? []).map((r) => store.chip(r)).join(' ');
        return `<div class="line ent" data-ref="ledger:${esc(e.id)}">
          <span class="dt">${esc(e.date ?? '')}</span>
          <span class="nm">${esc(e.desc ?? 'An entry')}${links ? `<small>${links}</small>` : ''}</span>
          <span class="ct">${exp ? `<select class="f" data-do="refile" data-entry="${esc(e.id)}" aria-label="File it under">
            ${V.CATEGORIES.map((c) => `<option value="${esc(c.account)}"${V.categoryOfAccount(exp.account) === c.id ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select>` : esc(filed)}</span>
          <span class="amt">${esc(headline(store, e))}</span>
        </div>`;
      }).join('')}</div>` : '<p class="note">Nothing in the books for this time yet.</p>'}
      ${entries.length > shown.length ? `<button type="button" class="btn" data-do="all">Show all ${entries.length}</button>` : ''}
      <div class="btns"><button type="button" class="btn" data-do="csv">Download ${esc(label)} as a spreadsheet</button></div>

      ${Number(s.taxRate) > 0 || t.taxOwed !== 0 ? `<h2 class="sect">Paid the sales tax</h2>
      <div class="row">${cell('What you paid the state', '<input class="f" id="tx-amt" inputmode="decimal" placeholder="$" />')}<button type="button" class="btn inline" data-do="tax">Book it</button></div>` : ''}

      <h2 class="sect">Set aside</h2>
      ${jars.length ? `<div class="list">${jars.map(({ j, filled }) => `<div class="line" data-ref="jar:${esc(j.id)}" style="display:block">
        <div style="display:flex;gap:10px"><span class="nm">${esc(j.name)}<small>${j.target ? 'aiming for ' + esc(store.usd(j.target)) : 'part of your cash with a job'}</small></span><span class="amt">${esc(store.usd(filled))}</span></div>
        <div class="row"><input class="f s" data-jar-amt="${esc(j.id)}" inputmode="decimal" placeholder="$" aria-label="How much" />
          <button type="button" class="btn inline" data-do="jar-in" data-jar="${esc(j.id)}">Put in</button>
          <button type="button" class="btn inline" data-do="jar-out" data-jar="${esc(j.id)}">Take out</button></div></div>`).join('')}</div>` : ''}
      <div class="row">${cell('A new jar', '<input class="f" id="jar-name" placeholder="Taxes, a new mower, a slow month" autocomplete="off" />')}${cell('Aim for', '<input class="f" id="jar-target" inputmode="decimal" placeholder="$" />', 's')}<button type="button" class="btn inline" data-do="jar-new">Add</button></div>
      <p class="note">A jar is a named part of your cash: putting money in moves none of it out of the business.</p>

      ${ownerJournal(store)}`;

    // ── what a tap does ─────────────────────────────────────────────────────────────
    let exCat = 'other';
    let exOwn = false;
    const fileOf = (id) => inbox.find((f) => f.id === id);
    el.onchange = async (e) => {
      const tg = e.target;
      if (tg.id === 'bk-file' && tg.files?.[0]) { for (const file of tg.files) await desk.takeFile(file); return; }
      if (tg.id === 'co-backup' && tg.files?.[0]) { await desk.takeFile(tg.files[0]); return; }
      if (tg.dataset?.do === 'refile') { desk.act(() => V.refile(store, tg.dataset.entry, tg.value)); return; }
      if (tg.id === 'co-logo' && tg.files?.[0]) {
        const file = tg.files[0];
        if (file.size > 200 * 1024) { toast('That logo is ' + Math.round(file.size / 1024) + ' KB; use one under 200 KB', { error: true }); return; }
        if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('A logo must be a PNG, JPEG or WebP picture', { error: true }); return; }
        const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
        desk.act(() => ({ act: store.conf({ logo: String(url) }, 'a new logo') }));
      }
    };
    el.onclick = async (e) => {
      const b = e.target.closest('[data-do]');
      if (!b || b.tagName === 'SELECT') return;
      const d = b.dataset;
      const f = d.f ? fileOf(d.f) : null;
      const ln = f && d.i !== undefined ? f.result.lines[Number(d.i)] : null;
      switch (d.do) {
        // a month bar pressed again lets go of the month, back to its year
        case 'period': period = b.classList.contains('mo') && period === d.v ? d.v.slice(0, 4) : d.v; showAll = false; desk.rerender(); return;
        case 'side': side = d.v || null; slice = null; showAll = false; desk.rerender(); return;
        // a slice narrows the entries to it; pressed again, the entries go back to what they showed before
        case 'slice':
          if (slice === d.v && side === d.side) { slice = null; side = sideWas; }
          else { if (!slice) sideWas = side; side = d.side; slice = d.v; }
          showAll = false; desk.rerender(); return;
        case 'all': showAll = true; desk.rerender(); return;
        case 'same': desk.act(() => V.confirmMatch(store, d.entry, ln)); return;
        case 'not-same': f.notSame.add(Number(d.i)); desk.rerender(); return;
        case 'pick-amt': {
          const p = ln.picks[Number(d.k)];
          Object.assign(ln, { abs: p.abs, dir: p.dir ?? ln.dir, picks: [] });
          settleDropLine(ln);
          desk.rerender();
          return;
        }
        case 'pick-dir': ln.dir = d.v; settleDropLine(ln); desk.rerender(); return;
        case 'file': desk.act(() => V.acceptLine(store, ln, { account: d.account })); return;
        case 'file-picked': {
          const picks = inboxCard(store, f).picks;
          desk.act(() => V.acceptLines(store, picks));
          return;
        }
        case 'put-away': inbox = inbox.filter((x) => x !== f); desk.rerender(); return;
        case 'ex-cat': exCat = d.v; el.querySelectorAll('#ex-cat .chip').forEach((c) => c.classList.toggle('on', c === b)); return;
        case 'ex-own': exOwn = d.v === '1'; b.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b)); return;
        case 'expense': {
          desk.act(() => V.addExpense(store, { what: el.querySelector('#ex-what').value, amount: el.querySelector('#ex-amt').value,
            category: exCat, personal: exOwn, date: el.querySelector('#ex-date').value }));
          return;
        }
        case 'tax': desk.act(() => V.payTax(store, el.querySelector('#tx-amt').value)); return;
        case 'jar-in': case 'jar-out': {
          const amt = Number(el.querySelector(`[data-jar-amt="${CSS.escape(d.jar)}"]`)?.value);
          desk.act(() => V.fillJar(store, d.jar, d.do === 'jar-out' ? -amt : amt));
          return;
        }
        case 'jar-new': desk.act(() => V.addJar(store, { name: el.querySelector('#jar-name').value, target: el.querySelector('#jar-target').value })); return;
        case 'csv': saveAs(`books-${period}.csv`, csvOf(store, store.data.ledger.entries.filter((x) => V.inPeriod(x, period))), 'text/csv'); return;
        case 'add-bank': addingBank = !addingBank; desk.rerender(); return;
        case 'save-bank': {
          const name = el.querySelector('#bn-name').value.trim();
          const url = el.querySelector('#bn-url').value.trim();
          if (!name) { toast('Name the bank', { error: true }); return; }
          if (!/^https:\/\//i.test(url)) { toast('A bank’s address starts with https://', { error: true }); return; }
          const r = desk.act(() => ({ act: store.conf({ banks: [...(store.settings.banks ?? []), { name, url }] }, 'added ' + name) }));
          if (r) { addingBank = false; desk.rerender(); }
          return;
        }
        case 'save-co': {
          const company = el.querySelector('#co-name-in').value.trim();
          const pct = el.querySelector('#co-tax').value.trim();
          const taxRate = pct === '' ? 0 : Number(pct.replace('%', '')) / 100;
          const search = el.querySelector('[data-do="search"].on')?.dataset.v || 'duck';
          const state = el.querySelector('#co-state').value;
          const entity = el.querySelector('#co-entity').value;
          const formed = el.querySelector('#co-formed').value;
          const taxExempt = !!el.querySelector('#co-exempt')?.checked;
          if (!company) { toast('The company needs a name', { error: true }); return; }
          desk.act(() => ({ act: store.conf({ company, taxRate: V.round2(taxRate * 10000) / 10000, search, state, entity, formed, taxExempt }, 'company settings') }));
          return;
        }
        case 'search':
          b.parentElement.querySelectorAll('[data-do="search"]').forEach((c) => c.classList.toggle('on', c === b));
          try { localStorage.setItem('wc.search', d.v); } catch {}
          return;
        case 'ai':
          desk.act(() => ({ act: store.conf({ ai: d.v === '1' }, d.v === '1' ? 'intelligence asked for' : 'intelligence off') }));
          if (d.v === '1') toast('Not connected yet. Mail still files by the address it was sent to.');
          return;
        case 'where': {
          if (d.v !== 'cloud') { cloudAsk = false; store.keepLocal(); desk.rerender(); return; }
          cloudAsk = true;
          desk.rerender();
          store.moveToCloud().then(() => { cloudAsk = false; toast('The locked copy is in the cloud.'); desk.rerender(); })
            .catch((err) => { if (err?.code === 'signin' || err?.code === 'phrase') return; toast(err?.message || 'The cloud did not take it', { error: true }); });
          return;
        }
        case 'cloud-go': {
          const email = el.querySelector('#cloud-email')?.value || '';
          const pass = el.querySelector('#cloud-pass')?.value || '';
          const phrase = el.querySelector('#cloud-phrase')?.value || '';
          const again = el.querySelector('#cloud-phrase2')?.value || '';
          if (phrase !== again) { toast('Type the passphrase the same way twice', { error: true }); return; }
          store.moveToCloud({ email, pass, phrase }).then(() => { cloudAsk = false; toast('The locked copy is in the cloud.'); desk.rerender(); })
            .catch((err) => toast(err?.message || 'The cloud did not take it', { error: true }));
          return;
        }
        case 'logo-off': desk.act(() => ({ act: store.conf({ logo: '' }, 'took the logo off') })); return;
        case 'export': saveAs(`war-chief-backup-${todayIso()}.json`, JSON.stringify(store.exportAll(), null, 1)); return;
        case 'backup-yes': {
          const r = desk.act(() => ({ act: store.importAll(backup.json) }), { say: 'Brought in ' + backup.name });
          if (r) { backup = null; desk.rerender(); }
          return;
        }
        case 'backup-no': backup = null; desk.rerender();
      }
    };
    // the paper and line chips change the look at once, each a setting of its own
    el.querySelectorAll('[data-paper]').forEach((c) => c.addEventListener('click', () => desk.act(() => ({ act: store.conf({ paper: c.dataset.paper }, 'the paper') }), { keep: true })));
    el.querySelectorAll('[data-line]').forEach((c) => c.addEventListener('click', () => desk.act(() => ({ act: store.conf({ line: c.dataset.line }, 'the line colour') }), { keep: true })));
  },
};
