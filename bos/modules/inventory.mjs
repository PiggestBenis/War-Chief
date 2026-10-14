// INVENTORY — the first station on the line, nested the way Matt's sellable desk was (2026-10-05
// 20:46Z: "under product had all materials, under materials we had all sourcing and counts in one
// easy to read table. open product all materials expand, open a material and all sourcing expands
// from its collapsed form"). One collapsed row per product reads its name, what a batch uses (one
// total per kind of measure, stacked in the same column as its materials' amounts: his "the g per
// batch rides over vertical inline with the other per batch units"), what a batch costs and how
// many are on the shelf. Open, it lists its materials; a material opens to the places that sell it.
// Every number is typed where it shows and saved as the cursor leaves it, one act each, so Undo takes
// back one change, and the page explains nothing (his 20:46Z: "invisibly wired to act how you want
// without explanation"). The acts are verbs.mjs, THE FORMULA AND ITS SOURCES.
//
// Colour is the thing's own severity, as everywhere on the desk: RED when what is on hand covers
// less than one batch (a bottleneck: nothing can be made until it is bought), GOLD under the
// product's own alert in batches (Alert at, 3 to start). A batch is costed from each material's
// pinned source (a buy pins the source it came from), else its cheapest priced one
// (costing.pickOffer); a material with no price reads a dash, and the batch's cost then reads "≥",
// a floor, never a total.
import * as V from './verbs.mjs';
import { batchCost, offersFor, pickOffer, wacOf, isUnknownCost, pourCost, dimOf, totalsByDim, toItemUnit } from './costing.mjs';
import { unitOptions, askUnit, askPer, qty, outLink, cell, unitPrice, searchUrl, todayIso } from './ui.mjs';

// view state, kept across re-draws: which products and materials are open, and the rows being typed
const GOODS = '~goods';        // the products bought to sell as they came
const SUPPLIES = '~supplies';  // materials no product uses
const openDolls = new Set();
const openMats = new Set();    // `${doll}|${itemId}`
const newLines = new Map();    // doll -> { name, qty, unit, have }
const newWork = new Map();     // recipe id -> { classId, name, rate, hours }
const newSrc = new Map();      // `${doll}|${itemId}` -> { vendorName, url, price, qty, unit, autoName }
const autoSrc = new Set();     // `${doll}|${itemId}` whose source form opened by itself: saved, it folds back
let newProduct = null;         // { name, price, kind, auto }
let askedFirst = false;        // an empty page opens a product row once; × keeps it shut
let draft = null;              // the Buy card: what a receipt said, or Buy pressed
let linkDraft = null;          // a supplier's link dropped on the desk: { name, url, itemId }
let painting = false;          // true while this page is drawn, so a field it removes saves nothing
let leave = null;              // the focus-leaving handler of the page on screen
const wired = new WeakSet();
const blankLine = () => ({ itemId: '', name: '', unit: 'each', qty: '', price: '' });
const freshDraft = () => ({ vendor: '', url: '', lines: [blankLine()], paid: '', arrived: true, personal: false, date: '', read: null });

const isGoods = (it) => it.kind === 'finished' || it.kind === 'goods';
const materialsOf = (store) => store.data.inventory.items.filter((i) => i.kind !== 'finished')
  .sort((a, b) => String(a.name).localeCompare(String(b.name)));
const classesOf = (store) => (Array.isArray(store.settings.laborClasses) ? store.settings.laborClasses : []);
const productsFor = (store, r) => store.data.products.products
  .filter((p) => p.recipeId === r.id || (!p.recipeId && r.product && p.itemId === r.product));
const productOfRecipe = (store, r) => { const ps = productsFor(store, r); return ps.find((p) => (Number(p.units) || 1) === 1) ?? ps[0] ?? null; };
const planned = (store) => store.data.reservations.reservations.filter((x) => x.status === 'planned')
  .sort((a, b) => String(a.date).localeCompare(String(b.date)));
