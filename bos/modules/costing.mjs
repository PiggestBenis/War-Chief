// costing — the four pure functions that turn ledger history into honest unit
// costs (BUILD CONTRACT v2 §3.1). Every dollar in here is READ from the spine,
// never stored: a purchase IS a ledger entry, so a landed cost can never
// disagree with the books. No DOM, no fetch — Node-importable, store first.
//
//   apportion(entry, lines)      — a purchase's total spread across its lines
//   wacOf(store, itemId[, asOf]) — average price of what is on the shelf
//                                  (moving average cost): recalculated on
//                                  receives, drawn down at consumption
//   recipeCost(store, recipe)    — what a pour would cost at today's prices
//   pourCost(store, batchCode)   — what a batch actually cost when poured,
//                                  frozen at the pour date, recomputed not stored
//
// The honest-empty law (defaults must not fail open): a receive with no ledger
// linkage carries no cost — it never dilutes the average toward $0 — and an
// item with zero costed grams (including one with no moves at all) is UNKNOWN:
// callers show "unknown", never a fake $0.00.

// --- units -------------------------------------------------------------------
// A vendor quotes what a vendor feels like quoting. The shelf is counted in ONE
// unit per item — every item in inventory.json is 'g' or 'each' — but the offers
// behind them are in pounds, fluid ounces, ounces and grams all at once:
//
//     beeswax $51.94 / 3 lb      jojoba $42.37 / 32 floz
//     kaolin  $31.79 / 5 lb      propolis $58.31 / 100 g
//
// So a quote can only be turned into money-per-gram through a conversion, and
// until 2026-09-19 there was none here. entryAndLines() divided the recipe's
// GRAMS by the offer's POUNDS and called the answer a price. MEASURED on a
// two-line purchase (beeswax per pound, propolis per gram, $100 paid):
//
//     before   beeswax $0.69751/g   propolis $0.02349/g   (97.7% / 2.3%)
//     after    beeswax $0.05996/g   propolis $0.91605/g   ( 8.4% / 91.6%)
//
// The beeswax spread weight was overstated by 453.592 — which is not a coincidence,
// it is lb->g exactly. The purchase TOTAL was right both times; what was wrong was
// which item the money landed on, and that is the number the shelf remembers.
//
// The first eight units below are heart.html's table (public/heart.html, `const UNITS=`), value
// for value, deliberately not re-derived. Two copies of one fact is the shape that rots, so when
// /heart's stock function is retired this one is the survivor and that one goes. Until then those
// eight must be changed together.
//
// ⚑ THE 0.92 IS UNVERIFIED and it is the only soft number in the table. It is one density for
// every liquid, inherited from /heart. Real jojoba is nearer 0.868 and castor nearer 0.957, so a
// fluid-ounce offer is carrying roughly ±6% — enough to notice on jojoba, which is the largest oil
// line in the recipe, and nowhere near the 454x this replaces. Weighing a measured millilitre of
// each oil retires it. It only bites when a quote and a shelf sit on DIFFERENT sides of mass and
// liquid; crossesDensity() says when, so a screen can mark the number with ≈.
//
// The rest were added 2026-10-03 for the War Chief desk, where a landscaper buys gas by the gallon
// and edging by the foot. They are not in heart.html and need not be: the owner's data never uses
// them. Each factor is a definition, not a measurement: the US gallon is 231 cubic inches, the inch
// is 2.54 cm exactly, the acre 43,560 square feet. The US customary liquids are defined from the
// fluid ounce (a gallon is 128 of them) so that gallons, quarts, cups and fluid ounces convert into
// one another exactly; the inherited floz factor itself sits 0.03% off ml × 0.92 (27.2155 g against
// 27.2076 g), so a metric-to-US liquid conversion carries that 0.03%. Bulk volume (cubic yards of
// mulch) has its own base, because a cubic yard of mulch converted to pounds at 0.92 would be a lie.
const FLOZ = 27.2155;
export const UNITS = {
  g: ['g', 1], kg: ['g', 1000], oz: ['g', 28.3495], lb: ['g', 453.592],
  ml: ['g', 0.92], l: ['g', 920], floz: ['g', FLOZ], each: ['each', 1],
  gal: ['g', 128 * FLOZ], qt: ['g', 32 * FLOZ], pt: ['g', 16 * FLOZ], cup: ['g', 8 * FLOZ],
  tbsp: ['g', FLOZ / 2], tsp: ['g', FLOZ / 6],
  dozen: ['each', 12], pair: ['each', 2],
  mm: ['m', 0.001], cm: ['m', 0.01], m: ['m', 1], km: ['m', 1000],
  in: ['m', 0.0254], ft: ['m', 0.3048], yd: ['m', 0.9144], mi: ['m', 1609.344],
  sqft: ['m2', 0.09290304], sqyd: ['m2', 0.83612736], m2: ['m2', 1], acre: ['m2', 4046.8564224],
  cuft: ['m3', 0.028316846592], cuyd: ['m3', 0.764554857984], m3: ['m3', 1],
};

