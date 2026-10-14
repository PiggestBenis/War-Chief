// verbs — every write the desk makes, in one file. Each verb is one all-or-none act through
// store.write(), so a tap either lands everywhere it should or nowhere, and Undo takes the
// whole act back. The stations draw the screens; this file decides what a tap means in the
// books. No DOM in here: scripts/warchief-line.mjs drives these same functions for three very
// different businesses and reads the ledger and the stock back at the far end.
//
// THE LINE, and what each step writes (docs/specs/WAR-CHIEF-TERMINAL.md, the second ruling):
//   Buy        a purchase (po), the money out (stock +P / cash −P), the source's last price,
//              and, when it has arrived, the receive moves that raise the count
//   Receive    the receive moves for a purchase that was still on its way
//   Make       consume moves for every material, a produce move for the finished units, the batch,
//              and the batch's labor booked as owed (labor / labor owed) when the recipe names hours
//   Sell       the order, the money in (cash / sales / tax), the stock out and its cost
//   Ship       the label's cost (postage / cash), the tracking number, the stock out and its cost
//   Books      a typed expense, or a line from a dropped bank, PayPal or OFX file
//   People     hours, and a pay run (labor / cash)
//
// ONE STOCK ACCOUNT. Everything bought to be used or sold sits at cost in Assets:Inventory until
// it sells; a sale moves its cost to Expenses:COGS. Making a batch moves no material money (the
// cost is still on the shelf, now in a different shape): the batch's material cost is computed
// from what it consumed (costing.pourCost), never stored. Its LABOR is the one thing a batch
// books (Matt, 2026-10-04 18:58Z: "anything that costs money like adding stock or labor hours
// gets deducted in ledger"): Expenses:Labor against Liabilities:LaborOwed, read back per batch by
// costing.laborOfBatch, and a pay run on People draws the owed down before it books more labor.
// Older records filed under Assets:Inventory:Materials or :Finished are inside the same prefix
// and add up with it.
//
// THE HONEST-EMPTY LAW (costing.mjs) binds every cost here: a cost that is not fully known is
// never written as a number. A sale whose cost is unknown books the money and says "cost
// unknown"; it never books $0.

import { toItemUnit, crossesDensity, wacOf, pourCost, isUnknownCost, listedFor, laborPerBatch, laborOfBatch } from './costing.mjs';

export const ACCT = {
  cash: 'Assets:Cash',
  stock: 'Assets:Inventory',
  sales: 'Income:Sales',
  tax: 'Liabilities:SalesTaxPayable',
  cogs: 'Expenses:COGS',
  owner: 'Equity:OwnerContributions',
  postage: 'Expenses:Shipping-Postage',
  labor: 'Expenses:Labor',
  // labor counted on a batch (makeBatch) and not yet paid: a pay run on People draws it down first
  laborOwed: 'Liabilities:LaborOwed',
};

// Grok's six "what you paid for" totals, one account each.
export const CATEGORIES = [
  { id: 'materials', label: 'Materials', account: 'Expenses:Materials' },
  { id: 'labor', label: 'Labor', account: 'Expenses:Labor' },
  { id: 'shipping', label: 'Shipping', account: 'Expenses:Shipping-Postage' },
  { id: 'fees', label: 'Fees', account: 'Expenses:Fees' },
  { id: 'tools', label: 'Tools', account: 'Expenses:Tools' },
  { id: 'other', label: 'Other', account: 'Expenses:Operating' },
];
export const categoryById = (id) => CATEGORIES.find((c) => c.id === id) ?? null;

// Which of the six an expense account counts under. Accounts from older books (Packaging, Software,
// Wages…) land on the nearest of the six. What sales cost and stock lost are the shelf's own slices
// of the expenses pie (slicesOf), and stock on the shelf is no expense until it sells, so those
// belong to none: a purchase of stock reads as Stock, never as the Materials expense it is not.
export function categoryOfAccount(account) {
  const a = String(account ?? '');
  if (a.startsWith('Expenses:COGS')) return null;
  if (/^Expenses:(Materials|Packaging)/.test(a)) return 'materials';
  if (/^Expenses:(Labor|Wages|Payroll)/.test(a)) return 'labor';
  if (a.startsWith('Expenses:Shipping')) return 'shipping';
  if (a.startsWith('Expenses:Fees')) return 'fees';
  if (/^Expenses:(Tools|Software|Equipment)/.test(a)) return 'tools';
  if (a.startsWith('Expenses:')) return 'other';
  return null;
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// today as a LOCAL date; toISOString() can already be tomorrow in the evening.
export function dayOf(deps = {}) {
  const now = deps.now ? new Date(deps.now) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
const stampOf = (deps = {}) => (deps.now ? new Date(deps.now) : new Date()).toISOString();
const uid = (prefix) => prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// a readable id from a name, never colliding with one already taken
export function slugFor(store, type, name) {
  const base = String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || type;
  let id = base;
  for (let k = 2; store.resolve(type + ':' + id); k++) id = base + '-' + k;
  return id;
}

const need = (cond, msg) => { if (!cond) throw new Error(msg); };
const num = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, '')));
const itemOf = (store, id) => store.resolve('item:' + id);
const productOf = (store, id) => store.resolve('product:' + id);
const recipeOf = (store, id) => store.resolve('recipe:' + id);

// What a product is: made here (a recipe turns materials into it), bought in and sold as it came,
// or a service (no shelf count; a job may use supplies). Products written before the kind field
// existed are read by what they point at, so nothing has to be re-saved.
export function recipeFor(store, product) {
  if (!product) return null;
  if (product.recipeId) return recipeOf(store, product.recipeId);
  return product.itemId ? store.data.recipes.recipes.find((r) => r.product === product.itemId) ?? null : null;
}
export function kindOf(store, product) {
  if (['made', 'service', 'bought'].includes(product?.kind)) return product.kind;
  if (!product?.itemId) return 'service';
  return recipeFor(store, product) ? 'made' : 'bought';
}

// qty of a recipe or purchase line expressed in the item's own stock unit, or null when the two
// units measure different things (a bag is not a gallon).
export function inItemUnit(store, itemId, qty, unit) {
  const item = itemOf(store, itemId);
  if (!item) return null;
  return toItemUnit(item, num(qty), unit || item.unit);
}

// Why a quantity cannot be counted in an item's unit, in words a person can act on.
export function unitTrouble(item, qty, unit) {
  const u = String(unit || item.unit).toLowerCase();
  if (crossesDensity(u, item.unit)) {
    return `${u} and ${item.unit} measure different things (weight and volume). Count ${item.name} in one of them, or set its weight per millilitre on Inventory`;
  }
  return `${qty} ${u} of ${item.name} cannot be counted in ${item.unit}; use ${item.unit} or a unit that converts to it`;
}

// --- sales tax --------------------------------------------------------------------------
// The price a customer pays is taken to include the tax (the counter way: $100 is $100), so the
// tax is split out of it: $100 at 6% is $94.34 of sale and $5.66 owed to the state. A sale marked
// noTax (shipped out of state, an exempt buyer, a service the state does not tax) splits nothing:
// one rate for every sale would book tax that was never collected, and the Tax owed box is a
// number people pay.
export const UNTAXED = 'sale-untaxed';
export const rateFor = (store, order) => (order?.noTax ? 0 : store.settings.taxRate);
export function splitTax(total, rate) {
  const r = Number(rate) > 0 ? Number(rate) : 0;
  const revenue = round2(num(total) / (1 + r));
  return { total: round2(total), revenue, tax: round2(num(total) - revenue) };
}

// --- orders: where one is, derived from what it wrote ------------------------------------
// An order's name is its number, #1001 and up, the next one after the highest on the books; an
// order from before numbers (or brought in from elsewhere) keeps its id.
export const orderName = (o) => (Number(o?.no) > 0 ? '#' + o.no : String(o?.id ?? '').toUpperCase());
const nextOrderNo = (store) => store.data.orders.orders.reduce((m, o) => Math.max(m, Number(o.no) || 0), 1000) + 1;

export const FLOW = {
  new: ['paid', 'shipped', 'done', 'cancelled'],
  paid: ['shipped', 'done', 'refunded'],
  shipped: ['done', 'refunded'],
  done: ['refunded'],
  cancelled: [],
  refunded: [],
};
const OLD_STATUS = { pending: 'new', processing: 'new', completed: 'done' };
export const statusOf = (order) => OLD_STATUS[order?.status] ?? (FLOW[order?.status] ? order.status : 'new');

export function orderTotal(store, order) {
  // a payment PayPal reported is what the buyer paid, shipping and any tax PayPal added in it
  if (Number(order?.paypal?.gross) > 0) return round2(order.paypal.gross);
  let t = 0;
  for (const ln of order?.lines ?? []) {
    const price = ln.price ?? productOf(store, ln.productId)?.price ?? 0;
    t += num(price) * num(ln.qty);
  }
  return round2(t);
}

// The records an order has already written, read off the ledger and the moves, never off a flag.
export function orderTrail(store, order) {
  const ref = 'order:' + order.id;
  const entries = store.ledgerFor(ref);
  const kind = (e) => e.tags?.source ?? (String(e.desc ?? '').startsWith('Refund') ? 'refund' : 'sale');
  const sale = entries.find((e) => kind(e) === 'sale' && (e.postings ?? []).some((p) => String(p.account).startsWith('Income:'))) ?? null;
  const refund = entries.find((e) => kind(e) === 'refund') ?? null;
  const cost = entries.find((e) => kind(e) === 'cost') ?? (sale && (sale.postings ?? []).some((p) => p.account === ACCT.cogs) ? sale : null);
  const label = entries.filter((e) => kind(e) === 'label');
  const moves = store.data.inventory.moves.filter((m) => (m.refs ?? []).includes(ref));
  const out = moves.some((m) => m.kind === 'sale' || m.kind === 'consume');
  return { sale, refund, cost, label, moves, out };
}