const onTheWay = (store) => store.data.sourcing.pos.filter((p) => p.status === 'placed' || p.status === 'ordered' || p.status === 'open');
const madeRecipes = (store) => store.data.recipes.recipes.filter((r) => r.product);
const alertOf = (r) => (Number(r.alertBatches) > 0 ? Number(r.alertBatches) : 0);
const bottlenecks = (store) => madeRecipes(store).filter((r) => batchCost(store, r).batches === 0);
const usesOf = (r) => [...(r.lines ?? []), ...(r.perUnitPackaging ?? [])];
// the products a material is in, made ones first
const recipesUsing = (store, itemId) => store.data.recipes.recipes.filter((r) => usesOf(r).some((l) => l.itemId === itemId))
  .sort((a, b) => (b.product ? 1 : 0) - (a.product ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
const itemByName = (store, name) => {
  const n = String(name ?? '').trim().toLowerCase();
  return n ? store.data.inventory.items.find((x) => String(x.name).toLowerCase() === n) ?? null : null;
};
const shown = (store, it) => !it.retired || Math.abs(store.stockOf(it.id)) > 1e-9;
// a number as a field holds it: at most three decimals, no thousands commas
const fmt = (n) => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? '' : String(Math.round(Number(n) * 1000) / 1000));
const toggle = (set, k) => (set.has(k) ? set.delete(k) : set.add(k));
const CHEV = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

// how a product stands: red under one batch, gold under its own alert, else nothing
const standing = (bc, alertAt) => (bc.batches === null ? '' : bc.batches < 1 ? 'out' : alertAt > 0 && bc.batches < alertAt ? 'low' : '');
const lineStanding = (l, alertAt) => (l.covers === null ? '' : l.covers < 1 ? 'out' : alertAt > 0 && l.covers < alertAt ? 'low' : '');
// a supply or a thing bought to sell: gold at or under its own alert, or below zero (count it)
const itemStanding = (store, it) => {
  const have = store.stockOf(it.id);
  return have < -1e-9 || (Number(it.reorderAt) > 0 && have <= Number(it.reorderAt) + 1e-9) ? 'low' : '';
};

// planned batches walked in date order against what is on hand: what runs short, and by how much
function shortfalls(store) {
  const left = new Map();
  const rows = [];
  for (const rsv of planned(store)) {
    const r = store.resolve('recipe:' + rsv.recipeId);
    if (!r) continue;
    const n = Number(rsv.batches) > 0 ? Number(rsv.batches) : 1;
    for (const x of batchCost(store, r).lines) {
      if (x.need === null || !x.item) continue;
      if (!left.has(x.itemId)) left.set(x.itemId, store.stockOf(x.itemId));
      const want = x.need * n;
      const have = left.get(x.itemId);
      if (have + 1e-9 < want) rows.push({ rsv, item: x.item, short: want - Math.max(0, have) });
      left.set(x.itemId, have - want);
    }
  }
  return rows;
}

// why a batch has no cost: the first material it used that had no price (or only part of one)
function whyNoCost(store, b) {
  const ref = 'batch:' + b.code;
  for (const m of store.data.inventory.moves) {
    if (m.kind !== 'consume' || !(m.refs ?? []).includes(ref)) continue;
    const w = wacOf(store, m.itemId, b.date);
    const name = store.resolve('item:' + m.itemId)?.name ?? m.itemId;
    if (isUnknownCost(w)) return `${name} had no price on the books when it was made`;
    if (w.partial) return `part of the ${name} it used had no purchase on the books`;
  }
  return b.yieldActual > 0 ? 'it used no materials on the books' : 'it made nothing';
}

// where a link, or the page opened at an address, lands: the product and the material that hold it
function place(store, ref) {
  if (!ref) return;
  if (ref === 'buy') { draft ??= freshDraft(); return; }
  if (ref === 'new') { newProduct ??= { name: '', price: '', kind: 'made' }; newProduct.auto = false; return; }
  if (ref === 'goods') { openDolls.add(GOODS); return; }
  if (ref === 'supplies') { openDolls.add(SUPPLIES); if (!newLines.has(SUPPLIES)) newLines.set(SUPPLIES, { name: '', qty: '', unit: '', have: '' }); return; }
  const cut = ref.indexOf(':');
  const type = ref.slice(0, cut);
  const id = ref.slice(cut + 1);
  const rec = store.resolve(ref);
  if (type === 'recipe') openDolls.add(id);
  else if (type === 'batch') { const r = store.resolve('recipe:' + rec?.recipeId) ?? store.data.recipes.recipes.find((x) => x.product === rec?.product); if (r) openDolls.add(r.id); }
  else if (type === 'reservation') { if (rec?.recipeId) openDolls.add(rec.recipeId); }
  else if (type === 'item') openItem(store, id);
  else if (type === 'po') openItem(store, rec?.lines?.[0]?.itemId);
  else if (type === 'move') openItem(store, rec?.itemId);
  else if (type === 'vendor') openItem(store, rec?.offers?.[0]?.itemId);
}
function openItem(store, id) {
  const it = id ? store.resolve('item:' + id) : null;
  if (!it) return;
  const made = store.data.recipes.recipes.find((r) => r.product === id);
  if (made) { openDolls.add(made.id); return; }
  const key = isGoods(it) ? GOODS : recipesUsing(store, id)[0]?.id ?? SUPPLIES;
  openDolls.add(key);
  openMats.add(key + '|' + id);
}

// --- a receipt or a link dropped on the desk ---------------------------------------------------
// Matt, 2026-10-04 20:47Z: "I can drag and drop my order receipt with the price and website and the
// inventory and ledger inventory supply is added ledger money is subtracted." files.readReceipt
// reads the words; here each bought line is tied to a material on file and the Buy card is filled.
// Nothing is bought until Buy is pressed, and a line that is tied to nothing stops Buy until it is
// picked or removed, because its money would otherwise be spread over the other materials.

// a name's words, lower case, a plural's s taken off, so "Tins" and "tin" are the same word
const nameWords = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
  .filter((w) => w.length >= 2).map((w) => w.replace(/(?<=[a-z]{3})s$/, ''));

// The material a receipt line names: one whose every name word is in the line. Of several, the one
// with the most words ("olive oil" over "oil"); two equally long tie nothing, and nobody guesses.
export function materialFor(store, words) {
  const said = new Set(nameWords(words));
  const hits = materialsOf(store).map((it) => ({ it, w: nameWords(it.name) })).filter((x) => x.w.length && x.w.every((w) => said.has(w)));
  if (!hits.length) return null;
  const most = Math.max(...hits.map((x) => x.w.length));
  const top = hits.filter((x) => x.w.length === most);
  return top.length === 1 ? top[0].it : null;
}

// Sites a receipt names that are not where the goods came from: the payment, the carrier, the mail.
const NOT_SUPPLIER = /(^|\.)(paypal|venmo|stripe|usps|ups|fedex|dhl|google|gmail|facebook|instagram|twitter|x|youtube|pinterest|tiktok|apple|microsoft|outlook|live|yahoo|shopify|klaviyo|mailchimp|squarespace|wix)\.com$/i;
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// where the receipt is from: a source on file whose site it names, else one whose name it names,
// else the first site it names that is not a payment, carrier or mail service, by its name
// (amazon.com is Amazon); else nothing
function supplierOf(store, r) {
  const vendors = store.data.sourcing.vendors;
  for (const h of r.hosts) {
    const v = vendors.find((x) => { const vh = hostOf(x.url); return vh && (vh === h || h.endsWith('.' + vh)); });
    if (v) return { name: v.name, url: v.url ?? '' };
  }
  const t = String(r.text ?? '').toLowerCase();
  const named = vendors.filter((v) => String(v.name ?? '').trim() && new RegExp('(^|[^a-z0-9])' + escRe(String(v.name).toLowerCase()) + '([^a-z0-9]|$)').test(t));
  if (named.length === 1) return { name: named[0].name, url: named[0].url ?? '' };
  const h = r.hosts.find((x) => !NOT_SUPPLIER.test(x));
  return h ? { name: V.siteName('https://' + h) || h, url: 'https://' + h } : { name: '', url: '' };
}

const COUNTS = new Set(['each', 'dozen', 'pair']);
const money2 = (n) => (Math.round(n * 100) / 100).toFixed(2);

// one bought line of the receipt as a line of the Buy card: how much in which unit, from the
// count and the pack size the words carry ("2 × Beeswax 1 lb" is 2 lb of a material kept in lb)
function receiptLine(store, x) {
  const it = materialFor(store, x.words);
  const n = Number(x.qty) > 0 ? Number(x.qty) : 1;
  const read = (x.qty ? x.qty + ' × ' : '') + x.words;
  let unit, q;
  if (it && COUNTS.has(it.unit)) { unit = 'each'; q = n; }
  else if (x.size) { unit = x.size.unit; q = Math.round(n * x.size.n * 1000) / 1000; }
  else if (it) { unit = it.unit; q = ''; }
  else { unit = 'each'; q = n; }
  return { itemId: it?.id ?? '', name: '', unit, qty: q === '' ? '' : String(q), price: money2(x.price), read };
}

// A receipt read from a drop fills the Buy card. Says where to go and what was read.
function takeReceipt(store, r) {
  const v = supplierOf(store, r);
  draft = freshDraft();
  draft.vendor = v.name;
  draft.url = v.url;
  draft.paid = r.total !== null && r.total !== undefined ? money2(r.total) : '';
  draft.date = r.date && r.date <= todayIso() ? r.date : '';
  draft.lines = r.items.map((x) => receiptLine(store, x));
  draft.read = { gap: r.gap, total: r.total, itemsSum: r.itemsSum, shipping: r.shipping ?? null, tax: r.tax ?? null,
    discount: r.discount ?? null, fee: r.fee ?? null, unread: (r.unread ?? []).slice(0, 6) };
  const tied = draft.lines.filter((l) => l.itemId).length;
  const n = draft.lines.length;
  return { hash: '#inventory/buy', draft, say: `Read a receipt: ${n} line${n === 1 ? '' : 's'}, ${tied} tied to your materials${tied < n ? `; pick what the other${n - tied === 1 ? ' is' : 's are'}` : ''}. Check it, then tap Buy` };
}

// A link alone is a place something can be bought: it waits at the top of the page, named by its
// site (amazon.com is Amazon), until what it sells is picked. A site already on file opens that
// source where it sits.
function takeLink(store, r) {
  const had = store.data.sourcing.vendors.find((x) => hostOf(x.url) === r.host);
  if (had) return { hash: '#inventory/vendor:' + had.id, say: `${had.name} is already a source, at ${hostOf(had.url)}` };
  linkDraft = { name: V.siteName(r.url) || r.host, url: r.url, itemId: '' };
  return { hash: '#inventory/sources', say: `Read a link to ${r.host}. Pick what it sells and tap Add` };
}

// what a row or a field change asks of a formula, as the whole list the verb takes
function lineEdit(r, itemId, { qty: q, unit }) {
  const inEach = (r.perUnitPackaging ?? []).some((l) => l.itemId === itemId);
  const y = Number(r.yieldPlanned) > 0 ? Number(r.yieldPlanned) : 1;
  const next = (inEach ? r.perUnitPackaging : r.lines).map((l) => (l.itemId !== itemId ? l : {
    ...l,
    // a line for each one made shows (and is typed as) what the whole batch uses
    ...(q !== undefined ? { qty: inEach ? Math.round((q / y) * 1e6) / 1e6 : q } : {}),
    ...(unit !== undefined ? { unit } : {}),
  }));
  return inEach ? { packaging: next } : { lines: next };
}
const laborList = (r) => (r.labor ?? []).map((l) => ({ classId: l.classId, hours: l.hours }));
const amount = (v) => Number(String(v ?? '').replace(/[$,\s]/g, ''));

export const station = {
  id: 'inventory',
  title: 'Inventory',
  badge: (store) => bottlenecks(store).length,
  takeReceipt,
  takeLink,
  commands: () => [
    { label: 'Add a product', hint: 'Inventory', hash: '#inventory/new' },
    { label: 'Make a batch', hint: 'Inventory', hash: '#inventory' },
    { label: 'Buy something', hint: 'Inventory', hash: '#inventory/buy' },
    { label: 'Count stock', hint: 'Inventory', hash: '#inventory' },
    { label: 'Add a material', hint: 'Inventory', hash: '#inventory/supplies' },
    { label: 'Add a service or job', hint: 'Inventory', hash: '#inventory/new' },
  ],
  render(el, desk) {
    const store = desk.store;
    const esc = store.esc;
    const money = (n) => store.usd(Math.round(n * 100) / 100);
    const ref = store.route.ref ?? '';
    // a link opens what it names once, on arrival; after that a tap opens and shuts
    if (desk.fresh) place(store, ref);
    const recipes = store.data.recipes.recipes.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const items = store.data.inventory.items.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const madeHere = new Set(recipes.map((r) => r.product).filter(Boolean));
    const goods = items.filter((it) => isGoods(it) && !madeHere.has(it.id) && shown(store, it));
    const supplies = items.filter((it) => !isGoods(it) && !recipesUsing(store, it.id).length && shown(store, it));
    const classes = classesOf(store);
    const shorts = shortfalls(store);
    const ways = onTheWay(store);
    // nothing on file yet: the one thing to do is name the first product. Opened once (× keeps it
    // shut), and gone again, untyped, the moment anything else is on the page
    const empty = !recipes.length && !goods.length && !supplies.length && !draft && !linkDraft && !newLines.size && !openDolls.has(SUPPLIES);
    if (!askedFirst && empty && !newProduct) { askedFirst = true; newProduct = { name: '', price: '', kind: 'made', auto: true }; }
    else if (newProduct?.auto && !empty && !newProduct.name.trim() && !String(newProduct.price).trim()) newProduct = null;

    // ── a source of a material: who, the link, the price for a size, pinned or not ─────────────
    const srcCard = (it, { vendor: v, offer: o, unit: u }, n, need) => {
      const pinned = !!o.last;
      const calc = !(Number(o.price) > 0 && Number(o.qty) > 0) ? ''
        : !u ? `${qty(o.qty, o.unit)} · not comparable to ${it.unit}`
        : [qty(o.qty, o.unit), `${u.approx ? '≈ ' : ''}${unitPrice(store.usd, u.price)} / ${it.unit}`,
          need !== null && need !== undefined ? `${u.approx ? '≈ ' : ''}${money(need * u.price)} a batch` : ''].filter(Boolean).join(' · ');
      return `<div class="src${pinned ? ' pin' : ''}" data-ref="vendor:${esc(v.id)}" data-vendor="${esc(v.id)}">
        <div class="opt">Option ${n + 1}${pinned ? ' · Pinned' : ''}</div>
        <input class="f" data-f="sname" list="dl-vendors" value="${esc(v.name)}" placeholder="Who sells it" aria-label="Who sells it" autocomplete="off" />
        <input class="f" data-f="slink" inputmode="url" value="${esc(o.url ?? '')}" placeholder="Link" aria-label="Link" autocomplete="off" />
        <div class="trio">
          <input class="f" data-f="sprice" inputmode="decimal" value="${esc(fmt(o.price))}" placeholder="Price" aria-label="Price" />
          <input class="f" data-f="sqty" inputmode="decimal" value="${esc(fmt(o.qty))}" placeholder="Size" aria-label="Size" />
          <select class="f" data-f="sunit" aria-label="Unit">${unitOptions(o.unit || it.unit, esc)}</select>
        </div>
        ${calc ? `<div class="calc">${esc(calc)}</div>` : ''}
        <div class="srcb">
          <button type="button" class="btn sm${pinned ? ' fill' : ''}" data-do="pin" data-vendor="${esc(v.id)}" data-item="${esc(it.id)}" aria-pressed="${pinned}">${pinned ? 'Pinned' : 'Pin'}</button>
          <button type="button" class="lnk" data-do="drop-src" data-vendor="${esc(v.id)}" data-item="${esc(it.id)}">Remove</button>
          <span class="grow"></span>
          ${outLink(o.url || v.url, 'Open', esc, 'btn sm')}
          <input class="f xs" data-f="packs" inputmode="decimal" value="1" aria-label="How many to buy" />
          <button type="button" class="btn sm" data-do="bought" data-vendor="${esc(v.id)}" data-item="${esc(it.id)}">Bought</button>
        </div>
      </div>`;
    };
    const draftSrc = (key, it, d, n) => `<div class="src" data-draft="src|${esc(key)}|${esc(it.id)}">
        <div class="opt">Option ${n + 1}</div>
        <input class="f" data-f="nsname" list="dl-vendors" value="${esc(d.vendorName)}" placeholder="Who sells it" aria-label="Who sells it" autocomplete="off" />
        <input class="f" data-f="nslink" inputmode="url" value="${esc(d.url)}" placeholder="Link" aria-label="Link" autocomplete="off" />
        <div class="trio">
          <input class="f" data-f="nsprice" inputmode="decimal" value="${esc(d.price)}" placeholder="Price" aria-label="Price" />
          <input class="f" data-f="nsqty" inputmode="decimal" value="${esc(d.qty)}" placeholder="Size" aria-label="Size" />
          <select class="f" data-f="nsunit" aria-label="Unit">${unitOptions(d.unit || it.unit, esc)}</select>
        </div>
        <div class="srcb"><button type="button" class="lnk" data-do="drop-nsrc" data-item="${esc(it.id)}" tabindex="-1">Remove</button></div>
      </div>`;

    // ── a material opened: the places that sell it, what is on its way, its own settings ──────
    const matPanel = (key, it, ctx) => {
      const offers = offersFor(store, it);
      const ns = newSrc.get(key + '|' + it.id);
      const coming = ways.filter((p) => (p.lines ?? []).some((l) => l.itemId === it.id));
      const r = ctx.r;
      const approx = offers.some((o) => o.unit?.approx) || ctx.line?.approx;
      const dim = dimOf(it.unit);
      return `<div class="mp" data-ref="item:${esc(it.id)}" data-item="${esc(it.id)}" data-line="${esc(key)}/p">
        <div class="mph" data-do="mat" data-doll="${esc(key)}" data-item="${esc(it.id)}"><span>Sources</span><button type="button" class="lnk" data-do="mat" data-doll="${esc(key)}" data-item="${esc(it.id)}">Close</button></div>
        ${offers.map((o, n) => srcCard(it, o, n, ctx.line?.need ?? null)).join('')}
        ${ns ? draftSrc(key, it, ns, offers.length) : ''}
        <div class="srcb">
          <button type="button" class="btn sm" data-do="add-src" data-item="${esc(it.id)}">Add a source</button>
          ${outLink(searchUrl('buy ' + it.name), 'Search the web', esc, 'btn sm')}
        </div>
        ${coming.map((p) => {
          const v = store.resolve('vendor:' + p.vendorId);
          const ln = p.lines.find((l) => l.itemId === it.id);
          return `<div class="dl" data-ref="po:${esc(p.id)}"><span>${esc(qty(ln.qty, ln.unit))} on the way from ${esc(v?.name ?? p.vendorId)}</span><span class="grow"></span>
            <button type="button" class="btn sm" data-do="arrived-po" data-po="${esc(p.id)}">It arrived</button></div>`;
        }).join('')}
        <div class="mset">
          <input class="f grow" data-f="mname" ${r ? 'list="dl-items" ' : ''}value="${esc(it.name)}" placeholder="Name" aria-label="Name of the material" autocomplete="off" />
          ${r?.product ? `<span class="seg">
            <button type="button" class="chip sm${ctx.per === 'each' ? '' : ' on'}" data-do="per" data-v="batch" data-item="${esc(it.id)}" aria-pressed="${ctx.per !== 'each'}">Per batch</button>
            <button type="button" class="chip sm${ctx.per === 'each' ? ' on' : ''}" data-do="per" data-v="each" data-item="${esc(it.id)}" aria-pressed="${ctx.per === 'each'}">Per one made</button></span>` : ''}
          ${dim === 'mass' || dim === 'liquid' ? `<label class="al">g per ml <input class="f xs" data-f="density" inputmode="decimal" value="${esc(fmt(Number(it.density) > 0 ? it.density : ''))}" aria-label="Grams per millilitre" /></label>` : ''}
          ${r ? '' : `<label class="al">Alert at: <input class="f xs" data-f="alert" inputmode="decimal" value="${esc(fmt(Number(it.reorderAt) > 0 ? it.reorderAt : ''))}" aria-label="Alert at this many ${esc(it.unit)}" /></label>`}
        </div>
        ${approx ? `<p class="truth">⚠ A cost marked ≈ crosses weight and volume at 0.92 g per ml, an oil’s; type ${esc(it.name)}’s own g per ml for the exact cost.</p>` : ''}
        <button type="button" class="lnk wide" data-do="drop-mat" data-doll="${esc(key)}" data-item="${esc(it.id)}">${key === GOODS ? 'Remove product' : 'Remove material'}</button>
      </div>`;
    };

    // ── a material in a formula: its amount a batch, its cost, what is on hand ─────────────────
    const matRow = (r, x, line) => {
      const key = r.id;
      const it = line.item;
      const on = openMats.has(key + '|' + x.l.itemId);
      const st = r.product ? lineStanding(line, alertOf(r)) : '';
      const y = Number(r.yieldPlanned) > 0 ? Number(r.yieldPlanned) : 1;
      const perBatch = x.per === 'each' ? Number(x.l.qty) * y : Number(x.l.qty);
      const unit = String(x.l.unit || it?.unit || 'each').toLowerCase();
      return `<div class="mr${st ? ' ' + st : ''}${on ? ' on' : ''}" data-do="mat" data-doll="${esc(key)}" data-item="${esc(x.l.itemId)}" data-ref="item:${esc(x.l.itemId)}" data-line="${esc(key)}">
          <span class="n">${esc(it?.name ?? x.l.itemId)}</span>
          <span class="q"><input class="di num" data-f="qty" inputmode="decimal" value="${esc(fmt(perBatch))}" aria-label="${esc(it?.name ?? '')} ${r.product ? 'a batch' : 'a job'}" /><span class="uw"><select class="di" data-f="unit" aria-label="Unit">${unitOptions(unit, esc)}</select></span></span>
          <span class="c">${line.cost === null ? '—' : (line.approx ? '≈ ' : '') + esc(money(line.cost))}</span>
          <span class="oh">${it ? `<input class="di num" data-f="have" data-item="${esc(it.id)}" inputmode="decimal" value="${esc(fmt(line.have))}" aria-label="On hand of ${esc(it.name)}, in ${esc(it.unit)}" title="${esc(it.unit)}" />` : ''}</span>
          <button type="button" class="v" data-do="mat" data-doll="${esc(key)}" data-item="${esc(x.l.itemId)}" aria-expanded="${on}" aria-label="Sources of ${esc(it?.name ?? '')}">${CHEV}</button>
        </div>${on && it ? matPanel(key, it, { r, line, per: x.per }) : ''}`;
    };

    // ── the work a batch takes ─────────────────────────────────────────────────────────────
    const workRow = (r, w, i) => `<div class="mr wr" data-line="${esc(r.id)}/w${i}">
        <span class="n"><span class="uw"><select class="di" data-f="wclass" data-i="${i}" aria-label="Kind of worker">
          ${classes.map((c) => `<option value="${esc(c.id)}"${c.id === w.classId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
          ${classes.some((c) => c.id === w.classId) ? '' : `<option value="${esc(w.classId)}" selected>${esc(w.name)} (no longer on file)</option>`}
        </select></span></span>
        <span class="q"><input class="di num" data-f="whours" data-i="${i}" inputmode="decimal" value="${esc(fmt(w.hours))}" aria-label="Hours a batch" /><i class="u">h</i></span>
        <span class="c">${w.cost === null ? '—' : esc(money(w.cost))}</span>
        <span class="oh">${w.rate === null ? '' : esc(money(w.rate)) + '/h'}</span>
        <button type="button" class="v x" data-do="drop-work" data-i="${i}" aria-label="Remove ${esc(w.name)}">×</button>
      </div>`;

    // ── the rows being typed: a material, the work, a product ──────────────────────────────
    const draftRow = (key, r) => {
      const d = newLines.get(key);
      const hit = itemByName(store, d.name);
      const unit = d.unit || hit?.unit || 'each';
      return `<div class="mr new" data-draft="line|${esc(key)}" data-line="${esc(key)}/new">
          <span class="n"><input class="di" data-f="nname" list="dl-items" value="${esc(d.name)}" placeholder="Material" aria-label="Material" autocomplete="off" /></span>
          <span class="q">${r ? `<input class="di num" data-f="nqty" inputmode="decimal" value="${esc(d.qty)}" placeholder="#" aria-label="How much ${r.product ? 'a batch' : 'a job'} uses" />` : '<span></span>'}<span class="uw"><select class="di" data-f="nunit" aria-label="Unit">${unitOptions(unit, esc)}</select></span></span>
          <span class="c"></span>
          <span class="oh">${hit ? esc(qty(store.stockOf(hit.id))) : `<input class="di num" data-f="nhave" inputmode="decimal" value="${esc(d.have)}" placeholder="On hand" aria-label="On hand" />`}</span>
          <button type="button" class="v x" data-do="drop-new" data-doll="${esc(key)}" tabindex="-1" aria-label="Remove">×</button>
        </div>`;
    };
    const draftWork = (r) => {
      const d = newWork.get(r.id);
      const fresh = !classes.length || d.classId === '__new';
      return `<div class="mr wr new" data-draft="work|${esc(r.id)}" data-line="${esc(r.id)}/neww">
          <span class="n">${classes.length ? `<span class="uw"><select class="di" data-f="nwclass" aria-label="Kind of worker">
            ${classes.map((c) => `<option value="${esc(c.id)}"${c.id === d.classId ? ' selected' : ''}>${esc(c.name)} · ${esc(money(Number(c.rate) || 0))}/h</option>`).join('')}
            <option value="__new"${d.classId === '__new' ? ' selected' : ''}>+ Custom</option></select></span>` : ''}
            ${fresh ? `<input class="di" data-f="nwname" value="${esc(d.name)}" placeholder="Who: helper, skilled, me" aria-label="Kind of worker" autocomplete="off" />
            <input class="di" data-f="nwrate" inputmode="decimal" value="${esc(d.rate)}" placeholder="An hour costs $" aria-label="What an hour costs" />` : ''}</span>
          <span class="q"><input class="di num" data-f="nwhours" inputmode="decimal" value="${esc(d.hours)}" placeholder="Hours" aria-label="Hours a batch" /><i class="u">h</i></span>
          <span class="c"></span><span class="oh"></span>
          <button type="button" class="v x" data-do="drop-neww" tabindex="-1" aria-label="Remove">×</button>
        </div>`;
    };

    // ── a product's foot: add to it, how many a batch makes, the alert, lock, make, plan ───────
    const footer = (r, bc) => {
      const made = !!r.product;
      const p = productOfRecipe(store, r);
      const y = Number(r.yieldPlanned) > 0 ? Number(r.yieldPlanned) : 0;
      const each = made && y > 0 && (bc.lines.length || bc.labor.length) && (!bc.unknown || bc.total > 0) ? (bc.unknown ? '≥ ' : '') + money(bc.total / y) + ' each' : '';
      const plans = planned(store).filter((x) => x.recipeId === r.id);
      const recent = made ? store.data.inventory.batches.filter((b) => b.product === r.product)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.code).localeCompare(String(a.code))).slice(0, 3) : [];
      const lock = `<button type="button" class="btn sm${r.locked ? '' : ' fill'}" data-do="lock" aria-pressed="${!!r.locked}">${r.locked ? 'Locked' : 'Lock formula'}</button>`;
      const name = p ? `<input class="f grow" data-f="pname" value="${esc(p.name)}" placeholder="Name" aria-label="Name of the product" autocomplete="off" />` : '<span class="grow"></span>';
      return `<div class="df">
        <div class="two">
          <button type="button" class="btn" data-do="add-mat">Add material</button>
          ${made ? '<button type="button" class="btn" data-do="add-work">Add work</button>' : ''}
        </div>
        ${made ? `<div class="frow fset">
          <input class="f s" data-f="made" inputmode="decimal" value="${esc(fmt(y || ''))}" placeholder="# Made" aria-label="How many one batch makes" />
          ${name}
          <label class="al">Alert at: <input class="f xs" data-f="alertb" inputmode="numeric" value="${esc(fmt(alertOf(r) || ''))}" aria-label="Alert under this many batches" /></label>
        </div>
        <div class="frow">
          ${lock}
          <span class="mk">
            <input class="f xs" data-f="batches" inputmode="decimal" value="1" aria-label="Batches" />
            <input class="f s" data-f="came" inputmode="decimal" placeholder="# Came out" aria-label="How many came out in all" />
            <button type="button" class="btn sm fill" data-do="make">Make batch</button>
          </span>
        </div>
        <div class="frow">
          <span class="each">${esc(each)}</span>
          <span class="mk">
            <input class="f d" type="date" data-f="day" value="${esc(todayIso())}" aria-label="Plan it for" />
            <button type="button" class="btn sm" data-do="plan">Plan</button>
          </span>
        </div>
        ${plans.map((x) => {
          const short = shorts.filter((s) => s.rsv.id === x.id);
          return `<div class="dl" data-ref="reservation:${esc(x.id)}"><span>${esc(x.date)} · ${esc(qty(x.batches))} planned</span>
            <span class="grow short">${short.length ? 'short ' + esc(short.map((s) => qty(s.short, s.item.unit) + ' ' + s.item.name).join(', ')) : ''}</span>
            <button type="button" class="btn sm" data-do="make-planned" data-rsv="${esc(x.id)}">Make it now</button></div>`;
        }).join('')}
        ${recent.map((b) => {
          const pc = pourCost(store, b.code);
          const labor = Number(b.laborCost) || 0;
          const one = pc ? pc.perUnit + (b.yieldActual > 0 ? labor / b.yieldActual : 0) : null;
          return `<div class="dl" data-ref="batch:${esc(b.code)}"><span>${esc(b.date ?? '')} · ${esc(qty(b.yieldActual))} made</span><span class="grow"></span>
            <span>${one !== null ? esc(money(one)) + ' each' : '⚠ cost unknown: ' + esc(whyNoCost(store, b))}</span></div>`;
        }).join('')}` : `<div class="frow">${name}${lock}</div>`}
        <button type="button" class="lnk wide" data-do="drop-product">Remove product</button>
      </div>`;
    };

    // ── a product: its row, and opened, its materials, its work and its foot ─────────────────
    const doll = (r) => {
      const on = openDolls.has(r.id);
      const bc = batchCost(store, r);
      const made = !!r.product;
      const fin = made ? store.resolve('item:' + r.product) : null;
      const st = made ? standing(bc, alertOf(r)) : '';
      const y = Number(r.yieldPlanned) > 0 ? Number(r.yieldPlanned) : 1;
      const unitOf = (l) => l.unit || store.resolve('item:' + l.itemId)?.unit;
      const totals = totalsByDim([...(r.lines ?? []).map((l) => ({ qty: l.qty, unit: unitOf(l) })),
        ...(made ? (r.perUnitPackaging ?? []).map((l) => ({ qty: Number(l.qty) * y, unit: unitOf(l) })) : [])]);
      // what is known of a batch's cost: a floor (≥) while a material has no price, nothing while none has one
      const cost = (bc.lines.length || bc.labor.length) && (!bc.unknown || bc.total > 0) ? (bc.unknown ? '≥ ' : '') + money(bc.total) : '—';
      const rows = [...(r.lines ?? []).map((l) => ({ l, per: 'batch' })), ...(made ? (r.perUnitPackaging ?? []).map((l) => ({ l, per: 'each' })) : [])];
      return `<section class="doll${on ? ' on' : ''}${st ? ' ' + st : ''}" data-ref="recipe:${esc(r.id)}" data-doll="${esc(r.id)}">
        <div class="dh" data-do="doll"${fin ? ` data-ref="item:${esc(fin.id)}"` : ''}>
          <span class="n">${fin ? `(${Math.max(0, Math.floor(store.stockOf(fin.id) + 1e-9))}) ` : ''}${esc(r.name)}</span>
          <span class="q">${totals.map((t) => `<span class="tl"><b>${esc(qty(t.qty))}</b><i>${esc(t.unit)}</i></span>`).join('')}</span>
          <span class="c"${bc.unknown ? ' title="At least: a material has no price yet"' : ''}>${esc(cost)}</span>
          <span class="oh">${!fin ? '—' : on ? `<input class="di num" data-f="have" data-item="${esc(fin.id)}" inputmode="decimal" value="${esc(fmt(store.stockOf(fin.id)))}" aria-label="${esc(r.name)} on the shelf" />` : esc(qty(store.stockOf(fin.id)))}</span>
          <button type="button" class="v" data-do="doll" aria-expanded="${on}" aria-label="${on ? 'Close' : 'Open'} ${esc(r.name)}">${CHEV}</button>
        </div>
        ${on ? `<div class="db">
          <div class="cap"><span class="n">Material</span><span class="q">${made ? 'Per batch' : 'Per job'}</span><span class="c">Cost</span><span class="oh">On hand</span><span class="v"></span></div>
          ${rows.map((x, i) => matRow(r, x, bc.lines[i])).join('')}
          ${made ? bc.labor.map((w, i) => workRow(r, w, i)).join('') : ''}
          ${newLines.has(r.id) ? draftRow(r.id, r) : ''}
          ${made && newWork.has(r.id) ? draftWork(r) : ''}
          ${footer(r, bc)}
        </div>` : ''}
      </section>`;
    };

    // ── what is bought to sell as it came, and the supplies no product uses ──────────────────
    const ANCHOR = { [GOODS]: 'data-ref="goods"', [SUPPLIES]: 'data-ref="supplies"' };
    const itemRow = (key, it) => {
      const on = openMats.has(key + '|' + it.id);
      const st = itemStanding(store, it);
      const pick = pickOffer(store, it);
      const w = pick ? null : wacOf(store, it.id);
      const each = pick ? pick.unit.price : w && !isUnknownCost(w) ? w.unitCost : null;
      const price = each === null ? '—' : (pick?.unit.approx ? '≈ ' : '') + unitPrice(store.usd, each) + (it.unit === 'each' ? '' : ' / ' + it.unit);
      return `<div class="mr${st ? ' ' + st : ''}${on ? ' on' : ''}" data-do="mat" data-doll="${esc(key)}" data-item="${esc(it.id)}" data-ref="item:${esc(it.id)}" data-line="${esc(key)}">
          <span class="n">${key === GOODS ? `(${Math.max(0, Math.floor(store.stockOf(it.id) + 1e-9))}) ` : ''}${esc(it.name)}</span><span class="q">${key === SUPPLIES ? `<span></span><span class="uw"><select class="di" data-f="iunit" aria-label="What ${esc(it.name)} is counted in">${unitOptions(it.unit, esc)}</select></span>` : ''}</span>
          <span class="c">${esc(price)}</span>
          <span class="oh"><input class="di num" data-f="have" data-item="${esc(it.id)}" inputmode="decimal" value="${esc(fmt(store.stockOf(it.id)))}" aria-label="On hand of ${esc(it.name)}, in ${esc(it.unit)}" title="${esc(it.unit)}" /></span>
          <button type="button" class="v" data-do="mat" data-doll="${esc(key)}" data-item="${esc(it.id)}" aria-expanded="${on}" aria-label="Sources of ${esc(it.name)}">${CHEV}</button>
        </div>${on ? matPanel(key, it, { r: null, line: null }) : ''}`;
    };
    const groupDoll = (key, title, list) => {
      const on = openDolls.has(key);
      return `<section class="doll${on ? ' on' : ''}${list.some((it) => itemStanding(store, it)) ? ' low' : ''}" ${ANCHOR[key]} data-doll="${esc(key)}">
        <div class="dh" data-do="doll"><span class="n">${esc(title)}</span><span class="q"></span><span class="c"></span><span class="oh"></span>
          <button type="button" class="v" data-do="doll" aria-expanded="${on}" aria-label="${on ? 'Close' : 'Open'} ${esc(title)}">${CHEV}</button></div>
        ${on ? `<div class="db">
          <div class="cap"><span class="n">${key === GOODS ? 'Product' : 'Material'}</span><span class="q"></span><span class="c">Cost</span><span class="oh">On hand</span><span class="v"></span></div>
          ${list.map((it) => itemRow(key, it)).join('')}
          ${key === SUPPLIES && newLines.has(key) ? draftRow(key, null) : ''}
          ${key === SUPPLIES ? '<div class="df"><div class="two"><button type="button" class="btn" data-do="add-mat">Add material</button></div></div>' : ''}
        </div>` : ''}
      </section>`;
    };
    const npDoll = () => `<section class="doll on" data-ref="new" data-draft="product|new">
        <div class="dh new"><span class="n"><input class="di" data-f="npname" value="${esc(newProduct.name)}" placeholder="${newProduct.kind === 'service' ? 'Service name' : 'Product name'}" aria-label="Name" autocomplete="off" /></span>
          <span class="q"></span><span class="c"></span><span class="oh"></span>
          <button type="button" class="v x" data-do="drop-np" tabindex="-1" aria-label="Cancel">×</button></div>
        <div class="df"><div class="frow">
          <input class="f s" data-f="npprice" inputmode="decimal" value="${esc(newProduct.price)}" placeholder="Price" aria-label="Price of one" />
          <span class="seg">
            ${[['made', 'Made'], ['bought', 'Bought'], ['service', 'Service']].map(([k, label]) => `<button type="button" class="chip sm${newProduct.kind === k ? ' on' : ''}" data-do="np-kind" data-v="${k}" aria-pressed="${newProduct.kind === k}">${label}</button>`).join('')}
          </span>
        </div></div>
      </section>`;

    // ── the Buy card: a receipt read, or Buy pressed ─────────────────────────────────────────
    const buyCard = () => {
      const d = draft;
      const buyables = materialsOf(store).filter((it) => !it.retired || d.lines.some((l) => l.itemId === it.id));
      const lineRow = (ln, i) => {
        const opts = '<option value="">Pick what you bought</option>'
          + buyables.map((it) => `<option value="${esc(it.id)}"${it.id === ln.itemId ? ' selected' : ''}>${esc(it.name)} (${esc(it.unit)})</option>`).join('')
          + `<option value="__new"${ln.itemId === '__new' ? ' selected' : ''}>+ Custom</option>`;
        const c = (cap, input, size) => (i === 0 ? cell(cap, input, size) : input);
        const sz = (size) => (i === 0 ? '' : ' ' + size);
        return `<div class="row" data-line="${i}">
          ${c('What you bought', `<select class="f" data-f="itemId" aria-label="What you bought">${opts}</select>`)}
          ${ln.itemId === '__new' ? c('Its name', `<input class="f" data-f="name" placeholder="Name of the new material" value="${esc(ln.name)}" />`) : ''}
          ${c('How much', `<input class="f${sz('s')}" data-f="qty" inputmode="decimal" placeholder="How much" value="${esc(ln.qty)}" aria-label="How much" />`, 's')}
          ${c('Unit', `<select class="f${sz('m')}" data-f="unit" aria-label="Unit">${unitOptions(ln.unit, esc)}</select>`, 'm')}
          ${c('Line price', `<input class="f${sz('s')}" data-f="price" inputmode="decimal" placeholder="$ line" value="${esc(ln.price)}" aria-label="Price of this line" />`, 's')}
          ${d.lines.length > 1 ? `<button type="button" class="btn inline" data-do="drop-line" data-i="${i}" aria-label="Remove this line">×</button>` : ''}
        </div>${ln.read ? `<p class="note" style="margin:-2px 0 10px">From the receipt: “${esc(ln.read)}”${ln.itemId ? '' : !String(ln.name ?? '').trim() ? '. Pick what it is, or × to leave it out.' : ''}</p>` : ''}`;
      };
      const sum = d.lines.reduce((s, l) => s + (Number(l.price) || 0), 0);
      // what a dropped receipt said, checked again against the lines as they stand now
      const readBox = () => {
        const r = d.read;
        if (!r) return '';
        const extra = (r.shipping ?? 0) + (r.tax ?? 0) + (r.fee ?? 0) - (r.discount ?? 0);
        const total = Number(d.paid);
        const gap = d.paid !== '' && Number.isFinite(total) ? Math.round((total - sum - extra) * 100) / 100 : null;
        const parts = [r.shipping ? 'shipping ' + money(r.shipping) : r.shipping === 0 ? 'free shipping' : '', r.tax ? 'tax ' + money(r.tax) : '',
          r.fee ? 'fees ' + money(r.fee) : '', r.discount ? 'less ' + money(r.discount) + ' off' : ''].filter(Boolean);
        return `<p class="note">Read from a receipt${d.date ? ' dated ' + esc(d.date) + ', and booked on that day' : ''}: the lines make ${esc(money(sum))}${parts.length ? ', with ' + esc(parts.join(', ')) : ''}.</p>
          ${gap ? `<p class="truth">⚠ ${esc(money(Math.abs(gap)))} of the total paid is ${gap > 0 ? 'not on any line, nor shipping, tax or a fee it read' : 'less than the lines, shipping and tax add up to'}. Add the line it missed or fix the total; Buy spreads the total over the lines with the shipping and tax.</p>` : ''}
          ${r.unread.length ? `<p class="truth">⚠ Lines with money it did not place: ${r.unread.map((u) => '“' + esc(u) + '”').join(', ')}.</p>` : ''}`;
      };
      return `<div class="card" id="buy-form" data-ref="buy">
        <div class="mph"><b>Buy</b><button type="button" class="lnk" data-do="close-buy">Close</button></div>
        ${readBox()}
        <div class="row">
          ${cell('Where', `<input class="f" data-f="vendor" list="dl-vendors" placeholder="A store or a website" value="${esc(d.vendor)}" autocomplete="off" />`)}
          ${cell('Link to the page', `<input class="f" data-f="url" inputmode="url" placeholder="Optional" value="${esc(d.url)}" />`)}
        </div>
        ${d.lines.map(lineRow).join('')}
        <button type="button" class="btn inline" data-do="add-line" style="margin:2px 0 8px">+ Another line</button>
        ${cell('Total paid, with shipping and tax', `<input class="f" data-f="paid" inputmode="decimal" placeholder="${sum > 0 ? esc(money(sum)) + ' from the lines, or type the real total' : '$'}" value="${esc(d.paid)}" />`)}
        <div class="chips">
          <button type="button" class="chip${d.arrived ? ' on' : ''}" data-do="arrived" data-v="1" aria-pressed="${d.arrived}">It’s here</button>
          <button type="button" class="chip${d.arrived ? '' : ' on'}" data-do="arrived" data-v="0" aria-pressed="${!d.arrived}">On the way</button>
          <button type="button" class="chip${d.personal ? '' : ' on'}" data-do="personal" data-v="0" aria-pressed="${!d.personal}">Business money</button>
          <button type="button" class="chip${d.personal ? ' on' : ''}" data-do="personal" data-v="1" aria-pressed="${d.personal}">My own money</button>
        </div>
        <button type="button" class="btn fill" data-do="buy">Buy</button>
      </div>`;
    };
    // a supplier's link dropped on the desk: what it sells, then Add puts it under that material
    const linkCard = () => `<div class="card" data-ref="sources">
        <div class="mph"><b>New source</b><button type="button" class="lnk" data-do="drop-link">Close</button></div>
        <input class="f" id="src-name" placeholder="Who sells it" autocomplete="off" value="${esc(linkDraft.name)}" style="margin:6px 0" />
        <input class="f" id="src-url" inputmode="url" placeholder="Link" value="${esc(linkDraft.url)}" style="margin:6px 0" />
        <select class="f" id="src-item" aria-label="What it sells" style="margin:6px 0">
          <option value="">Pick what it sells</option>
          ${materialsOf(store).filter((it) => !it.retired).map((it) => `<option value="${esc(it.id)}"${it.id === linkDraft.itemId ? ' selected' : ''}>${esc(it.name)}</option>`).join('')}
        </select>
        <button type="button" class="btn fill" data-do="add-source">Add</button>
      </div>`;

    const packs = (store.data.products?.products ?? []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const stockRows = packs.map((p) => {
      const units = Number(p.units) > 0 ? Number(p.units) : 1;
      const have = p.itemId ? store.stockOf(p.itemId) : null;
      const n = have === null ? null : Math.max(0, Math.floor((have + 1e-9) / units));
      return `<div class="line"><span class="nm">(${n === null ? '—' : n}) ${esc(p.name)}</span><span class="amt">${esc(store.usd(Number(p.price) || 0))}</span></div>`;
    }).join('');

    painting = true;
    try {
      el.innerHTML = `
        <h1 class="title">Inventory</h1>
        ${stockRows ? `<div class="list">${stockRows}</div>` : ''}
        ${draft ? buyCard() : ''}
        ${linkDraft ? linkCard() : ''}
        <datalist id="dl-items">${items.filter((it) => !it.retired).map((it) => `<option value="${esc(it.name)}"></option>`).join('')}</datalist>
        <datalist id="dl-vendors">${store.data.sourcing.vendors.map((v) => `<option value="${esc(v.name)}"></option>`).join('')}</datalist>
        <div class="dolls">
          ${recipes.filter((r) => r.product).map(doll).join('')}
          ${recipes.filter((r) => !r.product).map(doll).join('')}
          ${goods.length ? groupDoll(GOODS, 'Bought to sell', goods) : ''}
          ${supplies.length || openDolls.has(SUPPLIES) ? groupDoll(SUPPLIES, 'Other supplies', supplies) : ''}
          ${newProduct ? npDoll() : ''}
        </div>
        <div class="btns">
          <button type="button" class="btn fill" data-do="new-product">Add product</button>
          <button type="button" class="btn" data-do="buy-open">Buy</button>
        </div>`;
    } finally { painting = false; }
    if (desk.fresh && ref === 'new') el.querySelector('[data-f="npname"]')?.focus();

    // ── what typing and a tap do ────────────────────────────────────────────────────────────
    // a field saved as the cursor leaves it: the act runs once the focus has moved on (Tab, a click
    // elsewhere), so the re-draw after it finds the field the person went to and puts them back in it
    const commit = (fn, opts = {}) => setTimeout(() => desk.act(fn, { quiet: true, keep: true, ...opts }), 0);
    const later = () => setTimeout(() => desk.rerender(), 0);
    const DRAFT = { nname: 'name', nqty: 'qty', nunit: 'unit', nhave: 'have', nwclass: 'classId', nwname: 'name', nwrate: 'rate', nwhours: 'hours',
      nsname: 'vendorName', nslink: 'url', nsprice: 'price', nsqty: 'qty', nsunit: 'unit', npname: 'name', npprice: 'price' };
    const draftOf = (which) => {
      const cut = which.indexOf('|');
      const kind = which.slice(0, cut);
      const key = which.slice(cut + 1);
      return kind === 'line' ? newLines.get(key) : kind === 'work' ? newWork.get(key) : kind === 'src' ? newSrc.get(key) : kind === 'product' ? newProduct : null;
    };
    const setDraft = (which, f, v) => { const d = draftOf(which); if (d && DRAFT[f]) d[DRAFT[f]] = v; };
    const focusIn = (sel) => el.querySelector(sel)?.focus();
    // the cursor is already in a field: a field typed in elsewhere keeps it
    const typing = () => !!document.activeElement?.matches?.('input, select, textarea');

    // A material with no source yet opens on a form for its first one, the cursor in its link, so
    // where it comes from is typed there and then; saved, the form folds back (Matt, 2026-10-06
    // 18:55Z: "when I initially add a material, I want the source to automatically pop up so I can
    // populate it without having to click Add Source … then it will collapse back"). One that opened
    // by itself and was left untouched folds away as the next opens. The form's key, or '' when none opened.
    const askSource = (key, itemId) => {
      if (!itemId || store.data.sourcing.vendors.some((v) => (v.offers ?? []).some((o) => o.itemId === itemId))) return '';
      for (const was of autoSrc) {
        if (['vendorName', 'url', 'price', 'qty'].some((f) => String(newSrc.get(was)?.[f] ?? '').trim())) continue;
        newSrc.delete(was); openMats.delete(was); autoSrc.delete(was);
      }
      const k = key + '|' + itemId;
      openMats.add(k);
      if (!newSrc.has(k)) newSrc.set(k, { vendorName: '', url: '', price: '', qty: '', unit: '' });
      autoSrc.add(k);
      return k;
    };

    // The material counted in another unit from now on (verbs.setItemUnit): one it converts to, or
    // one the books never bought, made or sold in, at once; otherwise the list first becomes a field
    // asking how many of the new unit one of the old held. Refused, the list goes back to what the
    // books hold, and the toast says why. Done, the toast offers Undo.
    const recount = (sel, it, u, then) => {
      const go = (per) => setTimeout(() => {
        const res = desk.act(() => { const x = V.setItemUnit(store, it.id, u, per ? { per } : {}); then?.(); return x; }, { keep: true });
        if (!res) desk.rerender();
      }, 0);
      if (V.recountRefusal(store, it, u) || toItemUnit(it, 1, u) !== null || !V.unitBooked(store, it.id)) { go(); return; }
      desk.toast(`${it.name} was bought, made or sold in ${it.unit}: type how many ${u} one ${it.unit} held, then Enter`);
      askPer(sel, it.unit, u, (n) => (n > 0 ? go(n) : desk.rerender()));
    };

    // a row being typed is saved when the cursor leaves the row (or Enter is pressed in it). Not
    // enough typed yet, it waits; Enter on it says what is missing.
    const saveDraft = (which, loud) => {
      const cut = which.indexOf('|');
      const kind = which.slice(0, cut);
      const key = which.slice(cut + 1);
      const d = draftOf(which);
      const want = (m) => { if (loud) desk.toast(m, { error: true }); return null; };
      if (!d) return null;
      if (kind === 'product') {
        if (!d.name.trim()) return want('Name the product first');
        const r = desk.act(() => {
          const res = V.saveProduct(store, { name: d.name, kind: d.kind, price: String(d.price).trim() === '' ? 0 : d.price,
            ...(d.kind === 'made' ? { yield: '', alertBatches: 3 } : {}) });
          newProduct = null;
          // made or a service: its materials come next; bought as it came: where it is bought
          if (d.kind === 'bought') { openDolls.add(GOODS); openMats.add(GOODS + '|' + res.itemId); }
          else { openDolls.add(res.recipeId); newLines.set(res.recipeId, { name: '', qty: '', unit: '', have: '' }); }
          return res;
        }, { keep: true, next: (res) => (d.kind === 'service' ? { label: 'Book a job', hash: '#orders/product:' + res.productId } : null) });
        if (r && loud) el.querySelector(d.kind === 'bought' ? `[data-doll="${GOODS}"] .mp[data-item="${r.itemId}"] [data-do="add-src"]` : `[data-draft="line|${r.recipeId}"] [data-f="nname"]`)?.focus();
        return r;
      }
      if (kind === 'line') {
        if (!d.name.trim()) return want('Name the material first');
        const hit = itemByName(store, d.name);
        const unit = d.unit || hit?.unit || 'each';
        const supply = key === SUPPLIES;
        const r = supply ? null : store.resolve('recipe:' + key);
        if (!supply && String(d.qty).trim() === '') return want(`Type how much ${d.name.trim()} one ${r?.product ? 'batch' : 'job'} uses`);
        let asked = '';
        const res = desk.act(() => {
          const x = supply ? V.addMaterial(store, { name: d.name, unit, have: d.have }) : V.addLine(store, key, { name: d.name, unit, qty: d.qty, have: d.have });
          newLines.delete(key);
          asked = askSource(key, supply ? x.id : x.itemId);
          return x;
        }, { quiet: true, keep: true });
        if (res && asked && !typing()) focusIn(`[data-draft="src|${asked}"] [data-f="nslink"]`);
        return res;
      }
      if (kind === 'work') {
        if (String(d.hours).trim() === '') return want('Type the hours a batch takes');
        const r = store.resolve('recipe:' + key);
        const add = d.classId && d.classId !== '__new' && classes.length ? { classId: d.classId, hours: d.hours } : { name: d.name, rate: d.rate, hours: d.hours };
        return desk.act(() => {
          const res = V.setFormula(store, key, { labor: [...laborList(r), add] });
          newWork.delete(key);
          return res;
        }, { quiet: true, keep: true });
      }
      if (kind === 'src') {
        if (!d.vendorName.trim() && !V.siteName(d.url)) return want(String(d.url).trim() ? 'A link starts with https://' : 'Say who sells it');
        const cut2 = key.lastIndexOf('|');
        const itemId = key.slice(cut2 + 1);
        const auto = autoSrc.has(key);
        const res = desk.act(() => {
          const x = V.addOffer(store, itemId, { vendorName: d.vendorName, url: d.url, price: d.price, qty: d.qty, unit: d.unit || undefined });
          newSrc.delete(key);
          if (auto) { openMats.delete(key); autoSrc.delete(key); }
          return x;
        }, { quiet: true, keep: true });
        // the form that opened by itself folds back, and the cursor goes on to the next material
        if (res && auto && !typing()) focusIn(`section.doll[data-doll="${key.slice(0, cut2)}"] [data-do="add-mat"]`);
        return res;
      }
      return null;
    };
    leave = (e) => {
      if (painting) return;
      const row = e.target.closest?.('[data-draft]');
      if (!row || row.contains(e.relatedTarget)) return;
      const which = row.dataset.draft;
      setTimeout(() => saveDraft(which, false), 0);
    };
    if (!wired.has(el)) { wired.add(el); el.addEventListener('focusout', (e) => leave?.(e)); }

    // a field on a row changed: one act, saved where it sits
    const edit = (t, f) => {
      const sec = t.closest('section.doll');
      const key = sec?.dataset.doll;
      const r = key ? store.resolve('recipe:' + key) : null;
      const itemId = t.dataset.item ?? t.closest('[data-item]')?.dataset.item;
      const it = itemId ? store.resolve('item:' + itemId) : null;
      const vendorId = t.closest('.src')?.dataset.vendor;
      const v = t.value;
      // one act a field, named by the field (a map, not a switch: these are fields, not buttons)
      const save = {
        have: () => commit(() => V.count(store, itemId, v), { quiet: false }),
        qty: () => commit(() => {
          const n = amount(v);
          if (!(n > 0)) throw new Error(`type how much ${it?.name ?? 'of it'} one ${r?.product ? 'batch' : 'job'} uses; Remove material takes it out`);
          return V.setFormula(store, r.id, lineEdit(r, itemId, { qty: n }));
        }),
        unit: () => {
          // a unit the material converts to is the line's own; any other is what the material is counted in
          const to = (u) => (!it || toItemUnit(it, 1, u) !== null ? commit(() => V.setFormula(store, r.id, lineEdit(r, itemId, { unit: u }))) : recount(t, it, u));
          if (v !== '__other') return to(v);
          askUnit(t, usesOf(r).find((l) => l.itemId === itemId)?.unit || it?.unit || 'each', to);
        },
        // Other supplies: what the material is counted in, any unit
        iunit: () => (v === '__other' ? askUnit(t, it?.unit ?? 'each', (u) => recount(t, it, u)) : recount(t, it, v)),
        made: () => commit(() => V.setFormula(store, r.id, { yieldPlanned: v })),
        pname: () => commit(() => V.renameProduct(store, productOfRecipe(store, r)?.id, v)),
        alertb: () => commit(() => V.setBatchAlert(store, r.id, v)),
        alert: () => commit(() => V.setAlert(store, itemId, v)),
        density: () => commit(() => V.setDensity(store, itemId, v)),
        mname: () => commit(() => {
          const other = itemByName(store, v);
          // a name another material has, typed over a line of a formula, puts that material in its place
          if (other && other.id !== itemId && r) {
            const res = V.swapLine(store, r.id, itemId, other.id);
            if (openMats.delete(key + '|' + itemId)) openMats.add(key + '|' + other.id);
            return res;
          }
          return V.renameItem(store, itemId, v);
        }),
        sname: () => commit(() => V.renameSource(store, vendorId, itemId, v)),
        slink: () => commit(() => V.setOffer(store, vendorId, itemId, { url: v })),
        sprice: () => commit(() => V.setOffer(store, vendorId, itemId, { price: v })),
        sqty: () => commit(() => V.setOffer(store, vendorId, itemId, { qty: v })),
        sunit: () => (v === '__other'
          ? askUnit(t, it?.unit ?? 'each', (u) => commit(() => V.setOffer(store, vendorId, itemId, { unit: u })))
          : commit(() => V.setOffer(store, vendorId, itemId, { unit: v }))),
        wclass: () => work(),
        whours: () => work(),
      };
      const work = () => {
        const i = Number(t.dataset.i);
        commit(() => {
          if (f === 'whours' && !(amount(v) > 0)) throw new Error('type the hours a batch takes; × takes the work off');
          return V.setFormula(store, r.id, { labor: laborList(r).map((l, j) => (j !== i ? l : f === 'wclass' ? { ...l, classId: v } : { ...l, hours: v })) });
        });
      };
      save[f]?.();
    };

    const lineAt = (node) => Number(node.closest('[data-line]')?.dataset.line);
    const inBuy = (node) => !!node.closest('#buy-form');
    el.oninput = (e) => {
      const t = e.target;
      const f = t.dataset?.f;
      if (t.id === 'src-name' || t.id === 'src-url') { linkDraft[t.id === 'src-name' ? 'name' : 'url'] = t.value; return; }
      if (!f) return;
      const row = t.closest('[data-draft]');
      if (row) {
        setDraft(row.dataset.draft, f, t.value);
        // the link names where it is from (amazon.com is Amazon), until a name of its own is typed
        const d = f === 'nslink' ? draftOf(row.dataset.draft) : null;
        const name = row.querySelector('[data-f="nsname"]');
        if (d && name && (!d.vendorName.trim() || d.vendorName === d.autoName)) name.value = d.vendorName = d.autoName = V.siteName(t.value);
        return;
      }
      if (!inBuy(t) || !draft) return;
      const i = lineAt(t);
      if (Number.isInteger(i) && draft.lines[i]) draft.lines[i][f] = t.value;
      else draft[f] = t.value;
    };
    el.onchange = (e) => {
      const t = e.target;
      const f = t.dataset?.f;
      if (t.id === 'src-item') { linkDraft.itemId = t.value; return; }
      if (!f || f === 'packs' || f === 'batches' || f === 'came' || f === 'day') return;
      const row = t.closest('[data-draft]');
      if (row) {
        const which = row.dataset.draft;
        const d = draftOf(which);
        const hit = f === 'nunit' && d ? itemByName(store, d.name) : null;
        // a unit picked for a material on file that its own cannot become re-counts the material
        const pick = (u) => (hit && toItemUnit(hit, 1, u) === null ? recount(t, hit, u, () => { d.unit = u; }) : setDraft(which, f, u));
        if (t.tagName === 'SELECT' && t.value === '__other') { askUnit(t, d?.unit || hit?.unit || 'each', pick); return; }
        pick(t.value);
        // a name already on file brings its own unit and count; a new kind of worker asks its name
        if (f === 'nname') { if (d) d.unit = ''; later(); }
        if (f === 'nwclass') later();
        return;
      }
      if (inBuy(t)) {
        if (!draft) return;
        const i = lineAt(t);
        if (f === 'unit' && t.value === '__other') {
          const line = Number.isInteger(i) ? draft.lines[i] : null;
          if (line) askUnit(t, line.unit || 'each', (u) => { line.unit = u; });
          return;
        }
        if (Number.isInteger(i) && draft.lines[i]) {
          draft.lines[i][f] = t.value;
          if (f === 'itemId') {
            const it = store.resolve('item:' + t.value);
            if (it) draft.lines[i].unit = it.unit;
            desk.rerender();
          }
        }
        return;
      }
      edit(t, f);
    };
    // a row being typed and thrown away, by its × or by Escape
    const dropDraft = (which) => {
      const cut = which.indexOf('|');
      const kind = which.slice(0, cut);
      const key = which.slice(cut + 1);
      if (kind === 'line') newLines.delete(key);
      else if (kind === 'work') newWork.delete(key);
      else if (kind === 'src') { newSrc.delete(key); if (autoSrc.delete(key)) openMats.delete(key); }
      else if (kind === 'product') newProduct = null;
      desk.rerender();
    };
    el.onkeydown = (e) => {
      const row = e.target.closest?.('[data-draft]');
      if (!row || e.target.tagName === 'BUTTON') return;
      if (e.key === 'Escape') { e.preventDefault(); dropDraft(row.dataset.draft); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      saveDraft(row.dataset.draft, true);
    };
    const seeOnHand = (itemId) => (itemId ? { label: 'See it on hand', hash: '#inventory/item:' + itemId } : { label: 'See it on hand', hash: '#inventory' });
    el.onclick = (e) => {
      // a field, a list or a link does its own thing; a tap on a row anywhere else opens and shuts it
      if (e.target.closest('input, select, textarea, a, label')) return;
      const b = e.target.closest('[data-do]');
      if (!b) return;
      // a row being typed is saved by any button pressed outside it, as well as by the cursor leaving
      // it: a re-draw can take the cursor out of a row without its leaving being heard
      for (const row of el.querySelectorAll('[data-draft]')) if (!row.contains(b)) saveDraft(row.dataset.draft, false);
      const doing = b.dataset.do;
      const sec = b.closest('section.doll');
      const key = b.dataset.doll ?? sec?.dataset.doll;
      const r = key ? store.resolve('recipe:' + key) : null;
      const id = b.dataset.item;
      const vid = b.dataset.vendor;
      const field = (scope, f) => scope?.querySelector(`[data-f="${f}"]`)?.value ?? '';
      switch (doing) {
        case 'doll': toggle(openDolls, key); desk.rerender(); return;
        case 'mat': {
          // what was on screen decides: the form that opened by itself can fold as this tap saves it,
          // and a toggle would then open it again
          const k = key + '|' + id;
          if (b.closest('.mp') || b.closest('.mr')?.classList.contains('on')) openMats.delete(k); else openMats.add(k);
          desk.rerender();
          return;
        }
        case 'add-mat':
          if (!newLines.has(key)) newLines.set(key, { name: '', qty: '', unit: '', have: '' });
          desk.rerender();
          focusIn(`[data-draft="line|${key}"] [data-f="nname"]`);
          return;
        case 'drop-new': dropDraft('line|' + key); return;
        case 'add-work':
          if (!newWork.has(key)) newWork.set(key, { classId: classes[0]?.id ?? '__new', name: '', rate: '', hours: '' });
          desk.rerender();
          focusIn(`[data-draft="work|${key}"] [data-f="${classes.length ? 'nwhours' : 'nwname'}"]`);
          return;
        case 'drop-neww': dropDraft('work|' + key); return;
        case 'drop-work': {
          const i = Number(b.dataset.i);
          desk.act(() => V.setFormula(store, key, { labor: laborList(r).filter((_, j) => j !== i) }));
          return;
        }
        case 'add-src':
          // asked for by hand, the form stays open once saved, beside the source it added
          autoSrc.delete(key + '|' + id);
          if (!newSrc.has(key + '|' + id)) newSrc.set(key + '|' + id, { vendorName: '', url: '', price: '', qty: '', unit: '' });
          desk.rerender();
          focusIn(`[data-draft="src|${key}|${id}"] [data-f="nslink"]`);
          return;
        case 'drop-nsrc': dropDraft('src|' + key + '|' + id); return;
        case 'pin': {
          const on = !(store.resolve('vendor:' + vid)?.offers ?? []).find((o) => o.itemId === id)?.last;
          desk.act(() => V.pinOffer(store, vid, id, on), { quiet: true });
          return;
        }
        case 'drop-src': desk.act(() => V.dropOffer(store, vid, id)); return;
        case 'bought': {
          // what one of this source's packs holds, bought this many times, at its price each, here now
          const o = (store.resolve('vendor:' + vid)?.offers ?? []).find((x) => x.itemId === id);
          if (!(Number(o?.price) > 0)) { desk.toast('Type its price first', { error: true }); return; }
          if (!(Number(o?.qty) > 0)) { desk.toast('Type its size first: how much one holds', { error: true }); return; }
          const n = amount(field(b.closest('.src'), 'packs'));
          const packs = n > 0 ? n : 1;
          desk.act(() => V.buy(store, { vendorId: vid, arrived: true,
            lines: [{ itemId: id, qty: Math.round(o.qty * packs * 1e6) / 1e6, unit: o.unit, price: V.round2(o.price * packs), packs }] }));
          return;
        }
        case 'arrived-po': {
          const first = store.resolve('po:' + b.dataset.po)?.lines?.[0]?.itemId;
          desk.act(() => V.receive(store, b.dataset.po), { next: seeOnHand(first) });
          return;
        }
        case 'per': desk.act(() => V.setLinePer(store, key, id, b.dataset.v), { quiet: true }); return;
        case 'drop-mat': {
          const goodsOf = () => store.data.products.products.find((p) => p.itemId === id && (Number(p.units) || 1) === 1)
            ?? store.data.products.products.find((p) => p.itemId === id);
          const res = desk.act(() => {
            if (key === SUPPLIES) return V.removeItem(store, id);
            if (key === GOODS) { const p = goodsOf(); return p ? V.removeProduct(store, { productId: p.id }) : V.removeItem(store, id); }
            return V.dropLine(store, key, id);
          });
          if (res) { openMats.delete(key + '|' + id); newSrc.delete(key + '|' + id); autoSrc.delete(key + '|' + id); desk.rerender(); }
          return;
        }
        case 'lock': desk.act(() => V.lockRecipe(store, key, !r?.locked), { quiet: true }); return;
        case 'make': {
          const y = field(sec, 'came').trim();
          desk.act(() => V.makeBatch(store, key, { batches: field(sec, 'batches'), yieldActual: y === '' ? undefined : y }), { next: { label: 'See the Shelf', hash: '#shelf' } });
          return;
        }
        case 'plan': desk.act(() => V.planBatch(store, key, { date: field(sec, 'day'), batches: field(sec, 'batches') }), { next: { label: 'See the Calendar', hash: '#calendar' } }); return;
        case 'make-planned': {
          const rsv = store.resolve('reservation:' + b.dataset.rsv);
          if (rsv) desk.act(() => V.makeBatch(store, rsv.recipeId, { batches: rsv.batches, reservationId: rsv.id }), { next: { label: 'See the Shelf', hash: '#shelf' } });
          return;
        }
        case 'drop-product': {
          const res = desk.act(() => V.removeProduct(store, { recipeId: key }));
          if (res) { openDolls.delete(key); newLines.delete(key); newWork.delete(key); desk.rerender(); }
          return;
        }
        case 'new-product':
          newProduct ??= { name: '', price: '', kind: 'made' };
          newProduct.auto = false;
          desk.rerender();
          el.querySelector('[data-ref="new"]')?.scrollIntoView({ block: 'center' });
          focusIn('[data-f="npname"]');
          return;
        case 'np-kind': if (newProduct) newProduct.kind = b.dataset.v; desk.rerender(); return;
        case 'drop-np': dropDraft('product|new'); return;
        case 'buy-open':
          draft ??= freshDraft();
          desk.rerender();
          el.querySelector('#buy-form')?.scrollIntoView({ block: 'start' });
          focusIn('#buy-form [data-f="vendor"]');
          return;
        case 'close-buy': draft = null; desk.rerender(); return;
        case 'add-line': draft.lines.push(blankLine()); desk.rerender(); return;
        case 'drop-line': draft.lines.splice(Number(b.dataset.i), 1); desk.rerender(); return;
        case 'arrived': draft.arrived = b.dataset.v === '1'; desk.rerender(); return;
        case 'personal': draft.personal = b.dataset.v === '1'; desk.rerender(); return;
        case 'buy': {
          const d = draft;
          const loose = d.lines.find((l) => l.read && !l.itemId && !String(l.name ?? '').trim());
          if (loose) { desk.toast(`Pick what “${loose.read}” is, or remove that line: its money would land on the other materials`, { error: true }); return; }
          const vendor = store.data.sourcing.vendors.find((v) => v.name.toLowerCase() === d.vendor.trim().toLowerCase());
          const lines = d.lines.filter((l) => l.itemId || l.name).map((l) => (l.itemId === '__new'
            ? { name: l.name, unit: l.unit, qty: l.qty, price: l.price }
            : { itemId: l.itemId, unit: l.unit, qty: l.qty, price: l.price }));
          const res = desk.act(() => V.buy(store, {
            vendorId: vendor?.id, vendorName: d.vendor, url: d.url.trim(), lines,
            paid: d.paid === '' ? undefined : d.paid, personal: d.personal, arrived: d.arrived,
          }, d.date ? { now: d.date + 'T12:00:00' } : {}), { next: (x) => (d.arrived ? seeOnHand(store.resolve('po:' + x.poId)?.lines?.[0]?.itemId) : { label: 'See Books', hash: '#books' }) });
          if (res) { draft = null; desk.rerender(); }
          return;
        }
        case 'add-source': {
          const itemId = el.querySelector('#src-item')?.value;
          if (!itemId) { desk.toast('Pick what it sells', { error: true }); return; }
          const res = desk.act(() => V.addOffer(store, itemId, { vendorName: linkDraft.name, url: linkDraft.url.trim() }));
          if (res) { linkDraft = null; openItem(store, itemId); desk.rerender(); }
          return;
        }
        case 'drop-link': linkDraft = null; desk.rerender(); return;
      }
    };
  },
};