// What a unit measures, for totals a person reads. Mass and liquid share a base above (through the
// density) but never share a total: grams of wax plus millilitres of oil is not a number anyone can
// use. An unknown unit word ('bag', 'spool') is its own dimension.
export const DIM = {
  g: 'mass', kg: 'mass', oz: 'mass', lb: 'mass',
  ml: 'liquid', l: 'liquid', floz: 'liquid', gal: 'liquid', qt: 'liquid', pt: 'liquid', cup: 'liquid', tbsp: 'liquid', tsp: 'liquid',
  each: 'count', dozen: 'count', pair: 'count',
  mm: 'length', cm: 'length', m: 'length', km: 'length', in: 'length', ft: 'length', yd: 'length', mi: 'length',
  sqft: 'area', sqyd: 'area', m2: 'area', acre: 'area',
  cuft: 'bulk', cuyd: 'bulk', m3: 'bulk',
};
const unitKey = (unit) => String(unit ?? '').trim().toLowerCase();
export const dimOf = (unit) => DIM[unitKey(unit)] ?? 'unit:' + unitKey(unit);

// true when turning `from` into `to` went through the unverified liquid density.
export function crossesDensity(from, to) {
  const a = DIM[unitKey(from)];
  const b = DIM[unitKey(to)];
  return a !== b && (a === 'mass' || a === 'liquid') && (b === 'mass' || b === 'liquid');
}

// qty in `unit` -> { base, qty } in that unit's base ('g', 'each', 'm', 'm2' or 'm3'), or null when
// the unit is not one we know. Null, never a guess: an unrecognised unit must not
// silently behave like grams.
export function toBase(qty, unit) {
  const u = UNITS[unitKey(unit)];
  if (!u || !Number.isFinite(qty)) return null;
  return { base: u[0], qty: qty * u[1] };
}

// qty in `from` expressed in `to`, or null when the two cannot be compared. The same word on both
// sides is always itself, known unit or not: three bags bought and one bag used is arithmetic that
// needs no table.
export function convert(qty, from, to) {
  if (!Number.isFinite(qty)) return null;
  if (unitKey(from) === unitKey(to)) return qty;
  const a = toBase(qty, from);
  const b = toBase(1, to);
  if (!a || !b || a.base !== b.base || !(b.qty > 0)) return null;
  return a.qty / b.qty;
}

// qty in `unit` expressed in an item's own stock unit, or null when that cannot be done honestly.
// The desk's verbs (buy, make, sell) count through this, never through convert() directly, for one
// reason: the shared density above is an oil's, and a landscaper's gasoline is about 0.74 g/ml, not
// 0.92, so "3 lb of gas" turned into gallons through it would be 24% wrong and look exact. Crossing
// between weight and volume therefore needs the item's own weight per millilitre (item.density, in
// g/ml); without it the crossing is refused and the screen says why. Within one kind of measure
// (gallons to quarts, pounds to grams, dozens to each) nothing is assumed and nothing is refused.
export function toItemUnit(item, qty, unit) {
  const to = item?.unit;
  const q = Number(qty);
  if (!to || !Number.isFinite(q)) return null;
  const from = unit || to;
  if (!crossesDensity(from, to)) return convert(q, from, to);
  const d = Number(item.density);
  if (!(d > 0)) return null;
  if (DIM[unitKey(from)] === 'liquid') {
    const ml = convert(q, from, 'ml');
    return ml === null ? null : convert(ml * d, 'g', to);
  }
  const g = convert(q, from, 'g');
  return g === null ? null : convert(g / d, 'ml', to);
}