// What one unit of a product costs, or null when it is not fully known. A made thing costs what
// its newest batch with stock left cost to pour; a bought thing its average purchase price.
export function unitCostOfItem(store, itemId) {
  const batches = store.data.inventory.batches
    .filter((b) => b.product === itemId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (batches.length) {
    const left = (code) => store.data.inventory.moves
      .filter((m) => m.itemId === itemId && (m.refs ?? []).includes('batch:' + code))
      .reduce((s, m) => s + (Number(m.qty) || 0), 0);
    const b = batches.find((x) => left(x.code) > 0) ?? batches[0];
    const pc = pourCost(store, b.code);
    // the batch's labor, already booked when it was made, per unit it made: shown with the cost on
    // the Shelf, never moved again at the sale (perUnit alone is what the sale's COGS takes)
    const laborPerUnit = b.yieldActual > 0 ? laborOfBatch(store, b.code) / b.yieldActual : 0;
    return pc ? { perUnit: pc.perUnit, batch: b.code, laborPerUnit } : { perUnit: null, batch: b.code, laborPerUnit };
  }
  const w = wacOf(store, itemId);
  return { perUnit: isUnknownCost(w) || w.partial ? null : w.unitCost, batch: null, laborPerUnit: 0 };
}

// The ops that take an order's goods off the shelf (or a job's materials out of stock), and the
// cost entry when every line's cost is known.
function stockOutOps(store, order, date) {
  const ref = 'order:' + order.id;
  const ops = [];
  const warnings = [];
  let cost = 0;
  let known = true;
  const names = [];
  for (const ln of order.lines ?? []) {
    const product = productOf(store, ln.productId);
    need(product, 'this order names a product that is not on the shelf: ' + ln.productId);
    const qty = num(ln.qty);
    names.push(product.name);
    const recipe = product.recipeId ? recipeOf(store, product.recipeId) : null;
    if (product.kind === 'service' || (!product.itemId && recipe)) {
      for (const m of recipe?.lines ?? []) {
        const q = inItemUnit(store, m.itemId, num(m.qty) * qty, m.unit);
        need(q !== null, `${product.name}: ` + unitTrouble(itemOf(store, m.itemId) ?? { name: m.itemId, unit: '?' }, m.qty, m.unit));
        ops.push({ op: 'add', type: 'move', rec: { id: uid('mv'), date, itemId: m.itemId, qty: -q, kind: 'consume', refs: [ref], note: product.name } });
        const w = wacOf(store, m.itemId);
        if (isUnknownCost(w) || w.partial) known = false; else cost += q * w.unitCost;
        if (store.stockOf(m.itemId) < q) warnings.push(`${itemOf(store, m.itemId)?.name ?? m.itemId} is now below zero`);
      }
      continue;
    }
    if (!product.itemId) continue; // a price with nothing behind it moves no stock
    const units = (num(product.units) || 1) * qty;
    const uc = unitCostOfItem(store, product.itemId);
    ops.push({ op: 'add', type: 'move', rec: {
      id: uid('mv'), date, itemId: product.itemId, qty: -units, kind: 'sale',
      refs: [ref, ...(uc.batch ? ['batch:' + uc.batch] : [])], note: product.name,
    } });
    if (uc.perUnit === null) known = false; else cost += units * uc.perUnit;
    const have = store.stockOf(product.itemId);
    if (have < units) warnings.push(`the shelf showed ${have} ${product.name}, so the count is now below zero`);
  }
  cost = round2(cost);
  if (known && cost > 0) {
    ops.push({ op: 'add', type: 'ledger', rec: {
      id: uid('L'), date, desc: 'Cost of ' + names.join(', '),
      postings: [{ account: ACCT.cogs, amount: cost }, { account: ACCT.stock, amount: -cost }],
      links: [ref], tags: { source: 'cost' },
    } });
  }
  return { ops, cost: known ? cost : null, warnings };
}

function saleEntryOp(store, order, date) {
  const total = orderTotal(store, order);
  if (!(total > 0)) return null;
  const { revenue, tax } = splitTax(total, rateFor(store, order));
  const postings = [{ account: ACCT.cash, amount: total }, { account: ACCT.sales, amount: -revenue }];
  if (tax > 0) postings.push({ account: ACCT.tax, amount: -tax });
  const names = (order.lines ?? []).map((ln) => `${productOf(store, ln.productId)?.name ?? ln.productId} ×${ln.qty}`);
  return { op: 'add', type: 'ledger', rec: {
    id: uid('L'), date, desc: `Sale ${orderName(order)}: ${names.join(', ')}`,
    postings, links: ['order:' + order.id],
    tags: { source: 'sale', ...(order.customer ? { payee: order.customer } : {}) },
  } };
}

// --- SOURCE -------------------------------------------------------------------------------
// have: what is on hand of it already, written as a count in the same act (no purchase behind it)
export function addMaterial(store, { name, unit, alert = 0, kind = 'material', density, have }, deps = {}) {
  need(String(name ?? '').trim(), 'name the material first');
  need(String(unit ?? '').trim(), 'say what it is counted in (each, g, gal…)');
  // one name, one material: a put-away one typed again comes back, with what is on hand of it
  const same = store.data.inventory.items.find((i) => i.name.toLowerCase() === String(name).trim().toLowerCase());
  need(!same || same.retired, `${same?.name} is already on file`);
  if (same) return { act: store.write('brought back ' + same.name, [{ op: 'set', ref: 'item:' + same.id, patch: { retired: false } }, ...openingCount(same.id, have, deps)]), id: same.id };
  const id = slugFor(store, 'item', name);
  const ops = [{ op: 'add', type: 'item', rec: {
    id, name: String(name).trim(), unit: String(unit).trim().toLowerCase(), kind, reorderAt: Math.max(0, num(alert) || 0),
    ...(num(density) > 0 ? { density: num(density) } : {}),
  } }];
  ops.push(...openingCount(id, have, deps));
  return { act: store.write('added ' + String(name).trim(), ops), id };
}
// what is on hand of a material the moment it is added: one counted move, like any count
function openingCount(itemId, have, deps) {
  if (String(have ?? '').trim() === '') return [];
  const n = num(have);
  need(Number.isFinite(n) && n >= 0, 'type what is on hand as a number');
  return n > 0 ? [{ op: 'add', type: 'move', rec: { id: uid('mv'), date: dayOf(deps), itemId, qty: n, kind: 'adjust', refs: [], note: 'counted' } }] : [];
}

// A material's weight per millilitre: what lets it be bought by the pound and used by the cup.
export function setDensity(store, itemId, density) {
  const item = itemOf(store, itemId);
  need(item, 'that material is not on file');
  const d = num(density);
  need(d > 0 && d < 25, 'type its weight per millilitre in grams (water is 1, oils about 0.9)');
  return { act: store.write(`weight per ml for ${item.name}`, [{ op: 'set', ref: 'item:' + itemId, patch: { density: d } }]) };
}

// What a material is counted in, changed (Matt, 2026-10-06 18:55Z: "my organic yarrow, I got locked
// out to each, and I can't change it into grams … I want to not be locked out from the unit
// editing"). Every amount of it stays the same goods, three ways:
//   a unit its old one converts to (g to kg, or g to ml through its own g per ml): converted, no
//     question, because how many of one the other holds is known
//   one it cannot become (each to g), on a material the books never bought, made or sold: every
//     number kept as typed, because then the old unit was only the wrong word
//   one it cannot become, on a material they did: `per`, how many of the new unit one of the old
//     held, and every amount of it is converted by that (counts, purchases, formulas, sources, alert)
// A line, purchase or source already in a unit the new one converts to keeps what was typed. One act.
export function unitBooked(store, itemId) {
  return store.data.inventory.moves.some((m) => m.itemId === itemId && (m.kind !== 'adjust' || (m.refs ?? []).length > 0))
    || store.data.sourcing.pos.some((p) => (p.lines ?? []).some((l) => l.itemId === itemId));
}
// what stands in the way of counting a material in this unit ('' when nothing does), so the desk asks
// how many only when that is the one thing missing
export function recountRefusal(store, item, unit) {
  const u = String(unit ?? '').trim().toLowerCase();
  if (item.kind === 'finished' || item.kind === 'goods' || store.data.products.products.some((p) => p.itemId === item.id)) {
    return `${item.name} is sold off the shelf one at a time, so it stays counted in ${item.unit}`;
  }
  return toItemUnit(item, 1, u) === null && crossesDensity(u, item.unit) ? unitTrouble(item, 1, u) : '';
}
export function setItemUnit(store, itemId, unit, { per } = {}) {
  const item = itemOf(store, itemId);
  need(item, 'that material is not on file');
  const u = String(unit ?? '').trim().toLowerCase();
  need(u, 'say what it is counted in');
  if (u === item.unit) return { act: null };
  const no = recountRefusal(store, item, u);
  need(!no, no);
  const one = toItemUnit(item, 1, u);   // one of the new unit, in the old, when the two convert
  const relabel = one === null && per === undefined;
  need(!relabel || !unitBooked(store, itemId), `${item.name} was bought, made or sold in ${item.unit}: say how many ${u} one ${item.unit} held`);
  const k = one !== null ? 1 / one : relabel ? 1 : num(per);
  need(Number.isFinite(k) && k > 0, `type how many ${u} one ${item.unit} of ${item.name} held`);
  const uses = (r) => [...(r.lines ?? []), ...(r.perUnitPackaging ?? [])].some((l) => l.itemId === itemId);
  // a number relabelled changes what a locked formula uses; a number converted is the same amount
  const locked = relabel ? store.data.recipes.recipes.filter((r) => r.locked && uses(r)) : [];
  need(!locked.length, `${locked.map((r) => r.name).join(' and ')} ${locked.length === 1 ? 'is' : 'are'} locked; unlock ${locked.length === 1 ? 'it' : 'them'} to count ${item.name} in ${u}`);
  const six = (x) => Math.round(x * 1e6) / 1e6;
  const now = { ...item, unit: u };
  const re = (l) => {
    if (l.itemId !== itemId) return l;
    const lu = l.unit || item.unit;
    if (toItemUnit(now, 1, lu) !== null) return l.unit ? l : { ...l, unit: lu };
    if (toItemUnit(item, 1, lu) === null) return l;
    return { ...l, ...(Number(l.qty) > 0 ? { qty: six(toItemUnit(item, Number(l.qty), lu) * k) } : {}), unit: u };
  };
  const ops = [{ op: 'set', ref: 'item:' + itemId, patch: { unit: u, ...(k !== 1 && num(item.reorderAt) > 0 ? { reorderAt: six(num(item.reorderAt) * k) } : {}) } }];
  for (const r of store.data.recipes.recipes) {
    if (uses(r)) ops.push({ op: 'set', ref: 'recipe:' + r.id, patch: { lines: (r.lines ?? []).map(re), ...(r.perUnitPackaging ? { perUnitPackaging: r.perUnitPackaging.map(re) } : {}) } });
  }
  if (k !== 1) for (const m of store.data.inventory.moves) if (m.itemId === itemId) ops.push({ op: 'set', ref: 'move:' + m.id, patch: { qty: six(m.qty * k) } });
  for (const p of store.data.sourcing.pos) if ((p.lines ?? []).some((l) => l.itemId === itemId)) ops.push({ op: 'set', ref: 'po:' + p.id, patch: { lines: p.lines.map(re) } });
  // relabelled, a source's size stays in the unit it was typed in: "1 each" then reads as not
  // comparable until its unit is picked, never as a price made up from the wrong word
  if (!relabel) for (const v of store.data.sourcing.vendors) if (offerOf(v, itemId)) ops.push({ op: 'set', ref: 'vendor:' + v.id, patch: { offers: v.offers.map(re) } });
  const said = relabel ? 'amounts kept as typed' : one !== null ? 'the same amounts' : `${six(k)} ${u} to one ${item.unit}`;
  return { act: store.write(`${item.name} counted in ${u} now, ${said}`, ops) };
}

export function addSource(store, { name, url = '' }) {
  need(String(name ?? '').trim(), 'name the source first');
  const id = slugFor(store, 'vendor', name);
  const act = store.write('added ' + name, [{ op: 'add', type: 'vendor', rec: { id, name: String(name).trim(), url: String(url).trim(), offers: [] } }]);
  return { act, id };
}

// A price noted without buying: the source's quote for this material, shown on Source.
export function noteOffer(store, vendorId, { itemId, price, qty, unit, url = '' }) {
  const v = store.resolve('vendor:' + vendorId);
  need(v, 'that source is not on file');
  need(itemOf(store, itemId), 'that material is not on file');
  need(num(price) > 0 && num(qty) > 0, 'a price needs dollars and an amount');
  const offers = (v.offers ?? []).filter((o) => o.itemId !== itemId);
  const old = (v.offers ?? []).find((o) => o.itemId === itemId) ?? {};
  offers.push({ ...old, itemId, price: round2(price), qty: num(qty), unit: String(unit || itemOf(store, itemId).unit), ...(url ? { url } : {}) });
  return { act: store.write('price noted at ' + v.name, [{ op: 'set', ref: 'vendor:' + vendorId, patch: { offers } }]) };
}

// Buy: lines [{ itemId, qty, unit, price? }] and what the whole purchase cost. One act writes the
// purchase, the money out, the source's last price and, when it has arrived, the stock.
//
// Each line's share of the money is settled here and written on the purchase (line.cost), so the
// stock's average cost never shifts later when a quote changes:
//   every line priced   each line's price, with whatever else was paid (shipping, tax) spread
//                       over the lines in proportion to their prices
//   one line            all of it
//   otherwise           spread by the source's quotes when every line has one; refused if not,
//                       because a split by quantity across gallons and spools is a made-up number
export function buy(store, { vendorId, vendorName, url = '', lines, paid, personal = false, arrived = true }, deps = {}) {
  const date = dayOf(deps);
  need(Array.isArray(lines) && lines.length, 'say what you bought');
  const ops = [];
  let vendor = vendorId ? store.resolve('vendor:' + vendorId) : null;
  if (!vendor) {
    need(String(vendorName ?? '').trim(), 'say where you bought it');
    const id = slugFor(store, 'vendor', vendorName);
    vendor = { id, name: String(vendorName).trim(), url: String(url).trim(), offers: [] };
    ops.push({ op: 'add', type: 'vendor', rec: vendor });
  }
  // one line per material: two lines of the same thing are added together in its stock unit.
  // A line may name a material not on file yet ({ name, unit }); it is added in the same act.
  const merged = new Map();
  const fresh = new Map();
  for (const ln of lines) {
    let item = ln.itemId ? itemOf(store, ln.itemId) : null;
    if (!item && !ln.itemId && String(ln.name ?? '').trim()) {
      const name = String(ln.name).trim();
      item = [...fresh.values()].find((x) => x.name.toLowerCase() === name.toLowerCase())
        ?? store.data.inventory.items.find((x) => String(x.name).toLowerCase() === name.toLowerCase()) ?? null;
      if (!item) {
        need(String(ln.unit ?? '').trim(), 'say what ' + name + ' is counted in');
        let id = slugFor(store, 'item', name);
        for (let k = 2; [...fresh.values()].some((x) => x.id === id); k++) id = slugFor(store, 'item', name) + '-' + k;
        item = { id, name, unit: String(ln.unit).trim().toLowerCase(), kind: 'material', reorderAt: 0 };
        fresh.set(id, item);
        ops.push({ op: 'add', type: 'item', rec: item });
      }
    }
    need(item, 'that material is not on file: ' + (ln.itemId ?? ln.name ?? '?'));
    const qty = num(ln.qty);
    need(qty > 0, 'say how much of ' + item.name);
    let unit = String(ln.unit || item.unit).trim().toLowerCase();
    const inStock = toItemUnit(item, qty, unit);
    need(inStock !== null, unitTrouble(item, qty, unit));
    // a weight-to-volume buy is written in the item's own unit, so the cost behind it is read
    // back through the same density that counted it
    const crossed = crossesDensity(unit, item.unit);
    const price = ln.price === undefined || ln.price === null || ln.price === '' ? null : round2(ln.price);
    need(price === null || price >= 0, 'a price cannot be negative');
    // packs: how many of the source's packs this line is (2 × a 1 lb bag), so the price it leaves on
    // the source is still for one pack
    const packs = num(ln.packs) > 1 ? num(ln.packs) : 1;
    const had = merged.get(item.id);
    if (had) {
      had.inStock += inStock;
      had.qty = had.inStock;
      had.unit = item.unit;
      had.price = had.price === null || price === null ? null : round2(had.price + price);
      had.packs = 1;
    } else {
      merged.set(item.id, crossed
        ? { itemId: item.id, qty: inStock, unit: item.unit, inStock, price, name: item.name, asBought: `${qty} ${unit}`, packs }
        : { itemId: item.id, qty, unit, inStock, price, name: item.name, packs });
    }
  }
  const clean = [...merged.values()];
  const priced = clean.every((l) => l.price !== null);
  const sumPrices = priced ? round2(clean.reduce((s, l) => s + l.price, 0)) : 0;
  const money = round2(paid === undefined || paid === null || paid === '' ? sumPrices : paid);
  need(Number.isFinite(money) && money >= 0, 'type what you paid');
  // each line's share of the money
  let shares;
  if (money === 0) shares = clean.map(() => 0);
  else if (priced && sumPrices > 0) shares = clean.map((l) => (money * l.price) / sumPrices);
  else if (clean.length === 1) shares = [money];
  else {
    const quotes = clean.map((l) => listedFor((vendor.offers ?? []).find((o) => o.itemId === l.itemId), l.qty, l.unit));
    need(quotes.every((q) => q > 0), 'type the price of each line, so the money lands on the right material');
    const qsum = quotes.reduce((a, b) => a + b, 0);
    shares = quotes.map((q) => (money * q) / qsum);
  }
  // pennies: the shares are rounded and the last one takes the remainder, so they add up exactly
  shares = shares.map(round2);
  const drift = round2(money - shares.reduce((a, b) => a + b, 0));
  if (drift && shares.length) shares[shares.length - 1] = round2(shares[shares.length - 1] + drift);
  need(shares.every((x) => x >= 0), 'the prices add up to more than what was paid');
  const poId = uid('po');
  ops.push({ op: 'add', type: 'po', rec: {
    id: poId, vendorId: vendor.id, date, status: arrived ? 'received' : 'placed',
    lines: clean.map((l, i) => ({ itemId: l.itemId, qty: l.qty, unit: l.unit, cost: shares[i], ...(l.asBought ? { asBought: l.asBought } : {}) })),
    ...(arrived ? { receivedDate: date } : {}), ...(url ? { url } : {}),
  } });
  if (money > 0) {
    ops.push({ op: 'add', type: 'ledger', rec: {
      id: uid('L'), date, desc: `Bought ${clean.map((l) => l.name).join(', ')} from ${vendor.name}`,
      postings: [{ account: ACCT.stock, amount: money }, { account: personal ? ACCT.owner : ACCT.cash, amount: -money }],
      links: ['po:' + poId], tags: { payee: vendor.name, source: 'buy' },
    } });
  }
  if (arrived) {
    for (const l of clean) {
      ops.push({ op: 'add', type: 'move', rec: { id: uid('mv'), date, itemId: l.itemId, qty: l.inStock, kind: 'receive', refs: ['po:' + poId] } });
    }
  }
  // the price just paid becomes this source's quote for each material. The pin stays where it is:
  // a buy pins its source only when no source sold the material before, as adding one does (Matt,
  // 2026-10-06 18:55Z: "every sequential source that you add to be automatically unpinned unless
  // you pin one of the other ones")
  const offers = (vendor.offers ?? []).filter((o) => !clean.some((l) => l.itemId === o.itemId));
  clean.forEach((l, i) => {
    const old = (vendor.offers ?? []).find((o) => o.itemId === l.itemId) ?? {};
    const first = !store.data.sourcing.vendors.some((x) => offerOf(x, l.itemId));
    const one = (x, round) => (l.packs > 1 ? round(x / l.packs) : x);
    offers.push({ ...old, itemId: l.itemId, qty: one(l.qty, (x) => Math.round(x * 1e6) / 1e6), unit: l.unit, ...(first ? { last: true } : {}), lastDate: date,
      ...(shares[i] > 0 ? { price: one(shares[i], round2) } : {}), ...(url ? { url } : {}) });
  });
  if (ops[0]?.type === 'vendor' && ops[0].rec === vendor) vendor.offers = offers;
  else ops.push({ op: 'set', ref: 'vendor:' + vendor.id, patch: { offers } });
  const act = store.write(`bought ${clean.map((l) => l.name).join(', ')}`, ops);
  return { act, poId, paid: money };
}

// Receive: a purchase still on its way arrives.
export function receive(store, poId, deps = {}) {
  const po = store.resolve('po:' + poId);
  need(po, 'that purchase is not on file');
  need(po.status !== 'received', 'that purchase is already in stock');
  const date = dayOf(deps);
  const ops = [];
  for (const ln of po.lines ?? []) {
    const q = inItemUnit(store, ln.itemId, ln.qty, ln.unit);
    need(q !== null, unitTrouble(itemOf(store, ln.itemId) ?? { name: ln.itemId, unit: '?' }, ln.qty, ln.unit));
    ops.push({ op: 'add', type: 'move', rec: { id: uid('mv'), date, itemId: ln.itemId, qty: q, kind: 'receive', refs: ['po:' + poId] } });
  }
  ops.push({ op: 'set', ref: 'po:' + poId, patch: { status: 'received', receivedDate: date } });
  const names = (po.lines ?? []).map((ln) => itemOf(store, ln.itemId)?.name ?? ln.itemId);
  return { act: store.write('received ' + names.join(', '), ops) };
}

// --- STOCK --------------------------------------------------------------------------------
// Count: what is really there. The difference becomes one adjust move, so the count is still the
// sum of its moves. Stock that went missing (spilled, broken, spoiled) was money in the books'
// stock account, so its cost leaves stock for Expenses:COGS:Shrinkage in the same act (Matt,
// 2026-10-04 01:57Z: "anything that effects expenses should update ledger accordingly"). It is
// costed the way every removal is: a made thing at its batch's cost per unit; a bought thing from
// the grams with no purchase behind them first (they carry no money in the books), then at the
// average. Stock found beyond the books has no purchase behind it, so it carries no money in, and
// a cost that is not known is never written as a number: the act says so instead.
export const SHRINKAGE = 'Expenses:COGS:Shrinkage';
export function count(store, itemId, counted, deps = {}) {
  const item = itemOf(store, itemId);
  need(item, 'that material is not on file');
  const real = num(counted);
  need(Number.isFinite(real) && real >= 0, 'type the count you see');
  const diff = Math.round((real - store.stockOf(itemId)) * 1e6) / 1e6;
  if (diff === 0) return { act: null, diff: 0 };
  const date = dayOf(deps);
  const moveId = uid('mv');
  const ops = [{ op: 'add', type: 'move', rec: { id: moveId, date, itemId, qty: diff, kind: 'adjust', refs: [], note: 'counted' } }];
  let lost = null;
  let warning = null;
  if (diff > 0) warning = 'The extra has no purchase behind it, so it adds nothing to the money in stock';
  else {
    const gone = -diff;
    const made = store.data.inventory.batches.some((b) => b.product === itemId);
    if (made) {
      const uc = unitCostOfItem(store, itemId);
      lost = uc.perUnit === null ? null : round2(gone * uc.perUnit);
    } else {
      const w = wacOf(store, itemId);
      const fromCosted = Math.min(Math.max(0, gone - (w.unpricedOnHand ?? 0)), Math.max(0, w.costedOnHand ?? 0));
      lost = fromCosted === 0 ? 0 : isUnknownCost(w) ? null : round2(fromCosted * w.unitCost);
    }
    if (lost === null) warning = 'Its cost is not known, so the money in stock was left as it was';
    else if (lost > 0) {
      ops.push({ op: 'add', type: 'ledger', rec: {
        id: uid('L'), date, desc: `${item.name} missing at the count`,
        postings: [{ account: SHRINKAGE, amount: lost }, { account: ACCT.stock, amount: -lost }],
        links: ['move:' + moveId], tags: { source: 'count' },
      } });
      warning = `${Math.round(gone * 1000) / 1000} ${item.unit} short: ${store.usd(lost)} of stock written off`;
    }
  }
  return { diff, lost, warning, act: store.write(`counted ${item.name}`, ops) };
}

export function setAlert(store, itemId, alert) {
  const item = itemOf(store, itemId);
  need(item, 'that material is not on file');
  return { act: store.write(`alert for ${item.name}`, [{ op: 'set', ref: 'item:' + itemId, patch: { reorderAt: Math.max(0, num(alert) || 0) } }]) };
}

// --- MAKE ---------------------------------------------------------------------------------
// One act creates or updates what a product is: a made thing (its stock count, its materials per
// batch, its yield, the work it takes), a service (the materials one job uses, no shelf count), or
// a bought thing sold as it came (no recipe). spec: { productId?, name, kind, price, alert, yield,
// lines, packaging, labor, hours, itemId }. lines are what one batch uses; packaging (made things
// only) is what each one made uses, a tin or a label, so it scales with what actually came out;
// labor (made things only) is [{ classId, hours }] per batch, or { name, rate, hours } to name a
// kind of worker for the first time. Left out, the packaging and labor already on the recipe are
// kept as they are.
// the materials a formula names, checked: each on file, each in a unit it converts from
function formulaLines(store, list) {
  return (list ?? []).filter((l) => l && l.itemId && num(l.qty) > 0).map((l) => {
    const item = itemOf(store, l.itemId);
    need(item, 'that material is not on file: ' + l.itemId);
    const unit = String(l.unit || item.unit).trim().toLowerCase();
    need(toItemUnit(item, num(l.qty), unit) !== null, unitTrouble(item, l.qty, unit));
    return { itemId: item.id, qty: num(l.qty), unit };
  });
}
// the work a batch takes, by kind of worker: [{ classId, hours }], or { name, rate, hours } to name a
// kind for the first time, which joins the company's kinds in the same act (ops)
function formulaLabor(store, list) {
  let classes = laborClassesOf(store);
  const labor = [];
  for (const l of list ?? []) {
    if (!l || String(l.hours ?? '').trim() === '') continue;
    const hours = num(l.hours);
    need(hours > 0 && hours <= 10000, 'hours a batch must be a number above zero');
    let id = l.classId;
    if (!id || id === '__new') {
      const nm = String(l.name ?? '').trim();
      need(nm, 'name the kind of worker (helper, skilled, me)');
      const have = classes.find((c) => String(c.name).toLowerCase() === nm.toLowerCase());
      if (have) id = have.id;
      else {
        const rate = round2(l.rate);
        need(String(l.rate ?? '').trim() !== '' && Number.isFinite(rate) && rate >= 0, `type what an hour of ${nm} costs`);
        id = laborId(nm, classes);
        classes = [...classes, { id, name: nm, rate }];
      }
    }
    need(classes.some((c) => c.id === id), 'that kind of worker is not on file: ' + id);
    const same = labor.find((x) => x.classId === id);
    if (same) same.hours = round2(same.hours + hours); else labor.push({ classId: id, hours });
  }
  return { labor, ops: classes !== laborClassesOf(store) ? [{ op: 'conf', patch: { laborClasses: classes } }] : [] };
}
// materials and work compared by what they mean, not how they were written (a line brought in from
// a file may carry no unit, or other fields), so a locked formula still takes a new name or price
const meaningOf = (store, list) => JSON.stringify((list ?? []).map((l) => [l.itemId, num(l.qty), String(l.unit || itemOf(store, l.itemId)?.unit || '').trim().toLowerCase()]));
const laborMeaning = (list) => JSON.stringify((list ?? []).map((l) => [l.classId, num(l.hours)]));
const LOCKED = 'the formula is locked; unlock it to change it';

export function saveProduct(store, spec) {
  const name = String(spec.name ?? '').trim();
  need(name, 'name the product first');
  const kind = ['made', 'service', 'bought'].includes(spec.kind) ? spec.kind : 'made';
  const price = round2(spec.price);
  need(price >= 0, 'the price cannot be negative');
  const clean = (list) => formulaLines(store, list);
  const lines = clean(spec.lines);
  const meaning = (list) => meaningOf(store, list);
  const ops = [];
  let labor;
  if (spec.labor !== undefined && kind === 'made') {
    const w = formulaLabor(store, spec.labor);
    labor = w.labor;
    ops.push(...w.ops);
  }
  const existing = spec.productId ? productOf(store, spec.productId) : null;
  const productId = existing?.id ?? slugFor(store, 'product', name);
  let itemId = existing?.itemId ?? spec.itemId ?? null;
  let recipeId = existing?.recipeId ?? null;
  if (!recipeId && kind === 'made' && itemId) {
    recipeId = store.data.recipes.recipes.find((r) => r.product === itemId)?.id ?? null;
  }
  if (kind !== 'service' && !itemId) {
    itemId = slugFor(store, 'item', name);
    ops.push({ op: 'add', type: 'item', rec: { id: itemId, name, unit: 'each', kind: kind === 'made' ? 'finished' : 'goods', reorderAt: Math.max(0, num(spec.alert) || 0) } });
  } else if (kind !== 'service' && itemId && spec.alert !== undefined) {
    ops.push({ op: 'set', ref: 'item:' + itemId, patch: { reorderAt: Math.max(0, num(spec.alert) || 0) } });
  }
  // a made thing renamed is renamed on Stock too: its count there is the same goods
  if (existing && kind === 'made' && itemId && itemOf(store, itemId) && itemOf(store, itemId).name !== name && (num(existing.units) || 1) === 1) {
    ops.push({ op: 'set', ref: 'item:' + itemId, patch: { name } });
  }
  if (kind !== 'bought') {
    // how many one batch makes may wait (a formula is often written before the first batch, and
    // Make asks for it); left out on a change, the recipe keeps what it had
    const said = spec.yield === undefined && recipeId ? recipeOf(store, recipeId)?.yieldPlanned ?? 0 : spec.yield;
    const yieldPlanned = kind === 'service' ? 1 : String(said ?? '').trim() === '' ? 0 : num(said);
    need(Number.isFinite(yieldPlanned) && yieldPlanned >= 0, 'how many one batch makes must be a number');
    if (recipeId) {
      const r = recipeOf(store, recipeId);
      const packaging = kind !== 'made' ? [] : spec.packaging === undefined ? (r.perUnitPackaging ?? []) : clean(spec.packaging);
      const work = kind !== 'made' ? [] : labor === undefined ? (r.labor ?? []) : labor;
      const changed = meaning(r.lines) !== meaning(lines) || meaning(r.perUnitPackaging) !== meaning(packaging)
        || num(r.yieldPlanned) !== yieldPlanned || laborMeaning(r.labor) !== laborMeaning(work);
      need(!(r.locked && changed), LOCKED);
      const patch = changed ? { lines, perUnitPackaging: packaging, labor: work, yieldPlanned } : {};
      if (r.name !== name) patch.name = name;
      if (Object.keys(patch).length) ops.push({ op: 'set', ref: 'recipe:' + recipeId, patch });
    } else {
      recipeId = slugFor(store, 'recipe', name);
      ops.push({ op: 'add', type: 'recipe', rec: {
        id: recipeId, name, lines, perUnitPackaging: kind === 'made' ? clean(spec.packaging) : [], labor: kind === 'made' ? (labor ?? []) : [], yieldPlanned,
        ...(kind === 'made' ? { product: itemId } : { perJob: true }), locked: false,
        ...(num(spec.alertBatches) > 0 ? { alertBatches: num(spec.alertBatches) } : {}),
      } });
    }
  }
  const rec = { name, price, kind, units: existing?.units ?? 1,
    ...(itemId && kind !== 'service' ? { itemId } : {}), ...(recipeId && kind !== 'bought' ? { recipeId } : {}),
    ...(kind === 'service' && num(spec.hours) > 0 ? { hours: num(spec.hours) } : {}) };
  if (existing) ops.push({ op: 'set', ref: 'product:' + productId, patch: rec });
  else ops.push({ op: 'add', type: 'product', rec: { id: productId, ...rec } });
  return { act: store.write((existing ? 'changed ' : 'added ') + name, ops), productId, itemId, recipeId };
}

// A new price, and nothing else about the product changes.
export function setPrice(store, productId, price) {
  const p = productOf(store, productId);
  need(p, 'that product is not on the shelf');
  const v = round2(price);
  need(String(price ?? '').trim() !== '' && Number.isFinite(v) && v >= 0, 'type the new price');
  return { act: store.write(`${p.name} at ${store.usd(v)}`, [{ op: 'set', ref: 'product:' + productId, patch: { price: v } }]) };
}

// A pack: the same goods sold several at a time at their own price (3 for $25). It shares the
// shelf count with the single, so selling one pack of 3 takes 3 off the shelf.
export function addPack(store, productId, { name, units, price }) {
  const p = productOf(store, productId);
  need(p && p.itemId, 'a pack needs goods on the shelf to pack');
  // a pack of a pack would be named "×2 ×2" and still hold 2 (Fable's pass of 0.4.0): packs are made
  // from the single one, where the count is what it says
  need(!(Number(p.units) > 1), `${p.name} is already a pack of ${Number(p.units)}; add a bigger pack from the single one`);
  const n = num(units);
  need(Number.isInteger(n) && n >= 2, 'a pack holds 2 or more');
  const v = round2(price);
  need(v > 0, 'type the price of the pack');
  const nm = String(name ?? '').trim() || `${p.name} ×${n}`;
  const id = slugFor(store, 'product', nm);
  const rec = { id, name: nm, price: v, kind: kindOf(store, p), units: n, itemId: p.itemId, ...(p.recipeId ? { recipeId: p.recipeId } : {}) };
  return { act: store.write('added ' + nm, [{ op: 'add', type: 'product', rec }]), id };
}

export function lockRecipe(store, recipeId, locked) {
  const r = recipeOf(store, recipeId);
  need(r, 'that recipe is not on file');
  return { act: store.write((locked ? 'locked ' : 'unlocked ') + r.name, [{ op: 'set', ref: 'recipe:' + recipeId, patch: { locked: !!locked } }]) };
}

// The yellow warning on a product: when what is on hand covers fewer than this many batches
// (Matt, 2026-10-04 18:58Z: "a yellow warning below 3 batch amounts … 2,5,10 etc"). Under one
// batch is red whatever this says. 0 or blank turns the yellow off.
export function setBatchAlert(store, recipeId, batches) {
  const r = recipeOf(store, recipeId);
  need(r, 'that recipe is not on file');
  const n = String(batches ?? '').trim() === '' ? 0 : num(batches);
  need(Number.isFinite(n) && n >= 0, 'type a number of batches');
  return { act: store.write(`${r.name} warns under ${n} batch${n === 1 ? '' : 'es'}`, [{ op: 'set', ref: 'recipe:' + recipeId, patch: { alertBatches: n } }]) };
}

// Make a batch: materials out, finished units in, the batch on record, and the batch's labor
// booked as owed. Never refused for a short count (the count may simply be stale); it says so
// instead.
export function makeBatch(store, recipeId, { batches = 1, yieldActual, reservationId } = {}, deps = {}) {
  const r = recipeOf(store, recipeId);
  need(r, 'that recipe is not on file');
  need(r.product && itemOf(store, r.product), 'this recipe has nothing on the shelf to make');
  need(num(r.yieldPlanned) > 0 || String(yieldActual ?? '').trim() !== '', `say how many one batch of ${r.name} makes first`);
  const n = num(batches) > 0 ? num(batches) : 1;
  const planned = round2(num(r.yieldPlanned) * n);
  const made = yieldActual === undefined || yieldActual === '' ? planned : num(yieldActual);
  need(made >= 0, 'the yield cannot be negative');
  // the work, at each kind of worker's rate as it stands today, frozen on the batch
  const labor = laborPerBatch(store, r).map((l) => ({ ...l, hours: round2(l.hours * n), cost: l.cost === null ? null : round2(l.cost * n) }));
  const gone = labor.find((l) => l.cost === null);
  need(!gone, `the kind of worker "${gone?.name}" on this recipe is no longer on file; change the recipe first`);
  const laborCost = round2(labor.reduce((s, l) => s + l.cost, 0));
  const date = dayOf(deps);
  const sameDay = store.data.inventory.batches.filter((b) => String(b.code).startsWith(date)).length;
  let code = `${date}-${sameDay + 1}`;
  for (let k = sameDay + 2; store.resolve('batch:' + code); k++) code = `${date}-${k}`;
  const ref = 'batch:' + code;
  const ops = [{ op: 'add', type: 'batch', rec: {
    code, product: r.product, recipeId, date, batches: n, yieldPlanned: planned, yieldActual: made,
    ...(labor.length ? { labor: labor.map(({ classId, name, rate, hours, cost }) => ({ classId, name, rate, hours, cost })), laborCost } : {}),
  } }];
  if (laborCost > 0) {
    ops.push({ op: 'add', type: 'ledger', rec: {
      id: uid('L'), date, desc: `Labor on ${r.name} ${code}`,
      postings: [{ account: ACCT.labor, amount: laborCost }, { account: ACCT.laborOwed, amount: -laborCost }],
      links: [ref], tags: { source: 'labor' },
    } });
  }
  const short = [];
  const take = (itemId, q) => {
    if (!(q > 0)) return;
    ops.push({ op: 'add', type: 'move', rec: { id: uid('mv'), date, itemId, qty: -q, kind: 'consume', refs: [ref] } });
    if (store.stockOf(itemId) < q) short.push(itemOf(store, itemId)?.name ?? itemId);
  };
  for (const ln of r.lines ?? []) {
    const q = inItemUnit(store, ln.itemId, num(ln.qty) * n, ln.unit);
    need(q !== null, unitTrouble(itemOf(store, ln.itemId) ?? { name: ln.itemId, unit: '?' }, ln.qty, ln.unit));
    take(ln.itemId, q);
  }
  for (const p of r.perUnitPackaging ?? []) take(p.itemId, inItemUnit(store, p.itemId, num(p.qty) * made, p.unit));
  if (made > 0) ops.push({ op: 'add', type: 'move', rec: { id: uid('mv'), date, itemId: r.product, qty: made, kind: 'produce', refs: [ref] } });
  const rsv = reservationId ? store.resolve('reservation:' + reservationId) : null;
  if (rsv) ops.push({ op: 'set', ref: 'reservation:' + rsv.id, patch: { status: 'done', batchCode: code } });
  const act = store.write(`made ${made} ${r.name}`, ops);
  return { act, code, laborCost, warning: short.length ? `${short.join(', ')} went below zero; count ${short.length === 1 ? 'it' : 'them'} on Inventory` : null };
}

export function planBatch(store, recipeId, { date, batches = 1 }) {
  const r = recipeOf(store, recipeId);
  need(r, 'that recipe is not on file');
  need(/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')), 'pick a day');
  return { act: store.write(`planned ${r.name}`, [{ op: 'add', type: 'reservation', rec: { id: uid('rsv'), date, recipeId, batches: num(batches) > 0 ? num(batches) : 1, status: 'planned' } }]) };
}

// --- THE FORMULA AND ITS SOURCES, CHANGED WHERE THEY SIT ------------------------------------------
// Matt, 2026-10-05 20:46Z: "under product had all materials, under materials we had all sourcing …
// open product all materials expand, open a material and all sourcing expands". Inventory nests
// them that way and every field on those rows is its own act, so one Undo takes back one change.
// A locked formula refuses any change to what a batch uses; its name, price and alert still change.

// A material that was only ever a line of this formula (no stock moved, no purchase, no source, no
// other formula or product points at it) goes with the line in the same act, so a row added by
// mistake and taken out leaves nothing behind. Anything the books point at stays.
function leftoverItems(store, recipeId, keep) {
  const r = recipeOf(store, recipeId);
  const kept = new Set(keep);
  const ops = [];
  for (const id of new Set([...(r?.lines ?? []), ...(r?.perUnitPackaging ?? [])].map((l) => l.itemId))) {
    if (kept.has(id) || !itemOf(store, id)) continue;
    if (!store.refsTo('item:' + id).some((x) => x.ref !== 'recipe:' + recipeId)) ops.push({ op: 'del', ref: 'item:' + id });
  }
  return ops;
}

// What a batch (or a job) uses, the work it takes, how many a batch makes: any of them, the rest as
// they are. Nothing changed writes nothing.
export function setFormula(store, recipeId, { lines, packaging, labor, yieldPlanned } = {}) {
  const r = recipeOf(store, recipeId);
  need(r, 'that product is not on file');
  const made = !!r.product;
  const patch = {};
  const ops = [];
  if (lines !== undefined) patch.lines = formulaLines(store, lines);
  if (packaging !== undefined && made) patch.perUnitPackaging = formulaLines(store, packaging);
  if (labor !== undefined && made) {
    const w = formulaLabor(store, labor);
    patch.labor = w.labor;
    ops.push(...w.ops);
  }
  if (yieldPlanned !== undefined && made) {
    const y = String(yieldPlanned).trim() === '' ? 0 : num(yieldPlanned);
    need(Number.isFinite(y) && y >= 0, 'how many one batch makes must be a number');
    patch.yieldPlanned = y;
  }
  const changed = (patch.lines && meaningOf(store, patch.lines) !== meaningOf(store, r.lines))
    || (patch.perUnitPackaging && meaningOf(store, patch.perUnitPackaging) !== meaningOf(store, r.perUnitPackaging))
    || (patch.labor && laborMeaning(patch.labor) !== laborMeaning(r.labor))
    || (patch.yieldPlanned !== undefined && patch.yieldPlanned !== num(r.yieldPlanned || 0));
  if (!changed) return { act: null };
  need(!r.locked, LOCKED);
  const keep = [...(patch.lines ?? r.lines ?? []), ...(patch.perUnitPackaging ?? r.perUnitPackaging ?? [])].map((l) => l.itemId);
  ops.push({ op: 'set', ref: 'recipe:' + recipeId, patch }, ...leftoverItems(store, recipeId, keep));
  return { act: store.write('changed ' + r.name, ops) };
}

// One material into a formula: one on file (by id, or by its name in any case), or a new one with
// what it is counted in and what is on hand of it. per 'each' puts it on each one made (a tin, a
// label) instead of on the batch.
export function addLine(store, recipeId, { itemId, name, unit, qty, per = 'batch', have }, deps = {}) {
  const r = recipeOf(store, recipeId);
  need(r, 'that product is not on file');
  need(!r.locked, LOCKED);
  const ops = [];
  const nm = String(name ?? '').trim();
  let item = itemId ? itemOf(store, itemId) : null;
  if (!item) {
    need(nm, 'name the material first');
    item = store.data.inventory.items.find((x) => String(x.name).toLowerCase() === nm.toLowerCase()) ?? null;
  }
  if (!item) {
    const u = String(unit ?? '').trim().toLowerCase();
    need(u, 'say what ' + nm + ' is counted in');
    item = { id: slugFor(store, 'item', nm), name: nm, unit: u, kind: 'material', reorderAt: 0 };
    ops.push({ op: 'add', type: 'item', rec: item }, ...openingCount(item.id, have, deps));
  }
  need(item.id !== r.product, 'a product cannot be made of itself');
  need(![...(r.lines ?? []), ...(r.perUnitPackaging ?? [])].some((l) => l.itemId === item.id), `${item.name} is already in ${r.name}`);
  const q = num(qty);
  need(Number.isFinite(q) && q > 0, `type how much ${item.name} one ${r.product ? 'batch' : 'job'} uses`);
  const u = String(unit || item.unit).trim().toLowerCase();
  need(toItemUnit(item, q, u) !== null, unitTrouble(item, q, u));
  const list = per === 'each' && r.product ? 'perUnitPackaging' : 'lines';
  ops.push({ op: 'set', ref: 'recipe:' + recipeId, patch: { [list]: [...(r[list] ?? []), { itemId: item.id, qty: q, unit: u }] } });
  return { act: store.write(`added ${item.name} to ${r.name}`, ops), itemId: item.id };
}

// A line of the formula switched to another material on file (its name typed over the old one).
// The amount stays; so does its unit when the new material can be counted in it.
export function swapLine(store, recipeId, fromId, toId) {
  const r = recipeOf(store, recipeId);
  need(r, 'that product is not on file');
  need(!r.locked, LOCKED);
  const to = itemOf(store, toId);
  need(to, 'that material is not on file');
  need(toId !== r.product, 'a product cannot be made of itself');
  need(![...(r.lines ?? []), ...(r.perUnitPackaging ?? [])].some((l) => l.itemId === toId), `${to.name} is already in ${r.name}`);
  const move = (list) => (list ?? []).map((l) => {
    if (l.itemId !== fromId) return l;
    const u = l.unit || itemOf(store, fromId)?.unit || to.unit;
    return { itemId: toId, qty: l.qty, unit: toItemUnit(to, num(l.qty), u) !== null ? u : to.unit };
  });
  const lines = move(r.lines);
  const perUnitPackaging = move(r.perUnitPackaging);
  const keep = [...lines, ...perUnitPackaging].map((l) => l.itemId);
  return { act: store.write(`${to.name} in ${r.name}`, [{ op: 'set', ref: 'recipe:' + recipeId, patch: { lines, perUnitPackaging } }, ...leftoverItems(store, recipeId, keep)]) };
}

// A material taken out of the formula.
export function dropLine(store, recipeId, itemId) {
  const r = recipeOf(store, recipeId);
  need(r, 'that product is not on file');
  need(!r.locked, LOCKED);
  const lines = (r.lines ?? []).filter((l) => l.itemId !== itemId);
  const perUnitPackaging = (r.perUnitPackaging ?? []).filter((l) => l.itemId !== itemId);
  const keep = [...lines, ...perUnitPackaging].map((l) => l.itemId);
  const name = itemOf(store, itemId)?.name ?? itemId;
  return { act: store.write(`took ${name} out of ${r.name}`, [{ op: 'set', ref: 'recipe:' + recipeId, patch: { lines, perUnitPackaging } }, ...leftoverItems(store, recipeId, keep)]) };
}

// A line moved between the batch and each one made. What a batch uses stays the same the moment
// it moves (12 tins a batch of 12 becomes 1 tin for each one made); after that it scales with
// what comes out.
export function setLinePer(store, recipeId, itemId, per) {
  const r = recipeOf(store, recipeId);
  need(r?.product, 'only a made product has things for each one made');
  need(!r.locked, LOCKED);
  const inEach = (r.perUnitPackaging ?? []).find((l) => l.itemId === itemId);
  const inBatch = (r.lines ?? []).find((l) => l.itemId === itemId);
  need(inEach || inBatch, 'that material is not in ' + r.name);
  if ((per === 'each') === !!inEach) return { act: null };
  const y = num(r.yieldPlanned) > 0 ? num(r.yieldPlanned) : 1;
  const l = inEach ?? inBatch;
  const moved = { itemId, qty: Math.round((inEach ? num(l.qty) * y : num(l.qty) / y) * 1e6) / 1e6, unit: l.unit };
  const lines = inEach ? [...(r.lines ?? []), moved] : (r.lines ?? []).filter((x) => x !== l);
  const perUnitPackaging = inEach ? (r.perUnitPackaging ?? []).filter((x) => x !== l) : [...(r.perUnitPackaging ?? []), moved];
  const name = itemOf(store, itemId)?.name ?? itemId;
  return { act: store.write(`${name} ${per === 'each' ? 'for each one made' : 'for the batch'}`, [{ op: 'set', ref: 'recipe:' + recipeId, patch: { lines, perUnitPackaging } }]) };
}

// A material's new name, everywhere it is used: it is the same material.
export function renameItem(store, itemId, name) {
  const it = itemOf(store, itemId);
  need(it, 'that material is not on file');
  const nm = String(name ?? '').trim();
  need(nm, 'name the material first');
  if (nm === it.name) return { act: null };
  const other = store.data.inventory.items.find((x) => x.id !== itemId && String(x.name).toLowerCase() === nm.toLowerCase());
  need(!other, `${other?.name} is already on file`);
  return { act: store.write(`renamed ${it.name} to ${nm}`, [{ op: 'set', ref: 'item:' + itemId, patch: { name: nm } }]) };
}

// A product's new name: the product, its formula, the goods on the shelf it makes, and a pack still
// called by the old name ("Pine Balm ×3" becomes "Pine Salve ×3").
export function renameProduct(store, productId, name) {
  const p = productOf(store, productId);
  need(p, 'that product is not on file');
  const nm = String(name ?? '').trim();
  need(nm, 'name the product first');
  if (nm === p.name) return { act: null };
  const ops = [{ op: 'set', ref: 'product:' + p.id, patch: { name: nm } }];
  const r = recipeFor(store, p);
  if (r && r.name !== nm) ops.push({ op: 'set', ref: 'recipe:' + r.id, patch: { name: nm } });
  const item = p.itemId ? itemOf(store, p.itemId) : null;
  if (item && (num(p.units) || 1) === 1 && item.name !== nm) ops.push({ op: 'set', ref: 'item:' + item.id, patch: { name: nm } });
  for (const x of store.data.products.products) {
    if (x.id !== p.id && x.itemId && x.itemId === p.itemId && num(x.units) > 1 && x.name === `${p.name} ×${num(x.units)}`) {
      ops.push({ op: 'set', ref: 'product:' + x.id, patch: { name: `${nm} ×${num(x.units)}` } });
    }
  }
  return { act: store.write(`renamed ${p.name} to ${nm}`, ops) };
}

// what is said about a source's price and pack size, checked: blank means not noted
function offerFields(o, { price, qty }) {
  const next = { ...o };
  if (price !== undefined) {
    const s = String(price ?? '').trim();
    if (s === '') delete next.price;
    else { const p = round2(s); need(Number.isFinite(p) && p > 0, 'a price is a number of dollars above zero'); next.price = p; }
  }
  if (qty !== undefined) {
    const s = String(qty ?? '').trim();
    if (s === '') delete next.qty;
    else { const q = num(s); need(Number.isFinite(q) && q > 0, 'the size is how much one buy holds, above zero'); next.qty = q; }
  }
  return next;
}
const offerOf = (v, itemId) => (v?.offers ?? []).find((o) => o.itemId === itemId) ?? null;
const originOf = (u) => { try { return new URL(u).origin; } catch { return ''; } };
const linkOk = (u) => !u || /^https?:\/\//i.test(u);

// The name a site goes by, read from a link to it: amazon.com is Amazon, bulk-apothecary.com is
// Bulk Apothecary, amazon.co.uk is Amazon (Matt, 2026-10-06 18:55Z: "Amazon should automatically
// withdraw into the where it's from sourced and capitalize the Amazon"). Amazon's own short links
// are Amazon too: a.co, amzn.to and amzn.com each answered with a redirect to www.amazon.com,
// measured 2026-10-06. ⚠ A name run together in its address (mountainroseherbs.com) reads as one
// word, Mountainroseherbs: nothing in an address says where its words break, so it is typed over.
const SHORT_LINKS = { 'a.co': 'Amazon', 'amzn.to': 'Amazon', 'amzn.com': 'Amazon' };
export function siteName(url) {
  let h = '';
  try { h = new URL(String(url ?? '').trim()).hostname.toLowerCase().replace(/^www\d*\./, ''); } catch { return ''; }
  if (!h || /^[\d.:[\]]+$/.test(h)) return h;
  const parts = h.split('.').filter(Boolean);
  if (SHORT_LINKS[parts.slice(-2).join('.')]) return SHORT_LINKS[parts.slice(-2).join('.')];
  let i = parts.length - 2;
  // a country's own second level (amazon.co.uk, shop.com.au) is not the site's name
  if (i > 0 && parts[parts.length - 1].length === 2 && /^(co|com|net|org|gov|ac|edu|ltd|plc)$/.test(parts[i])) i--;
  return parts[Math.max(0, i)].split(/[-_]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}
// a source left selling nothing, with nothing in the books pointing at it, goes; else its list shrinks
const offersLeft = (store, v, offers) => (!offers.length && !store.refsTo('vendor:' + v.id).length
  ? { op: 'del', ref: 'vendor:' + v.id } : { op: 'set', ref: 'vendor:' + v.id, patch: { offers } });

// A place that sells a material: a source on file (by its name, in any case) or a new one, named by
// its link's site when no name is typed. A material's first source is its main one, pinned (Matt,
// 2026-10-06 18:55Z: "I want the first one to always be automatically pinned. That's going to be
// your main source"); a later one waits unpinned, ranked under it, until its own Pin is pressed.
export function addOffer(store, itemId, { vendorName, url = '', price, qty, unit }) {
  const item = itemOf(store, itemId);
  need(item, 'that material is not on file');
  const link = String(url ?? '').trim();
  need(linkOk(link), 'a link starts with https://');
  const nm = String(vendorName ?? '').trim() || siteName(link);
  need(nm, 'say who sells it');
  const first = !store.data.sourcing.vendors.some((x) => offerOf(x, itemId));
  const offer = offerFields({ itemId, unit: String(unit || item.unit).trim().toLowerCase(), ...(link ? { url: link } : {}), ...(first ? { last: true } : {}) }, { price, qty });
  const v = store.data.sourcing.vendors.find((x) => String(x.name).toLowerCase() === nm.toLowerCase());
  if (!v) {
    const id = slugFor(store, 'vendor', nm);
    return { act: store.write(`${nm} sells ${item.name}`, [{ op: 'add', type: 'vendor', rec: { id, name: nm, url: originOf(link), offers: [offer] } }]), vendorId: id };
  }
  need(!offerOf(v, itemId), `${v.name} is already a source of ${item.name}`);
  return { act: store.write(`${v.name} sells ${item.name}`, [{ op: 'set', ref: 'vendor:' + v.id, patch: {
    offers: [...(v.offers ?? []), offer], ...(!v.url && link ? { url: originOf(link) } : {}) } }]), vendorId: v.id };
}

// A source's price, pack size, unit or link for one material. The source's own site is learned
// from its first link, so a receipt from that site is known as theirs.
export function setOffer(store, vendorId, itemId, { price, qty, unit, url } = {}) {
  const v = store.resolve('vendor:' + vendorId);
  need(v, 'that source is not on file');
  const o = offerOf(v, itemId);
  need(o, `${v.name} does not sell that`);
  const next = offerFields(o, { price, qty });
  if (unit !== undefined) next.unit = String(unit || itemOf(store, itemId)?.unit || 'each').trim().toLowerCase();
  if (url !== undefined) {
    const link = String(url ?? '').trim();
    need(linkOk(link), 'a link starts with https://');
    if (link) next.url = link; else delete next.url;
  }
  if (JSON.stringify(next) === JSON.stringify(o)) return { act: null };
  const patch = { offers: v.offers.map((x) => (x === o ? next : x)), ...(!v.url && next.url ? { url: originOf(next.url) } : {}) };
  return { act: store.write(`${itemOf(store, itemId)?.name ?? itemId} at ${v.name}`, [{ op: 'set', ref: 'vendor:' + v.id, patch }]) };
}

// The source a material is costed from, pinned; any other pin on it comes off. Unpinned, the
// cheapest priced source is used.
export function pinOffer(store, vendorId, itemId, on = true) {
  const v = store.resolve('vendor:' + vendorId);
  need(offerOf(v, itemId), 'that source does not sell it');
  const ops = [];
  for (const x of store.data.sourcing.vendors) {
    const xo = offerOf(x, itemId);
    if (!xo) continue;
    const want = x.id === vendorId ? !!on : on ? false : !!xo.last;
    if (!!xo.last !== want) ops.push({ op: 'set', ref: 'vendor:' + x.id, patch: { offers: x.offers.map((y) => (y === xo ? { ...y, last: want } : y)) } });
  }
  const name = itemOf(store, itemId)?.name ?? itemId;
  return { act: ops.length ? store.write(on ? `${name} costed from ${v.name}` : `${name} costed from the cheapest`, ops) : null };
}

// A source taken off a material.
export function dropOffer(store, vendorId, itemId) {
  const v = store.resolve('vendor:' + vendorId);
  const o = offerOf(v, itemId);
  need(o, 'that source does not sell it');
  return { act: store.write(`took ${v.name} off ${itemOf(store, itemId)?.name ?? itemId}`, [offersLeft(store, v, v.offers.filter((x) => x !== o))]) };
}

// Who sells it, retyped: a new name for the source, or, when it is the name of another source on
// file, this price moves to that one.
export function renameSource(store, vendorId, itemId, name) {
  const v = store.resolve('vendor:' + vendorId);
  need(v, 'that source is not on file');
  const nm = String(name ?? '').trim();
  need(nm, 'say who sells it');
  if (nm === v.name) return { act: null, vendorId };
  const other = store.data.sourcing.vendors.find((x) => x.id !== vendorId && String(x.name).toLowerCase() === nm.toLowerCase());
  if (!other) return { act: store.write(`renamed ${v.name} to ${nm}`, [{ op: 'set', ref: 'vendor:' + vendorId, patch: { name: nm } }]), vendorId };
  const o = offerOf(v, itemId);
  need(o, `${v.name} does not sell that`);
  const item = itemOf(store, itemId);
  need(!offerOf(other, itemId), `${other.name} is already a source of ${item?.name ?? itemId}`);
  return { act: store.write(`${item?.name ?? itemId} from ${other.name}`, [
    { op: 'set', ref: 'vendor:' + other.id, patch: { offers: [...(other.offers ?? []), o] } },
    offersLeft(store, v, v.offers.filter((x) => x !== o)),
  ]), vendorId: other.id };
}

// A product off the desk with its formula and its count, while nothing in the books has happened to
// it: no batch, no sale, no order, no stock moved. With any of that it stays, because the books
// point at it. A plan for it goes with it; so do the quotes for it and any material only it used.
export function removeProduct(store, { productId, recipeId }) {
  const r = recipeId ? recipeOf(store, recipeId) : null;
  const p = productId ? productOf(store, productId) : null;
  need(r || p, 'that product is not on file');
  const itemId = r?.product ?? p?.itemId ?? null;
  const name = p?.name ?? r?.name;
  const prods = store.data.products.products.filter((x) => x.id === p?.id || (r && x.recipeId === r.id) || (itemId && x.itemId === itemId));
  const mine = new Set([...prods.map((x) => 'product:' + x.id), ...(r ? ['recipe:' + r.id] : [])]);
  const planned = r ? store.data.reservations.reservations.filter((x) => x.recipeId === r.id && x.status === 'planned') : [];
  for (const x of planned) mine.add('reservation:' + x.id);
  const quoted = itemId ? store.data.sourcing.vendors.filter((v) => offerOf(v, itemId)) : [];
  const told = [...prods.map((x) => 'product:' + x.id), ...(r ? ['recipe:' + r.id] : []), ...(itemId ? ['item:' + itemId] : [])]
    .flatMap((ref) => store.refsTo(ref)).filter((x) => !mine.has(x.ref) && !x.ref.startsWith('vendor:'));
  const WHY = { batch: 'made', reservation: 'made', order: 'ordered', po: 'bought', move: 'moved in stock', ledger: 'in Books', event: 'on the calendar' };
  const kinds = new Set(told.map((x) => x.ref.split(':')[0]));
  const why = [...new Set([...Object.keys(WHY).filter((k) => kinds.has(k)).map((k) => WHY[k]), ...([...kinds].some((k) => !(k in WHY)) ? ['pointed at'] : [])])];
  need(!told.length, `${name} has a history (${why.join(', ')}), so it stays on the books`);
  const ops = [
    ...quoted.map((v) => offersLeft(store, v, v.offers.filter((o) => o.itemId !== itemId))),
    ...planned.map((x) => ({ op: 'del', ref: 'reservation:' + x.id })),
    ...prods.map((x) => ({ op: 'del', ref: 'product:' + x.id })),
    ...(r ? [{ op: 'del', ref: 'recipe:' + r.id }, ...leftoverItems(store, r.id, [])] : []),
    ...(itemId && itemOf(store, itemId) ? [{ op: 'del', ref: 'item:' + itemId }] : []),
  ];
  return { act: store.write('removed ' + name, ops) };
}

// A material off the page. One the books never saw goes, with the sources' quotes for it; one they
// did (bought, counted, used) is put away once none is on hand, and comes back by itself the next
// time some arrives; with some on hand it stays, to be counted first.
export function removeItem(store, itemId) {
  const it = itemOf(store, itemId);
  need(it, 'that material is not on file');
  const inUse = store.data.recipes.recipes.filter((r) => [...(r.lines ?? []), ...(r.perUnitPackaging ?? [])].some((l) => l.itemId === itemId));
  need(!inUse.length, `${it.name} is in ${inUse.map((r) => r.name).join(', ')}; take it out there first`);
  const seen = store.refsTo('item:' + itemId).some((x) => !x.ref.startsWith('vendor:'));
  if (seen) {
    need(Math.abs(store.stockOf(itemId)) < 1e-9, `${it.name} has some on hand; count it to 0 first`);
    return { act: store.write('put away ' + it.name, [{ op: 'set', ref: 'item:' + itemId, patch: { retired: true } }]) };
  }
  const ops = store.data.sourcing.vendors.filter((v) => offerOf(v, itemId)).map((v) => offersLeft(store, v, v.offers.filter((o) => o.itemId !== itemId)));
  return { act: store.write('removed ' + it.name, [...ops, { op: 'del', ref: 'item:' + itemId }]) };
}

// --- SHELF / ORDERS ---------------------------------------------------------------------------
function customerOps(store, { customer, email, phone, address }) {
  const name = String(customer ?? '').trim();
  if (!name) return { ops: [], customerId: null };
  const hit = store.data.crew.people.find((p) => String(p.name).toLowerCase() === name.toLowerCase());
  if (hit) return { ops: [], customerId: hit.id };
  const id = slugFor(store, 'person', name);
  return {
    customerId: id,
    ops: [{ op: 'add', type: 'person', rec: { id, name, role: 'Customer', ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(address ? { address } : {}) } }],
  };
}

// An order taken (typed, pasted or a job booked for a day). Nothing in the books yet.
export function newOrder(store, { customer, email, phone, address, lines, due, ship = false, note = '', noTax = false }, deps = {}) {
  need(Array.isArray(lines) && lines.length, 'add at least one product');
  const clean = lines.map((ln) => {
    const p = productOf(store, ln.productId);
    need(p, 'that product is not on the shelf');
    need(num(ln.qty) > 0, 'say how many ' + p.name);
    return { productId: p.id, qty: num(ln.qty), price: round2(ln.price ?? p.price) };
  });
  const c = customerOps(store, { customer, email, phone, address });
  const id = uid('o');
  const at = stampOf(deps);
  const order = {
    id, no: nextOrderNo(store), date: dayOf(deps), status: 'new', channel: 'desk', lines: clean,
    history: [{ at, from: null, to: 'new' }],
    ...(customer ? { customer: String(customer).trim() } : {}), ...(c.customerId ? { customerId: c.customerId } : {}),
    ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(address ? { address } : {}),
    ...(due ? { due } : {}), ...(ship ? { ship: true } : {}), ...(note ? { note } : {}), ...(noTax ? { noTax: true } : {}),
  };
  const act = store.write(`order for ${customer || 'a customer'}`, [...c.ops, { op: 'add', type: 'order', rec: order }]);
  return { act, orderId: id };
}

// Sell at the counter: the order, the money and the stock in one tap.
export function sell(store, productId, qty = 1, { price, customer, noTax = false } = {}, deps = {}) {
  const p = productOf(store, productId);
  need(p, 'that product is not on the shelf');
  const q = num(qty);
  need(q > 0, 'say how many');
  const date = dayOf(deps);
  const id = uid('o');
  const c = customerOps(store, { customer });
  const order = {
    id, no: nextOrderNo(store), date, status: 'done', channel: 'counter',
    lines: [{ productId: p.id, qty: q, price: round2(price ?? p.price) }],
    history: [{ at: stampOf(deps), from: null, to: 'done' }],
    ...(customer ? { customer: String(customer).trim() } : {}), ...(c.customerId ? { customerId: c.customerId } : {}),
    ...(noTax ? { noTax: true } : {}),
  };
  const saleOp = saleEntryOp(store, order, date);
  const out = stockOutOps(store, order, date);
  const act = store.write(`sold ${q} ${p.name}`, [...c.ops, { op: 'add', type: 'order', rec: order }, ...(saleOp ? [saleOp] : []), ...out.ops]);
  return { act, orderId: id, total: orderTotal(store, order), cost: out.cost, warning: out.warnings.join('; ') || null };
}

// Move an order along. Each step writes only what has not been written yet, so an order can skip
// steps (a job paid on the day it is done) and still book everything once.
export function transition(store, orderId, to, opts = {}, deps = {}) {
  const t = transitionOps(store, orderId, to, opts, deps);
  return { act: store.write(t.label, t.ops), from: t.from, to: t.to, cost: t.cost, warning: t.warning };
}

function transitionOps(store, orderId, to, opts = {}, deps = {}) {
  const order = store.resolve('order:' + orderId);
  need(order, 'that order is not on file');
  const from = statusOf(order);
  need((FLOW[from] ?? []).includes(to), `an order that is ${from} cannot become ${to}`);
  const date = dayOf(deps);
  const ref = 'order:' + order.id;
  const trail = orderTrail(store, order);
  const ops = [];
  let warning = null;
  let cost = null;
  if ((to === 'paid' || to === 'done') && !trail.sale) {
    const s = saleEntryOp(store, order, date);
    if (s) ops.push(s);
  }
  if ((to === 'shipped' || to === 'done') && !trail.out) {
    const out = stockOutOps(store, order, date);
    ops.push(...out.ops);
    cost = out.cost;
    warning = out.warnings.join('; ') || null;
  }
  const patch = { status: to };
  if (to === 'shipped') {
    const label = round2(opts.label);
    if (label > 0) {
      ops.push({ op: 'add', type: 'ledger', rec: {
        id: uid('L'), date, desc: `Label for ${orderName(order)}${opts.carrier ? ' (' + opts.carrier + ')' : ''}`,
        postings: [{ account: ACCT.postage, amount: label }, { account: ACCT.cash, amount: -label }],
        links: [ref], tags: { source: 'label', ...(opts.carrier ? { payee: opts.carrier } : {}) },
      } });
    }
    if (opts.tracking) patch.tracking = String(opts.tracking).trim();
    if (opts.carrier) patch.carrier = String(opts.carrier);
    patch.shippedDate = date;
  }
  if (to === 'refunded') {
    need(trail.sale, 'no money came in on this order, so there is nothing to refund');
    const money = (trail.sale.postings ?? []).filter((p) => p.account !== ACCT.cogs && !String(p.account).startsWith('Assets:Inventory'));
    ops.push({ op: 'add', type: 'ledger', rec: {
      id: uid('L'), date, desc: 'Refund ' + orderName(order),
      postings: money.map((p) => ({ account: p.account, amount: round2(-p.amount) })),
      links: [ref], tags: { source: 'refund' },
    } });
    if (opts.goodsBack && trail.out) {
      for (const m of trail.moves.filter((x) => x.kind === 'sale')) {
        ops.push({ op: 'add', type: 'move', rec: { id: uid('mv'), date, itemId: m.itemId, qty: -m.qty, kind: 'return', refs: [ref, ...(m.refs ?? []).filter((r) => r.startsWith('batch:'))] } });
      }
      const c = trail.cost ? (trail.cost.postings ?? []).find((p) => p.account === ACCT.cogs)?.amount : 0;
      if (c > 0) {
        ops.push({ op: 'add', type: 'ledger', rec: {
          id: uid('L'), date, desc: 'Goods back on ' + orderName(order),
          postings: [{ account: ACCT.stock, amount: c }, { account: ACCT.cogs, amount: -c }],
          links: [ref], tags: { source: 'cost-back' },
        } });
      }
    }
  }
  ops.push({ op: 'set', ref, patch, push: { history: { at: stampOf(deps), from, to } } });
  return { ops, label: `${orderName(order)} ${to}`, from, to, cost, warning };
}

// A label bought for an order: its cost leaves cash under postage, the tracking number and the
// carrier land on the order, and an order not yet shipped moves to shipped (which also takes its
// goods off the shelf). An order already shipped or done just gains the label it was missing.
export function labelBought(store, orderId, opts = {}, deps = {}) {
  const t = labelOps(store, orderId, opts, deps);
  return { act: store.write(t.label, t.ops), from: t.from, to: t.to, cost: t.cost, warning: t.warning };
}

function labelOps(store, orderId, { cost, carrier = '', tracking = '' } = {}, deps = {}) {
  const order = store.resolve('order:' + orderId);
  need(order, 'that order is not on file');
  const from = statusOf(order);
  if (from === 'new' || from === 'paid') return transitionOps(store, orderId, 'shipped', { label: cost, carrier, tracking }, deps);
  need(from === 'shipped' || from === 'done', `an order that is ${from} does not get a label`);
  const amt = round2(cost);
  const ref = 'order:' + order.id;
  const ops = [];
  if (amt > 0) {
    ops.push({ op: 'add', type: 'ledger', rec: {
      id: uid('L'), date: dayOf(deps), desc: `Label for ${orderName(order)}${carrier ? ' (' + carrier + ')' : ''}`,
      postings: [{ account: ACCT.postage, amount: amt }, { account: ACCT.cash, amount: -amt }],
      links: [ref], tags: { source: 'label', ...(carrier ? { payee: carrier } : {}) },
    } });
  }
  const patch = {};
  if (tracking) patch.tracking = String(tracking).trim();
  if (carrier) patch.carrier = String(carrier);
  if (Object.keys(patch).length) ops.push({ op: 'set', ref, patch });
  need(ops.length, 'nothing to add to that order');
  return { ops, label: `label for ${orderName(order)}`, from, to: from, cost: null, warning: null };
}

// A label service's shipments file, applied in one act: each row that names an order waiting to
// ship (by its order id, or by the one open order with the recipient's name) books its label's
// cost, carrier and tracking number and moves the order to shipped, so one Undo takes the whole
// file back. A row whose tracking number is already on an order, a second row for an order this
// file already covered, and a row that matches nothing are passed over and counted, never guessed.
export function applyShipments(store, rows, deps = {}) {
  const ops = [];
  const covered = new Set();
  const out = { applied: [], known: 0, unmatched: [], refused: [] };
  const warnings = [];
  for (const row of rows ?? []) {
    if (row?.tracking && hasTracking(store, row.tracking)) { out.known++; continue; }
    const order = row?.orderId ? store.resolve('order:' + row.orderId) : orderForShipment(store, row ?? {});
    if (!order || covered.has(order.id)) { out.unmatched.push(row); continue; }
    try {
      const t = labelOps(store, order.id, { cost: row.cost, carrier: row.carrier ?? '', tracking: row.tracking ?? '' }, deps);
      ops.push(...t.ops);
      if (t.warning) warnings.push(t.warning);
      covered.add(order.id);
      out.applied.push({ orderId: order.id, tracking: row.tracking });
    } catch (e) {
      out.refused.push({ row, why: e?.message ?? String(e) });
    }
  }
  need(ops.length, 'no row in that file matches an order waiting to ship');
  const n = out.applied.length;
  return { act: store.write(`${n} label${n === 1 ? '' : 's'} from a shipments file`, ops), ...out, warning: warnings.join('; ') || null };
}

// Which order a shipments-file row belongs to: its order id when the file carries one, else the
// one order not yet shipped whose customer has the recipient's name. Two candidates is no answer.
export function orderForShipment(store, row) {
  const orders = store.data.orders.orders;
  const id = String(row.order ?? '').trim().toLowerCase();
  if (id) {
    // the desk's own id, a reference the shop gave it, or its number as a person types it (1001, #1001)
    const no = /^#?\d+$/.test(id) ? Number(id.replace('#', '')) : null;
    const hit = orders.find((o) => String(o.id).toLowerCase() === id || String(o.ref ?? '').toLowerCase() === id
      || (no !== null && Number(o.no) === no));
    if (hit) return hit;
  }
  const name = String(row.recipient ?? '').trim().toLowerCase();
  if (!name) return null;
  const open = orders.filter((o) => ['new', 'paid'].includes(statusOf(o)) && String(o.customer ?? '').trim().toLowerCase() === name);
  return open.length === 1 ? open[0] : null;
}

// a tracking number already on an order (a second drop of the same file changes nothing)
export const hasTracking = (store, tracking) => store.data.orders.orders.some((o) => o.tracking === tracking);

// --- WEBSITE: a payment PayPal reported, and the counts the person's own site shows -------------
// Matt, 2026-10-04 20:47Z: "receive a payment it deducts it from shelf and a little alert shows up
// (one payment ready to ship!)" and "(actually when it receives payment from payment processor it
// deducts it from shelf)". A payment PayPal reports (files.readIpn) is booked in ONE act that one
// Undo takes back: the order, paid and waiting on Ship; the money as PayPal split it; PayPal's
// fee; and the goods off the shelf at the payment, not at the label, so the count on the person's
// own site drops when the money lands. A refund or a reversal PayPal reports moves it back.
export const MONEY_ONLY = 'money'; // a PayPal line that is not on the shelf: its money is booked, no goods move
export const SHIP_IN = 'Income:Shipping'; // what a buyer paid for shipping; the label's cost stays under postage
const FEES = 'Expenses:Fees';
export const paypalKey = (name) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const ppRef = (txn) => 'paypal:' + String(txn ?? '').trim();
const cashIn = (e) => round2((e?.postings ?? []).filter((p) => p.account === ACCT.cash).reduce((s, p) => s + num(p.amount), 0));

// What a PayPal payment is already on the books as: its order and sale, else the entry that
// booked its money alone. A refund is found by its own transaction id.
export function paypalBooked(store, txn) {
  if (!txn) return null;
  const order = store.data.orders.orders.find((o) => o.paypal?.txn === txn);
  if (order) return { order, entry: orderTrail(store, order).sale };
  const entry = store.data.ledger.entries.find((e) => (e.links ?? []).includes(ppRef(txn)) && e.tags?.source === 'sale') ?? null;
  return entry ? { order: null, entry } : null;
}
const refundBooked = (store, txn) => store.data.ledger.entries.some((e) => (e.links ?? []).includes(ppRef(txn)) && e.tags?.source !== 'sale' && e.tags?.source !== 'fee');

// Which product a PayPal line is: the product whose id is its item number, else the answer a
// person gave for that PayPal name before (settings.paypalNames), else the one product of exactly
// that name. Two of that name, or none, is no answer: the desk asks, and keeps the answer.
export function productForLine(store, ln) {
  const products = store.data.products.products;
  const id = String(ln?.id ?? '').trim().toLowerCase();
  if (id) {
    const p = products.find((x) => String(x.id).toLowerCase() === id);
    if (p) return p;
  }
  const key = paypalKey(ln?.name);
  if (!key) return null;
  const kept = store.settings.paypalNames?.[key];
  if (kept === MONEY_ONLY) return MONEY_ONLY;
  if (kept && productOf(store, kept)) return productOf(store, kept);
  const hits = products.filter((x) => paypalKey(x.name) === key);
  return hits.length === 1 ? hits[0] : null;
}

// Each line with what it is, and whether the payment can be booked without asking. A payment that
// names no product at all (money sent, an invoice paid) is booked only when a person says so.
export function sortPayment(store, pay, picks = {}) {
  const lines = (pay?.lines ?? []).map((ln, i) => {
    const pick = picks[i];
    const product = pick === MONEY_ONLY ? MONEY_ONLY : pick ? productOf(store, pick) ?? null : productForLine(store, ln);
    return { ...ln, product };
  });
  return { lines, ready: lines.length ? lines.every((l) => l.product) : picks.money === true };
}

// The sales tax inside what the buyer paid for the goods: PayPal's when it charged one; none on a
// sale shipped outside the desk's own state (settings.site.state) or outside the US; else split
// out of the price at the desk's rate, the counter way every sale on this desk is booked.
function webTax(store, pay, paid) {
  if (pay.tax > 0) return { revenue: round2(paid - pay.tax), tax: round2(pay.tax), why: 'paypal' };
  const home = String(store.settings.site?.state ?? '').trim().toUpperCase();
  const country = String(pay.buyer?.country ?? '').toUpperCase();
  const state = String(pay.buyer?.state ?? '').toUpperCase();
  if ((country && country !== 'US') || (home && state && state !== home)) return { revenue: round2(paid), tax: 0, why: 'away' };
  return { ...splitTax(paid, store.settings.taxRate), why: 'rate' };
}

// What a payment paid for its goods (the whole less shipping and handling, any tax inside it); each
// line's share of that (PayPal's own line amounts when it gave every one, else the shelf prices,
// scaled so the shares add up to what was paid); and what the shelf's lines were paid against what
// the Shelf prices them at. Every line is tied to a product or to MONEY_ONLY.
function goodsPaid(pay, lines) {
  const shipping = round2(num(pay.shipping) + num(pay.handling));
  const paid = round2(round2(pay.gross) - shipping);
  const own = lines.length > 0 && lines.every((l) => num(l.amount) > 0);
  const weight = lines.map((l) => (own ? num(l.amount) : l.product !== MONEY_ONLY ? num(l.product.price) * num(l.qty) : 0));
  const sum = weight.reduce((s, w) => s + w, 0);
  const share = lines.map((_, i) => (sum > 0 ? (paid * weight[i]) / sum : paid / lines.length));
  let expected = 0;
  let onShelf = 0;
  lines.forEach((l, i) => { if (l.product !== MONEY_ONLY) { expected += num(l.product.price) * num(l.qty); onShelf += share[i]; } });
  return { shipping, paid, share, expected, onShelf };
}

// A payment that paid less for the shelf's goods than the Shelf prices them at: a discount, a price
// changed after the button was made, or a button whose amount was edited in the page before paying
// (PayPal really takes the smaller sum, so its notice is verified all the same). Matt, 2026-10-05
// 01:35Z: "Don't want nobody getting free shit!" The desk never books one by itself (site.mjs holds
// it for a person, who may book it anyway). Null when it paid enough, or a line is not tied yet.
export function shortPayment(store, pay, picks = {}) {
  const { lines, ready } = sortPayment(store, pay, picks);
  if (!ready || !lines.length) return null;
  const { expected, onShelf } = goodsPaid(pay, lines);
  return onShelf < expected - 0.01 ? { paid: round2(onShelf), expected: round2(expected) } : null;
}

export function takePayment(store, pay, { picks = {}, remember = false } = {}, deps = {}) {
  need(pay?.kind === 'paypal' && pay.txn, 'that is not a payment PayPal reported');
  need(pay.status === 'Completed', `PayPal says this payment is ${pay.status || 'not finished'}; nothing is booked until it says Completed`);
  need(!paypalBooked(store, pay.txn), 'that payment is already on the books');
  need(pay.currency === 'USD', `PayPal says this was paid in ${pay.currency}; the desk keeps its books in dollars, so book what reached you in dollars on Books`);
  const gross = round2(pay.gross);
  need(gross > 0, 'PayPal reports no money on this payment');
  const sorted = sortPayment(store, pay, picks);
  const open = sorted.lines.find((l) => !l.product);
  need(!open, `pick what “${open?.name || open?.id}” is first`);
  need(sorted.ready, 'this payment names no product: say whether to book it as a sale');
  const lines = sorted.lines;
  const { shipping, paid, share, expected, onShelf } = goodsPaid(pay, lines);
  need(paid >= 0, 'PayPal reports more shipping than the whole payment');
  const date = dayOf(deps);
  const id = uid('o');
  const shelf = [];
  const extras = [];
  lines.forEach((l, i) => {
    if (l.product === MONEY_ONLY) { extras.push(`${l.name || l.id || 'a line'} (${store.usd(round2(share[i]))})`); return; }
    shelf.push({ productId: l.product.id, qty: num(l.qty), price: round2(share[i] / num(l.qty)) });
  });
  const { revenue, tax, why } = webTax(store, pay, paid);
  const buyer = pay.buyer ?? {};
  const customer = String(buyer.name ?? '').trim();
  const c = customerOps(store, { customer, email: buyer.email, phone: buyer.phone, address: buyer.address });
  const ops = [...c.ops];
  const links = [ppRef(pay.txn)];
  let order = null;
  if (shelf.length) {
    const physical = shelf.some((ln) => productOf(store, ln.productId)?.itemId);
    const note = [extras.length ? 'Also paid for, not on the shelf: ' + extras.join(', ') : '', pay.memo ? 'Their note: ' + pay.memo : ''].filter(Boolean).join('. ');
    order = {
      id, no: nextOrderNo(store), date, status: 'paid', channel: 'paypal', lines: shelf,
      history: [{ at: stampOf(deps), from: null, to: 'paid' }],
      ...(customer ? { customer } : {}), ...(c.customerId ? { customerId: c.customerId } : {}),
      ...(buyer.email ? { email: buyer.email } : {}), ...(buyer.phone ? { phone: buyer.phone } : {}),
      ...(buyer.address ? { address: buyer.address } : {}),
      ...(physical ? { ship: true } : {}), ...(why === 'away' ? { noTax: true } : {}), ...(note ? { note } : {}),
      paypal: { txn: pay.txn, gross, fee: pay.fee, tax, shipping, currency: pay.currency, ...(pay.test ? { test: true } : {}) },
    };
    ops.push({ op: 'add', type: 'order', rec: order });
    links.unshift('order:' + id);
  }
  const name = order ? orderName(order) : customer || 'from PayPal';
  const postings = [{ account: ACCT.cash, amount: gross }, { account: ACCT.sales, amount: -revenue }];
  if (tax > 0) postings.push({ account: ACCT.tax, amount: -tax });
  if (shipping > 0) postings.push({ account: SHIP_IN, amount: -shipping });
  const what = lines.map((l) => `${l.product === MONEY_ONLY ? l.name || l.id || 'money' : l.product.name} ×${l.qty}`).join(', ');
  ops.push({ op: 'add', type: 'ledger', rec: {
    id: uid('L'), date, desc: `${pay.test ? 'TEST ' : ''}PayPal sale ${name}: ${what || 'no product named'}`,
    postings, links, tags: { source: 'sale', payee: customer || 'PayPal', ...(pay.test ? { test: true } : {}) },
  } });
  const fee = round2(pay.fee);
  if (fee > 0) {
    ops.push({ op: 'add', type: 'ledger', rec: {
      id: uid('L'), date, desc: `PayPal's fee on ${name}`,
      postings: [{ account: FEES, amount: fee }, { account: ACCT.cash, amount: -fee }],
      links, tags: { source: 'fee', payee: 'PayPal' },
    } });
  }
  const warnings = [];
  let cost = null;
  if (order) {
    const out = stockOutOps(store, order, date);
    ops.push(...out.ops);
    cost = out.cost;
    warnings.push(...out.warnings);
  }
  if (onShelf < expected - 0.01) warnings.push(`paid ${store.usd(round2(onShelf))} for goods your Shelf prices at ${store.usd(round2(expected))}: a discount, or a price changed before paying. Check it before you ship`);
  if (pay.test) warnings.unshift('a TEST payment from PayPal’s sandbox; Undo takes it back');
  // a person's pick is kept for that PayPal name, in the same act, so the next payment that names
  // it ties by itself (productForLine) and one Undo takes the pick back with the payment
  const kept = {};
  if (remember) lines.forEach((l, i) => { const key = paypalKey(l.name); if (key && picks[i]) kept[key] = l.product === MONEY_ONLY ? MONEY_ONLY : l.product.id; });
  if (Object.keys(kept).length) ops.push({ op: 'conf', patch: { paypalNames: { ...(store.settings.paypalNames ?? {}), ...kept } } });
  const act = store.write(`${pay.test ? 'test ' : ''}PayPal payment ${name}`, ops);
  return { act, orderId: order?.id ?? null, ship: !!order?.ship, cost, warning: warnings.join('; ') || null };
}

// A refund, or money PayPal took back (a dispute or a chargeback), for a payment on the books:
// the whole payment moves its order to refunded with the same reversal a tap on Orders writes,
// and goods not yet shipped go back on the shelf; part of it books that part, in the same shares
// as the sale. A reversal PayPal cancels books the money back. PayPal's fee moves only as far as
// PayPal says it did (its fee field, signed). One that undoes a payment never booked changes nothing.
export function takeRefund(store, pay, deps = {}) {
  const kinds = { Refunded: 'Refund', Reversed: 'Taken back by PayPal (a dispute or chargeback)', Canceled_Reversal: 'Given back by PayPal (a reversal it cancelled)' };
  need(pay?.kind === 'paypal' && kinds[pay.status] && pay.txn, 'that is not a refund PayPal reported');
  const was = paypalBooked(store, pay.parent);
  need(was?.entry, 'the payment this undoes was never booked on this desk, so there is nothing to take back');
  need(!refundBooked(store, pay.txn), 'that refund is already on the books');
  const words = kinds[pay.status];
  const sign = pay.status === 'Canceled_Reversal' ? 1 : -1;
  const amount = round2(Math.abs(num(pay.gross)));
  const sold = cashIn(was.entry);
  need(amount > 0 && sold > 0, 'PayPal reports no money on this refund');
  const order = was.order;
  const date = dayOf(deps);
  const name = order ? orderName(order) : 'a PayPal sale';
  const links = [...(order ? ['order:' + order.id] : []), ppRef(pay.parent), ppRef(pay.txn)];
  const ops = [];
  let warning = null;
  const st = order ? statusOf(order) : null;
  if (order && sign < 0 && Math.abs(amount - sold) < 0.005 && (FLOW[st] ?? []).includes('refunded')) {
    const t = transitionOps(store, order.id, 'refunded', { goodsBack: st === 'paid' }, deps);
    for (const op of t.ops) {
      if (op.op === 'add' && op.type === 'ledger' && op.rec.tags?.source === 'refund') { op.rec.desc = `${words} ${name}`; op.rec.links = links; }
    }
    ops.push(...t.ops);
    if (st !== 'paid') warning = 'it had already shipped, so no goods went back on the shelf; count any that come back on Inventory';
  } else {
    const ratio = Math.min(1, amount / sold);
    const money = (was.entry.postings ?? []).filter((p) => p.account !== ACCT.cogs && !String(p.account).startsWith('Assets:Inventory'));
    const postings = money.map((p) => ({ account: p.account, amount: p.account === ACCT.cash ? sign * amount : round2(sign * num(p.amount) * ratio) }));
    // the cash leg is exactly what moved; a cent of rounding lands on the sales leg so it balances
    const off = round2(postings.reduce((s, p) => s + p.amount, 0));
    const fix = postings.find((p) => p.account === ACCT.sales) ?? postings.find((p) => p.account !== ACCT.cash);
    if (fix && off) fix.amount = round2(fix.amount - off);
    ops.push({ op: 'add', type: 'ledger', rec: {
      id: uid('L'), date, desc: `${words}${sign < 0 && ratio < 1 ? ' (part)' : ''} ${name}`,
      postings, links, tags: { source: sign < 0 ? 'refund-part' : 'refund-undone', payee: 'PayPal' },
    } });
    if (order && sign > 0 && st === 'refunded') {
      const before = [...(order.history ?? [])].reverse().find((h) => h.to === 'refunded')?.from ?? 'paid';
      ops.push({ op: 'set', ref: 'order:' + order.id, patch: { status: before }, push: { history: { at: stampOf(deps), from: 'refunded', to: before } } });
      warning = 'goods that went back on the shelf when it was taken are still counted there';
    }
  }
  const fee = round2(pay.fee);
  if (fee) {
    ops.push({ op: 'add', type: 'ledger', rec: {
      id: uid('L'), date, desc: `PayPal's fee ${fee < 0 ? 'returned' : 'charged'} on ${name}`,
      postings: [{ account: FEES, amount: fee }, { account: ACCT.cash, amount: -fee }],
      links, tags: { source: 'fee', payee: 'PayPal' },
    } });
  }
  const act = store.write(`${words.toLowerCase()} ${name}`, ops);
  return { act, orderId: order?.id ?? null, warning };
}

// Which products the person's own site shows a count for (settings.site.listed), one tick at a
// time on the Shelf. A service has no count, so it is never put on.
const SITE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function listOnSite(store, productId, on) {
  const p = productOf(store, productId);
  need(p, 'that product is not on the shelf');
  need(p.itemId, 'a service has no count to show on a website');
  need(SITE_ID.test(p.id), `“${p.name}” cannot go on a website: its id has letters a web address cannot carry`);
  const site = store.settings.site ?? {};
  const listed = (site.listed ?? []).filter((x) => x !== p.id);
  if (on) listed.push(p.id);
  return { act: store.write(`${on ? 'showing' : 'no longer showing'} ${p.name} on your website`, [{ op: 'conf', patch: { site: { ...site, listed } } }]) };
}

// The desk's own state, for the sales tax on a website payment (webTax): one shipped to another
// state books none. Two letters as the Postal Service writes them; empty splits every payment at
// the desk's rate.
const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR VI GU AS MP'.split(' '));
export function setSiteState(store, state) {
  const st = String(state ?? '').trim().toUpperCase();
  need(st === '' || US_STATES.has(st), `“${String(state).trim()}” is not a state’s two letters as the Postal Service writes them (MI, OH, CA)`);
  const site = store.settings.site ?? {};
  if ((site.state ?? '') === st) return { act: null };
  return { act: store.write(st ? `your state for website sales: ${st}` : 'no state for website sales', [{ op: 'conf', patch: { site: { ...site, state: st } } }]) };
}

// What the person's own site shows for each product they put on it (settings.site.listed): how
// many can still be sold, which is the shelf count less what open orders promised and have not
// taken off yet. A service has no count and is left out.
export function siteCounts(store, ids = store.settings.site?.listed ?? []) {
  const promised = new Map();
  for (const o of store.data.orders.orders) {
    if (!['new', 'paid'].includes(statusOf(o)) || orderTrail(store, o).out) continue;
    for (const ln of o.lines ?? []) {
      const p = productOf(store, ln.productId);
      if (p?.itemId) promised.set(p.itemId, (promised.get(p.itemId) ?? 0) + (num(p.units) || 1) * num(ln.qty));
    }
  }
  return ids.map((id) => productOf(store, id)).filter((p) => p?.itemId && /^[a-z0-9][a-z0-9-]{0,63}$/.test(p.id)).map((p) => {
    const have = store.stockOf(p.itemId) - (promised.get(p.itemId) ?? 0);
    return { product: p.id, name: String(p.name), price: round2(p.price), available: Math.max(0, Math.floor((have + 1e-9) / (num(p.units) || 1))) };
  });
}

// --- BOOKS --------------------------------------------------------------------------------
export function addExpense(store, { what, amount, category = 'other', personal = false, date }, deps = {}) {
  const desc = String(what ?? '').trim();
  need(desc, 'say what you paid for');
  const amt = round2(amount);
  need(amt > 0, 'type the dollars');
  const cat = categoryById(category) ?? categoryById('other');
  return { act: store.write(`paid for ${desc}`, [{ op: 'add', type: 'ledger', rec: {
    id: uid('L'), date: date || dayOf(deps), desc,
    postings: [{ account: cat.account, amount: amt }, { account: personal ? ACCT.owner : ACCT.cash, amount: -amt }],
    links: [], tags: { source: 'hand', category: cat.id },
  } }]) };
}

// last rule wins (a newer tap replaces an older one)
export function ruleFor(store, payee) {
  let account = null;
  for (const r of store.data.rules.rules) if (r?.match?.payee === payee && r.account) account = r.account;
  return account;
}

// The choices a dropped line can be filed under, beyond Grok's six. 'transfer' is money moved
// between the owner's own accounts (PayPal to the bank): both sides are cash, so it is recorded to
// keep the file reconciled and changes no total.
export const LINE_CHOICES = {
  out: [...CATEGORIES.map((c) => ({ id: c.account, label: c.label })),
    { id: ACCT.tax, label: 'Sales tax paid to the state' },
    { id: 'Equity:OwnerDraws', label: 'Mine, not the business' },
    { id: 'transfer', label: 'Moved between my accounts' }],
  in: [{ id: ACCT.sales, label: 'A sale' },
    { id: UNTAXED, label: 'A sale with no sales tax in it' },
    { id: ACCT.owner, label: 'My own money put in' },
    { id: 'Income:Other', label: 'Other money in' },
    { id: 'transfer', label: 'Moved between my accounts' }],
};

// A line from a dropped file, accepted: money out under the account tapped, money in as a sale
// (gross, the processor's fee and the net when the file says them) or as the owner's own money.
// The account tapped is remembered for that payee, so the next line from them comes pre-picked.
export function acceptLine(store, ln, { account }, deps = {}) {
  return { act: store.write('booked ' + (ln?.payee || 'a line'), acceptLineOps(store, ln, account, deps, new Set())) };
}

// Several lines booked at once (every line whose payee already has a remembered account), as one
// act, so one Undo takes them all back.
export function acceptLines(store, picks, deps = {}) {
  need(Array.isArray(picks) && picks.length, 'no lines to book');
  const ruled = new Set();
  const ops = picks.flatMap((p) => acceptLineOps(store, p.line, p.account, deps, ruled));
  return { act: store.write(`booked ${picks.length} line${picks.length === 1 ? '' : 's'}`, ops), count: picks.length };
}

function acceptLineOps(store, ln, account, deps, ruled) {
  need(ln && Number.isFinite(num(ln.amount)) && num(ln.amount) !== 0, 'that line has no amount');
  need(String(account ?? '').trim(), 'pick what it was for');
  const amt = round2(Math.abs(num(ln.amount)));
  const out = num(ln.amount) < 0;
  const date = ln.date || dayOf(deps);
  let postings;
  let desc;
  if (account === 'transfer') {
    postings = [{ account: ACCT.cash, amount: out ? -amt : amt }, { account: ACCT.cash, amount: out ? amt : -amt }];
    desc = 'Moved between your own accounts: ' + (ln.payee || 'Unknown');
  } else if (out) {
    postings = [{ account, amount: amt }, { account: ACCT.cash, amount: -amt }];
    desc = ln.payee || 'Unknown';
  } else {
    // a sale is the gross the customer paid: the processor's fee is an expense, and the sales
    // tax inside the price is split out exactly as at the counter
    const sale = account === ACCT.sales || account === UNTAXED;
    const fee = sale && ln.fee != null ? round2(Math.abs(num(ln.fee))) : 0;
    const gross = round2(amt + fee);
    postings = [{ account: ACCT.cash, amount: amt }];
    if (fee > 0) postings.push({ account: categoryById('fees').account, amount: fee });
    if (sale) {
      const { revenue, tax } = splitTax(gross, account === UNTAXED ? 0 : store.settings.taxRate);
      postings.push({ account: ACCT.sales, amount: -revenue });
      if (tax > 0) postings.push({ account: ACCT.tax, amount: -tax });
    } else postings.push({ account, amount: -gross });
    desc = 'Money in: ' + (ln.payee || 'Unknown');
  }
  const ops = [{ op: 'add', type: 'ledger', rec: {
    id: uid('L'), date, desc, postings, links: [],
    tags: { payee: ln.payee || 'Unknown', source: ln.source || 'file', ...(ln.fingerprint ? { fingerprint: ln.fingerprint } : {}) },
  } }];
  if (ln.payee && account !== 'transfer' && ruleFor(store, ln.payee) !== account && !ruled.has(ln.payee)) {
    const old = store.data.rules.rules.find((r) => r?.match?.payee === ln.payee);
    if (old) ops.push({ op: 'set', ref: 'rule:' + old.id, patch: { account } });
    else ops.push({ op: 'add', type: 'rule', rec: { id: uid('rule'), match: { payee: ln.payee }, account } });
    ruled.add(ln.payee);
  }
  return ops;
}

// The same money seen twice. A Buy, a label, a pay run or a counter sale already took the money
// in the books; when the bank's or PayPal's file arrives later its line is that money, not new
// money. matchFor finds the entry: the same amount on the cash side (PayPal's gross counts, since
// the desk booked the sale before the fee was known), within five days, not yet tied to a line.
export function matchFor(store, ln) {
  const want = [round2(num(ln.amount))];
  if (ln.gross != null) want.push(round2(num(ln.gross)));
  const dayNo = (d) => Date.parse(String(d) + 'T00:00:00Z') / 864e5;
  let best = null;
  for (const e of store.data.ledger.entries) {
    if (e.tags?.fingerprint || e.tags?.source === 'file') continue;
    let cash = 0;
    for (const p of e.postings ?? []) if (p.account === ACCT.cash) cash += Number(p.amount) || 0;
    cash = round2(cash);
    if (!cash || !want.some((w) => Math.abs(w - cash) < 0.005)) continue;
    const gap = Math.abs(dayNo(e.date) - dayNo(ln.date));
    if (!(gap <= 5)) continue;
    if (!best || gap < best.gap) best = { entry: e, gap, viaGross: Math.abs(cash - round2(num(ln.amount))) >= 0.005 };
  }
  return best ? { entry: best.entry, viaGross: best.viaGross } : null;
}

// Yes, the same money: the line's fingerprint goes on the entry, so the file reads as reconciled
// and a second drop of the same file passes it over. When the desk booked PayPal's gross, the fee
// PayPal kept is booked now, because it is real money the desk did not know about.
export function confirmMatch(store, entryId, ln, deps = {}) {
  const e = store.resolve('ledger:' + entryId);
  need(e, 'that entry is not on the books');
  const ops = [{ op: 'set', ref: 'ledger:' + entryId, patch: { tags: { ...(e.tags ?? {}), fingerprint: ln.fingerprint, seenIn: ln.source || 'file' } } }];
  // the fee is booked only when the desk's entry holds the gross; an entry already at the net
  // has the fee inside it
  let cash = 0;
  for (const p of e.postings ?? []) if (p.account === ACCT.cash) cash += Number(p.amount) || 0;
  const heldGross = ln.gross != null && Math.abs(round2(cash) - round2(num(ln.gross))) < 0.005
    && Math.abs(round2(cash) - round2(num(ln.amount))) >= 0.005;
  const fee = heldGross && ln.fee != null ? round2(Math.abs(num(ln.fee))) : 0;
  if (fee > 0) {
    ops.push({ op: 'add', type: 'ledger', rec: {
      id: uid('L'), date: ln.date || dayOf(deps), desc: `Fee kept by ${ln.source === 'paypal' ? 'PayPal' : 'the processor'} on ${e.desc ?? 'a sale'}`,
      postings: [{ account: categoryById('fees').account, amount: fee }, { account: ACCT.cash, amount: -fee }],
      links: e.links ?? [], tags: { source: 'fee', payee: ln.payee || 'Unknown' },
    } });
  }
  return { act: store.write('matched ' + (ln.payee || 'a line'), ops) };
}

// Re-file an entry already on the books under another account (the old inbox's category tap).
export function refile(store, entryId, account) {
  const e = store.resolve('ledger:' + entryId);
  need(e, 'that entry is not on the books');
  // what sales cost and stock lost stay where the shelf put them: a sale that carries its cost and a
  // fee moves only the fee
  const postings = (e.postings ?? []).map((p) => (p.amount > 0 && String(p.account).startsWith('Expenses:') && !String(p.account).startsWith(ACCT.cogs) ? { ...p, account } : { ...p }));
  const tags = { ...(e.tags ?? {}) };
  delete tags.needsCategory;
  return { act: store.write('filed ' + (e.desc ?? 'an entry'), [{ op: 'set', ref: 'ledger:' + entryId, patch: { postings, tags } }]) };
}

// --- the two pies ------------------------------------------------------------------------------
// Matt, 2026-10-05 22:26Z: "i can have a income pie chart and an expenses pie chart theyre sorted
// by category from real data". Both stand where Kept stands, so the pies add up to the boxes above
// them: income is every Income account, the sales tax already taken out; expenses are every
// Expenses account, stock counted when it sells (What sales cost), never when it is bought. Your
// own money in or out, money moved between your accounts and the tax held for the state are
// neither. A period is a year ('2026'), a month ('2026-10') or 'all'.
export const inPeriod = (e, period) => period === 'all' || String(e?.date ?? '').startsWith(period);
const orderOfEntry = (store, e) => {
  const ref = (e.links ?? []).find((r) => String(r).startsWith('order:'));
  return ref ? store.resolve(ref) : null;
};

// Where each Income and Expenses posting of one entry lands, as { side: 'in' | 'out', key, amount }.
// One place for it, so a slice and the entries it lists can never disagree. A sale tied to an order
// is split across the order's lines by what each line was worth, so income reads by product.
export function slicesOf(store, e) {
  const got = [];
  for (const p of e.postings ?? []) {
    const a = String(p.account);
    const amount = Number(p.amount) || 0;
    if (a.startsWith('Expenses:')) {
      got.push({ side: 'out', key: a.startsWith(SHRINKAGE) ? 'lost' : a.startsWith(ACCT.cogs) ? 'cogs' : categoryOfAccount(a), amount });
      continue;
    }
    if (!a.startsWith('Income:')) continue;
    if (a !== ACCT.sales) { got.push({ side: 'in', key: a, amount: -amount }); continue; }
    const lines = (orderOfEntry(store, e)?.lines ?? [])
      .map((ln) => ({ id: ln.productId, worth: num(ln.price ?? productOf(store, ln.productId)?.price) * num(ln.qty) }))
      .filter((ln) => ln.worth > 0);
    const worth = lines.reduce((s, ln) => s + ln.worth, 0);
    if (!(worth > 0)) { got.push({ side: 'in', key: 'untied', amount: -amount }); continue; }
    for (const ln of lines) got.push({ side: 'in', key: 'product:' + ln.id, amount: -amount * ln.worth / worth });
  }
  return got;
}

const SLICE_WORDS = {
  cogs: 'What sales cost', lost: 'Stock lost', untied: 'Sales not tied to a product',
  [SHIP_IN]: 'Shipping buyers paid', 'Income:Other': 'Other money in',
};
export function sliceLabel(store, key) {
  if (SLICE_WORDS[key]) return SLICE_WORDS[key];
  if (String(key).startsWith('product:')) return productOf(store, key.slice(8))?.name ?? 'A product no longer on the shelf';
  return categoryById(key)?.label ?? String(key).split(':').slice(-1)[0];
}

// One pie: { total, slices: [{ key, label, amount }] }, biggest first. Each slice is rounded to the
// cent, and the cent the rounding leaves over goes on the biggest, so the slices add up to the total.
function pieOf(store, period, side) {
  const by = new Map();
  let exact = 0;
  for (const e of store.data.ledger.entries) {
    if (!inPeriod(e, period)) continue;
    for (const x of slicesOf(store, e)) {
      if (x.side !== side) continue;
      by.set(x.key, (by.get(x.key) ?? 0) + x.amount);
      exact += x.amount;
    }
  }
  const total = round2(exact);
  const slices = [...by].map(([key, amount]) => ({ key, label: sliceLabel(store, key), amount: round2(amount) }))
    .filter((x) => x.amount !== 0)
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  const off = round2(total - slices.reduce((s, x) => s + x.amount, 0));
  if (off && slices.length) slices[0].amount = round2(slices[0].amount + off);
  return { total, slices };
}
export const moneyIn = (store, period = 'all') => pieOf(store, period, 'in');
export const moneyOut = (store, period = 'all') => pieOf(store, period, 'out');

// Income and expenses month by month ('2026-10' → { in, out }), the bars over the pies.
export function byMonth(store) {
  const months = new Map();
  for (const e of store.data.ledger.entries) {
    const m = String(e.date ?? '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) continue;
    const t = months.get(m) ?? { in: 0, out: 0 };
    for (const p of e.postings ?? []) {
      const a = String(p.account);
      if (a.startsWith('Income:')) t.in -= Number(p.amount) || 0;
      else if (a.startsWith('Expenses:')) t.out += Number(p.amount) || 0;
    }
    months.set(m, t);
  }
  for (const t of months.values()) { t.in = round2(t.in); t.out = round2(t.out); }
  return months;
}

// The headline: cash on hand, sales, tax owed, and what the sales kept after their cost and
// every expense. Stock still on the shelf is not spent until it sells, and the screen says so.
export function booksTotals(store, period = 'all') {
  const entries = store.data.ledger.entries.filter((e) => inPeriod(e, period));
  const all = store.data.ledger.entries;
  const sales = round2(-store.sum(entries, 'Income:'));
  const cogs = round2(store.sum(entries, ACCT.cogs));
  const expenses = round2(store.sum(entries, 'Expenses:') - cogs);
  return {
    cash: round2(store.sum(all, 'Assets:Cash')),
    stock: round2(store.sum(all, 'Assets:Inventory')),
    taxOwed: round2(-store.sum(all, 'Liabilities:SalesTax')),
    sales, cogs, expenses, kept: round2(sales - cogs - expenses),
  };
}

// Sales tax paid to the state: the money leaves cash and what is owed goes down by the same.
export function payTax(store, amount, deps = {}) {
  const amt = round2(amount);
  need(amt > 0, 'type what you paid the state');
  return { act: store.write(`paid ${store.usd(amt)} of sales tax`, [{ op: 'add', type: 'ledger', rec: {
    id: uid('L'), date: dayOf(deps), desc: 'Sales tax paid to the state',
    postings: [{ account: ACCT.tax, amount: amt }, { account: ACCT.cash, amount: -amt }],
    links: [], tags: { source: 'tax' },
  } }]) };
}

// --- PEOPLE -------------------------------------------------------------------------------
export function addPerson(store, { name, role = 'Customer', email = '', phone = '', address = '', rate }) {
  const n = String(name ?? '').trim();
  need(n, 'type a name');
  const id = slugFor(store, 'person', n);
  const rec = { id, name: n, role, ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(address ? { address } : {}) };
  if (num(rate) > 0) rec.arrangement = { kind: 'hourly', rate: round2(rate) };
  return { act: store.write('added ' + n, [{ op: 'add', type: 'person', rec }]), id };
}

export function logHours(store, { personId, hours, date, what = '' }, deps = {}) {
  const p = store.resolve('person:' + personId);
  need(p, 'pick who worked');
  const h = num(hours);
  need(h > 0 && h <= 24, 'hours must be between 0 and 24');
  return { act: store.write(`${h} h for ${p.name}`, [{ op: 'add', type: 'timesheet', rec: { id: uid('ts'), personId, date: date || dayOf(deps), hours: h, ...(what ? { what } : {}) } }]) };
}

// Labor counted on batches (makeBatch) and not yet paid to anyone, as a positive number.
export const laborOwed = (store) => round2(-store.sum(store.data.ledger.entries, ACCT.laborOwed));

// Pay someone: the pay run names the hours it covers; the dollars live in the ledger entry. Labor
// already booked on batches is owed, so the pay settles that first and books only the rest as new
// labor: the same hour is never counted twice. With no amount typed, the open hours at the
// person's rate are paid, or, when there are none, what the batches owe.
export function payRun(store, { personId, amount, personal = false }, deps = {}) {
  const p = store.resolve('person:' + personId);
  need(p, 'pick who you paid');
  const paidIds = new Set(store.data.crew.payruns.flatMap((r) => r.timesheetIds ?? []));
  const open = store.data.crew.timesheets.filter((t) => t.personId === personId && !paidIds.has(t.id));
  const rate = p.arrangement?.kind === 'hourly' ? num(p.arrangement.rate) : 0;
  const hours = round2(open.reduce((s, t) => s + num(t.hours), 0));
  const owed = Math.max(0, laborOwed(store));
  const amt = round2(amount ?? (hours * rate || owed));
  need(amt > 0, 'type what you paid');
  const fromOwed = round2(Math.min(amt, owed));
  const fresh = round2(amt - fromOwed);
  const id = uid('pay');
  const date = dayOf(deps);
  return {
    act: store.write(`paid ${p.name}`, [
      { op: 'add', type: 'payrun', rec: { id, personId, date, kind: 'wages', timesheetIds: open.map((t) => t.id) } },
      { op: 'add', type: 'ledger', rec: {
        id: uid('L'), date, desc: 'Pay ' + p.name,
        postings: [
          ...(fromOwed > 0 ? [{ account: ACCT.laborOwed, amount: fromOwed }] : []),
          ...(fresh > 0 ? [{ account: ACCT.labor, amount: fresh }] : []),
          { account: personal ? ACCT.owner : ACCT.cash, amount: -amt },
        ],
        links: ['payrun:' + id], tags: { payee: p.name, source: 'pay' },
      } },
    ]),
    hours, amount: amt, fromOwed,
  };
}

// --- LABOR: kinds of worker, and what an hour of each costs ---------------------------------------
// Matt, 2026-10-04 18:42Z: "I can have different classes of people … a laborer … a different number
// of dollars per hour and that dollar unit per hour will be like a class of laborer based on my
// business". They live in the company settings (settings.laborClasses), not as people: a class is
// a rate, and a recipe names hours of a class per batch (saveProduct).
const laborClassesOf = (store) => (Array.isArray(store.settings.laborClasses) ? store.settings.laborClasses : []);
const laborId = (name, classes) => {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'worker';
  let id = base;
  for (let k = 2; classes.some((c) => c.id === id); k++) id = base + '-' + k;
  return id;
};
export function addLaborClass(store, { name, rate }) {
  const n = String(name ?? '').trim();
  need(n, 'name the kind of worker (helper, skilled, me)');
  const r = round2(rate);
  need(String(rate ?? '').trim() !== '' && Number.isFinite(r) && r >= 0, 'type what an hour costs');
  const classes = laborClassesOf(store);
  need(!classes.some((c) => String(c.name).toLowerCase() === n.toLowerCase()), n + ' is already on file');
  const id = laborId(n, classes);
  return { act: store.conf({ laborClasses: [...classes, { id, name: n, rate: r }] }, `added ${n} at ${store.usd(r)} an hour`), id };
}
export function setLaborRate(store, classId, rate) {
  const classes = laborClassesOf(store);
  const c = classes.find((x) => x.id === classId);
  need(c, 'that kind of worker is not on file');
  const r = round2(rate);
  need(String(rate ?? '').trim() !== '' && Number.isFinite(r) && r >= 0, 'type what an hour costs');
  return { act: store.conf({ laborClasses: classes.map((x) => (x.id === classId ? { ...x, rate: r } : x)) }, `${c.name} at ${store.usd(r)} an hour`) };
}
export function dropLaborClass(store, classId) {
  const classes = laborClassesOf(store);
  const c = classes.find((x) => x.id === classId);
  need(c, 'that kind of worker is not on file');
  const used = store.data.recipes.recipes.filter((r) => (r.labor ?? []).some((l) => l.classId === classId));
  need(!used.length, `${c.name} is on ${used.map((r) => r.name).join(', ')}; take the hours off there first`);
  return { act: store.conf({ laborClasses: classes.filter((x) => x.id !== classId) }, `removed ${c.name}`) };
}

// --- CALENDAR -----------------------------------------------------------------------------
export function addEvent(store, { title, date, kind = 'ops', refs = [], repeat = '', time = '' }) {
  need(String(title ?? '').trim(), 'say what is happening');
  need(/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')), 'pick a day');
  const clock = /^\d{2}:\d{2}$/.test(String(time)) ? String(time) : '';
  const rec = { id: uid('ev'), title: String(title).trim(), date, kind, refs, ...(repeat === 'yearly' ? { repeat: 'yearly' } : {}), ...(clock ? { time: clock } : {}) };
  return { act: store.write('added ' + rec.title, [{ op: 'add', type: 'event', rec }]) };
}

export function markDone(store, eventId, done = true) {
  const ev = store.resolve('event:' + eventId);
  need(ev, 'that date is not on file');
  return { act: store.write((done ? 'done: ' : 'reopened: ') + ev.title, [{ op: 'set', ref: 'event:' + eventId, patch: { done: !!done } }]) };
}

// --- JARS ---------------------------------------------------------------------------------
// A jar is a named part of the cash account (Assets:Cash:Jar:<id>), filled by a transfer, so
// jars plus what is unassigned always equals cash.
export function fillJar(store, jarId, amount, deps = {}) {
  const jar = store.resolve('jar:' + jarId);
  need(jar, 'that jar is not on file');
  const amt = round2(amount);
  need(amt !== 0, 'type an amount');
  return { act: store.write(`set aside for ${jar.name}`, [{ op: 'add', type: 'ledger', rec: {
    id: uid('L'), date: dayOf(deps), desc: `Set aside for ${jar.name}`,
    postings: [{ account: 'Assets:Cash:Jar:' + jarId, amount: amt }, { account: ACCT.cash, amount: -amt }],
    links: [], tags: { jar: jarId, source: 'jar-fill' },
  } }]) };
}

export function addJar(store, { name, target }) {
  const n = String(name ?? '').trim();
  need(n, 'name the jar');
  const id = slugFor(store, 'jar', n);
  return { act: store.write('new jar ' + n, [{ op: 'add', type: 'jar', rec: { id, name: n, ...(num(target) > 0 ? { target: round2(target) } : {}) } }]), id };
}