// Totals a person can read: one line per dimension, each in the unit its first line used, never
// grams added to counts. lines: [{ qty, unit }] -> [{ dim, qty, unit }].
export function totalsByDim(lines) {
  const out = new Map();
  for (const ln of lines ?? []) {
    const q = Number(ln?.qty);
    if (!Number.isFinite(q)) continue;
    const dim = dimOf(ln.unit);
    if (!out.has(dim)) out.set(dim, { dim, qty: 0, unit: unitKey(ln.unit) || 'each' });
    const t = out.get(dim);
    const c = convert(q, ln.unit, t.unit);
    if (c !== null) t.qty += c;
  }
  return [...out.values()];
}

// The vendor-quote value of `qty unit` at this offer — the spread weight apportion()
// wants, and the "$x listed" the sourcing page shows.
//
// Returns undefined, never a number, when the two sides cannot be compared: an
// unknown unit, a zero-quantity offer, or a base mismatch (grams against 'each' is
// not a conversion, it is a data error). Undefined is the honest-empty law of this
// file applied one level up — apportion() falls back to quantity weighting and the
// page prints "no quote", where a guessed weight would have been believed.
export function listedFor(offer, qty, unit) {
  if (!offer || !Number.isFinite(offer.price)) return undefined;
  if (!(Number(offer.qty) > 0)) return undefined;
  const inOfferUnits = convert(Number(qty), unit, offer.unit);
  if (inOfferUnits === null) return undefined;
  return offer.price * (inOfferUnits / Number(offer.qty));
}

// --- apportion ---------------------------------------------------------------
// entry: a ledger entry. lines: [{ itemId, qty, unit, listed? }] — listed is
// the vendor-quote value of the line, used as the spread weight. Freight and
// discounts ride the spread because they are inside the entry's paid total;
// sales tax is NOT capitalized — a rare hand-added `tags.tax` number is
// excluded from the spread base (it is an ordinary expense, not stock value).
export function apportion(entry, lines) {
  const ls = Array.isArray(lines) ? lines : [];
  if (!ls.length) return [];
  const paid = (entry?.postings ?? []).reduce(
    (s, p) => s + (p.amount > 0 ? p.amount : 0), 0);
  const tax = typeof entry?.tags?.tax === 'number' ? entry.tags.tax : 0;
  const base = paid - tax;
  // weights: listed value when every line has one; else quantity; else equal.
  const allListed = ls.every((l) => typeof l.listed === 'number' && l.listed > 0);
  const weights = ls.map((l) => (allListed ? l.listed : (l.qty > 0 ? l.qty : 1)));
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  return ls.map((l, i) => {
    const landedTotal = base * (weights[i] / wsum);
    return {
      itemId: l.itemId,
      qty: l.qty,
      unit: l.unit,
      landedTotal,
      landedPerUnit: l.qty > 0 ? landedTotal / l.qty : 0,
    };
  });
}

// --- linkage: receive move → the ledger entry that paid for it ----------------
// A receive reaches money two ways: a direct 'ledger:' ref in its refs[], or a
// 'po:' ref whose purchase order the ledger entries link. Returns the entry and
// the lines apportion() should spread it over — the PO's lines (listed values
// scaled from the vendor's quote, exactly as sourcing.mjs prices them) or, for
// the common heart-history case, a single-line synthesis from tags.item + the
// move's own quantity.
function entryAndLines(store, move) {
  const refs = move.refs ?? [];
  let entry = null;
  let po = null;
  for (const r of refs) {
    const t = String(r).split(':')[0];
    if (t === 'ledger' && !entry) entry = store.resolve(r);
    if (t === 'po' && !po) po = store.resolve(r);
  }
  if (!entry && po) {
    entry = store.ledgerFor('po:' + po._id)[0] ?? null;
  }
  if (!entry) return null;

  let lines;
  if (po && Array.isArray(po.lines) && po.lines.length) {
    // A purchase the desk's Buy wrote carries each line's share of what was paid ('cost'),
    // settled the day it was bought. Those shares are the landed totals, exactly, and they never
    // move afterwards. An older purchase without them is weighted by the source's quote as it
    // stands now, which can drift when the quote changes; that is the case the shares retire.
    if (po.lines.every((ln) => typeof ln.cost === 'number' && Number.isFinite(ln.cost) && ln.cost >= 0)) {
      return { entry, lines: po.lines.map((ln) => ({ itemId: ln.itemId, qty: ln.qty, unit: ln.unit })), frozen: po.lines.map((ln) => ln.cost) };
    }
    const vendor = store.resolve('vendor:' + po.vendorId);
    lines = po.lines.map((ln) => {
      const offer = (vendor?.offers ?? []).find((o) => o.itemId === ln.itemId);
      // listedFor() converts the offer into the line's unit first. Before it did,
      // this line divided grams by pounds — see the units block at the top.
      const listed = listedFor(offer, ln.qty, ln.unit);
      return { itemId: ln.itemId, qty: ln.qty, unit: ln.unit, listed };
    });
  } else {
    lines = [{
      itemId: entry.tags?.item ?? move.itemId,
      qty: move.qty,
      unit: (store.resolve('item:' + move.itemId) ?? {}).unit,
    }];
  }
  return { entry, lines };
}

// --- wacOf -------------------------------------------------------------------
// TRUE moving weighted average, walked over every move in date order — the
// BEAT-THEM §1 note 1 formula: on a costed receive the new average is
// (on_hand × old_cost + bought × landed) ÷ total. The average is recalculated
// only on additions (Stocksmith's own distinction): consumption shrinks what
// is on the shelf AT the current average — value and quantity fall together,
// so the average itself never moves at consumption. It does mean the next
// receive weighs against what is actually left, which is the whole point:
// pour-then-rebuy at a drifted price must not keep averaging long-gone grams.
//
// The honest-empty law still binds: a receive with no ledger linkage carries
// no cost — its grams sit in an unpriced pool that never dilutes the average
// toward $0, and consumption draws from that unpriced pool first (opening
// stock is the oldest stock), so a real purchase keeps its real price. Zero
// costed grams = UNKNOWN: callers render "unknown", never $0.00.
// The optional asOf (an ISO date string) caps the walk at that date — this is
// how pourCost freezes a batch at its pour date without storing a copy.
export function wacOf(store, itemId, asOf) {
  const item = store.resolve?.('item:' + itemId) ?? null;
  const itemUnit = item?.unit;
  const all = (store.data?.inventory?.moves ?? [])
    .filter((m) => m.itemId === itemId && (!asOf || String(m.date) <= String(asOf)))
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  let qty = 0;            // everything on the shelf: every move counts
  let costedOnHand = 0;   // costed grams still on the shelf — the average's weight
  let value = 0;          // the dollars those grams are carried at (costedOnHand × avg)
  let avg = 0;            // recalculated ONLY on costed receives
  let unpricedOnHand = 0; // shelf grams with no purchase record (opening stock,
                          // produce, positive adjustments) — consumed first,
                          // NEVER part of the average (fail-open law)
  let costedQty = 0;      // lifetime grams whose arrival reaches a ledger entry
                          // (the known/unknown flag's basis)
  let uncosted = false;   // true when any received gram lacks a purchase record
  const basis = [];

  for (const m of all) {
    qty += m.qty;
    if (m.kind === 'receive') {
      const hit = entryAndLines(store, m);
      const rows = !hit ? []
        : hit.frozen ? hit.lines.map((l, i) => ({ ...l, landedTotal: hit.frozen[i] }))
        : apportion(hit.entry, hit.lines);
      const found = rows.find((r) => r.itemId === itemId) ?? null;
      // The move is counted in the item's own unit, the purchase line in whatever unit it was
      // bought in (3 lb of wax, a shelf counted in grams), so the landed money is spread over the
      // line's quantity converted into the item's unit. Before 2026-10-03 this divided by the
      // line's own quantity, which was harmless only while every line was bought in the shelf's
      // unit. A unit that cannot be converted leaves the receive unpriced: no number beats a guess.
      const inItem = !found ? null : item ? toItemUnit(item, found.qty, found.unit) : Number(found.qty);
      const row = found && inItem > 0 ? { ...found, landedPerUnit: found.landedTotal / inItem } : null;
      if (!row) {
        uncosted = true;
        unpricedOnHand += Math.max(0, m.qty);
        basis.push({ moveId: m.id, entryId: hit?.entry?.id ?? null, qty: m.qty, landedPerUnit: null });
        continue;
      }
      // the §1 note 1 recalculation, verbatim: old value + bought, over total.
      value += m.qty * row.landedPerUnit;
      costedOnHand += m.qty;
      costedQty += m.qty;
      if (costedOnHand > 0) avg = value / costedOnHand;
      basis.push({ moveId: m.id, entryId: hit.entry.id, qty: m.qty, landedPerUnit: row.landedPerUnit });
      continue;
    }
    if (m.qty > 0) {
      // produce / positive adjustment: shelf grams with no purchase behind them.
      unpricedOnHand += m.qty;
      continue;
    }
    // consume / sale / negative adjustment: unpriced grams go first (they are
    // the opening stock — the oldest), then the costed pool shrinks at the
    // current average, which by arithmetic leaves the average unchanged.
    let out = -m.qty;
    const fromUnpriced = Math.min(out, unpricedOnHand);
    unpricedOnHand -= fromUnpriced;
    out -= fromUnpriced;
    const take = Math.min(out, costedOnHand);
    costedOnHand -= take;
    value = costedOnHand * avg;
  }

  return {
    // the running average of the costed grams. Letting uncosted opening stock
    // into the weight would dilute a real price toward $0 — a confidently
    // wrong number (defaults must not fail open).
    unitCost: costedQty > 0 ? avg : 0,
    qty,
    costedQty,
    // no costed gram at all (including an item with zero moves) is uncosted
    // by definition — the flag can never fail open to "honestly $0.00".
    uncosted: uncosted || !(costedQty > 0),
    // a real price exists, but some shelf grams have no purchase on record —
    // callers surfacing the number must say so.
    partial: uncosted && costedQty > 0,
    // what is on the shelf now, split the way a removal draws on it: grams with no purchase
    // behind them go first, then the costed grams at the average (verbs.count reads these)
    costedOnHand,
    unpricedOnHand,
    basis,
  };
}

// true when the average is entirely unknown — not one costed gram exists.
// Covers unlinked receives AND items with no receive history at all (the
// zero-move case: 'labels' on the real data today). Missing w is unknown too.
export function isUnknownCost(w) {
  return !w || !(w.costedQty > 0);
}

// --- recipeCost --------------------------------------------------------------
// What a pour would cost at today's shelf prices (recipe cost). This number
// MOVES when prices drift — it is the live rollup, never the frozen actual.
// Materials: Σ(line qty × live average). Packaging: per-unit qty × planned
// yield. Lines with an unknown average contribute 0 and are counted in
// uncostedCount, so the total is honestly a floor, never a guess.
export function recipeCost(store, recipe) {
  const yieldPlanned = recipe?.yieldPlanned > 0 ? recipe.yieldPlanned : 1;
  const lines = [];
  let perBatch = 0;
  let uncostedCount = 0;
  let partialCount = 0; // priced, but from only the purchased part of the shelf

  // A recipe line may name its own unit (0.4 gal of a gas counted in gal, 12 ml of an ink counted
  // in l); the average is per the item's unit, so the line is converted first. A line whose unit
  // cannot be converted is priced as unknown, never as if the two units were the same.
  const inItem = (itemId, qty, unit) => {
    const item = store.resolve?.('item:' + itemId);
    return item ? toItemUnit(item, qty, unit) : Number(qty);
  };
  for (const ln of recipe?.lines ?? []) {
    const w = wacOf(store, ln.itemId);
    const q = inItem(ln.itemId, ln.qty, ln.unit);
    const unknown = isUnknownCost(w) || q === null;
    const partial = !unknown && !!w.partial;
    const cost = unknown ? 0 : q * w.unitCost;
    if (unknown) uncostedCount++;
    if (partial) partialCount++;
    perBatch += cost;
    lines.push({
      itemId: ln.itemId,
      qty: ln.qty,
      unitCost: unknown ? null : w.unitCost,
      cost,
      uncosted: unknown,
      partial,
    });
  }
  for (const p of recipe?.perUnitPackaging ?? []) {
    const w = wacOf(store, p.itemId);
    const qty = p.qty * yieldPlanned;
    const q = inItem(p.itemId, qty, p.unit);
    const unknown = isUnknownCost(w) || q === null;
    const partial = !unknown && !!w.partial;
    const cost = unknown ? 0 : q * w.unitCost;
    if (unknown) uncostedCount++;
    if (partial) partialCount++;
    perBatch += cost;
    lines.push({
      itemId: p.itemId,
      qty,
      unitCost: unknown ? null : w.unitCost,
      cost,
      uncosted: unknown,
      partial,
    });
  }

  return { perBatch, perUnit: perBatch / yieldPlanned, lines, uncostedCount, partialCount };
}

// --- pourCost ----------------------------------------------------------------
// What this batch actually cost when it was poured (pour cost) — the FROZEN
// actual. Σ over the batch's consume moves × the average AS OF the pour date,
// ÷ actual yield. Deterministic from the spine (wacOf with a date cap), so it
// never needs storing and can never drift. Returns null — not a fake number —
// when the batch is missing, consumed nothing, has no yield, or consumed a
// material whose cost is unknown OR only partly known at the pour date: this
// number lands in real COGS ledger postings, and a partly-known cost is a
// guessed cost — a guessed cost never reaches the books (§4.1).
export function pourCost(store, batchCode) {
  const b = store.resolve('batch:' + batchCode);
  if (!b) return null;
  const ref = 'batch:' + batchCode;
  const consumes = (store.data?.inventory?.moves ?? [])
    .filter((m) => m.kind === 'consume' && (m.refs ?? []).includes(ref));
  if (!consumes.length) return null;
  if (!(b.yieldActual > 0)) return null;

  let total = 0;
  for (const m of consumes) {
    const w = wacOf(store, m.itemId, b.date);
    if (isUnknownCost(w) || w.partial) return null; // no honest number exists yet
    total += Math.abs(m.qty) * w.unitCost;
  }
  return { total, perUnit: total / b.yieldActual, frozen: true };
}

// --- what a source charges, and what a batch costs from it -------------------------------------
// Matt, 2026-10-04 18:42Z: "based on your last purchase, it will use that to calculate … 40 grams
// divided by the four ounces, four ounces will be converted into grams and then divided to get me
// the average cost of ingredient per batch." These price a PLANNED batch from each material's
// source; the books (wacOf, pourCost) still carry what was actually paid for what is on the shelf.

// What one of the item's own units costs at this offer, and how many of those units the offer
// holds; approx when the two sides crossed weight and volume through the shared liquid density.
// Display and planning only: the books never take the ≈ path.
export function offerUnitPrice(item, offer) {
  if (!item || !offer || !(Number(offer.price) > 0) || !(Number(offer.qty) > 0)) return null;
  let q = toItemUnit(item, Number(offer.qty), offer.unit || item.unit);
  let approx = false;
  if (q === null && crossesDensity(offer.unit, item.unit)) { q = convert(Number(offer.qty), offer.unit, item.unit); approx = true; }
  if (!(q > 0)) return null;
  return { price: Number(offer.price) / q, qty: q, approx };
}

// Every source's offer for an item: the pinned one first (its `last` field), then the cheapest per
// unit, then those that cannot be compared. The cheapest priced one is flagged best.
export function offersFor(store, item) {
  const out = [];
  for (const v of store.data.sourcing.vendors) {
    for (const o of v.offers ?? []) if (o.itemId === item.id) out.push({ vendor: v, offer: o, unit: offerUnitPrice(item, o) });
  }
  out.sort((a, b) => (b.offer.last ? 1 : 0) - (a.offer.last ? 1 : 0)
    || (a.unit ? a.unit.price : Infinity) - (b.unit ? b.unit.price : Infinity));
  const priced = out.filter((x) => x.unit);
  if (priced.length > 1) priced.reduce((m, x) => (x.unit.price < m.unit.price ? x : m)).best = true;
  return out;
}

// The offer a batch is priced from: the pinned source ('last'; a buy leaves the price paid on the
// source it was bought from), else the cheapest quote ('quote'); null when no source has a price
// that can be compared.
export function pickOffer(store, item) {
  const offers = offersFor(store, item).filter((o) => o.unit);
  const last = offers.find((o) => o.offer.last);
  if (last) return { ...last, basis: 'last' };
  const best = offers.find((o) => o.best) ?? offers[0];
  return best ? { ...best, basis: 'quote' } : null;
}

// The work one batch takes, at each kind of worker's rate today (settings.laborClasses):
// [{ classId, name, rate, hours, cost }]. A class no longer on file prices as null, never $0.
export function laborPerBatch(store, recipe) {
  const classes = Array.isArray(store.settings?.laborClasses) ? store.settings.laborClasses : [];
  return (recipe?.labor ?? []).map((l) => {
    const c = classes.find((x) => x.id === l.classId);
    const rate = c ? Number(c.rate) || 0 : null;
    const hours = Number(l.hours) || 0;
    return { classId: l.classId, name: c?.name ?? l.classId, rate, hours, cost: rate === null ? null : hours * rate };
  });
}

// What one batch costs, line by line, and how many batches what is on hand covers.
//   lines    materials, then packaging (× the planned yield): { kind, itemId, item, need (in the
//            item's unit, null when the units cannot be compared), raw, have, covers (whole batches
//            on hand covers; null when nothing is needed), pick (the offer priced from), cost, approx }
//   labor    laborPerBatch
//   batches  the fewest batches any line covers; null with no lines that need anything
//   unknown  lines (labor included) with no price, so the total is a floor when it is above zero
//   totals   what a batch uses, one total per kind of measure (grams are never added to counts)
export function batchCost(store, recipe) {
  const yieldPlanned = Number(recipe?.yieldPlanned) > 0 ? Number(recipe.yieldPlanned) : 1;
  const lines = [];
  const add = (kind, itemId, q, unit) => {
    const item = store.resolve('item:' + itemId);
    const need = item ? toItemUnit(item, q, unit) : null;
    const have = item ? store.stockOf(itemId) : 0;
    const covers = need > 0 ? Math.max(0, Math.floor((have + 1e-9) / need)) : null;
    const pick = item ? pickOffer(store, item) : null;
    const cost = pick && need !== null ? need * pick.unit.price : null;
    lines.push({ kind, itemId, item, need, raw: `${q} ${unit || item?.unit || ''}`.trim(), have, covers, pick, cost, approx: !!pick?.unit?.approx });
  };
  for (const ln of recipe?.lines ?? []) add('material', ln.itemId, Number(ln.qty), ln.unit);
  for (const p of recipe?.perUnitPackaging ?? []) add('packaging', p.itemId, Number(p.qty) * yieldPlanned, p.unit);
  const labor = laborPerBatch(store, recipe);
  const sumOf = (xs) => xs.reduce((s, x) => s + (x.cost ?? 0), 0);
  const materials = sumOf(lines.filter((l) => l.kind === 'material'));
  const packaging = sumOf(lines.filter((l) => l.kind === 'packaging'));
  const laborCost = sumOf(labor);
  const total = materials + packaging + laborCost;
  const stocked = lines.filter((l) => l.covers !== null);
  return {
    yieldPlanned, lines, labor, materials, packaging, laborCost, total, perUnit: total / yieldPlanned,
    unknown: lines.filter((l) => l.cost === null).length + labor.filter((l) => l.cost === null).length,
    batches: stocked.length ? Math.min(...stocked.map((l) => l.covers)) : null,
    totals: totalsByDim((recipe?.lines ?? []).map((l) => ({ qty: l.qty, unit: l.unit || store.resolve('item:' + l.itemId)?.unit }))),
  };
}

// The labor a made batch was booked at (verbs.makeBatch writes Expenses:Labor against the batch),
// read back from the ledger, never from a stored copy.
export function laborOfBatch(store, batchCode) {
  let s = 0;
  for (const e of store.ledgerFor('batch:' + batchCode)) {
    for (const p of e.postings ?? []) if (String(p.account) === 'Expenses:Labor') s += Number(p.amount) || 0;
  }
  return s;
}
