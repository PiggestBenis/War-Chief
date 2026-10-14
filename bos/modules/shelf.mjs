// SHELF — the fourth station: what is ready to sell, and the counter. Sell takes the goods off the
// shelf, books the money with the sales tax split out of the price, and moves their cost to cost
// of goods sold, all in one tap (verbs.sell). Each product says what one costs and what is left of
// its price after tax and that cost, and says plainly what that leaves out.
import * as V from './verbs.mjs';
import { recipeCost, laborPerBatch } from './costing.mjs';
import { qty, cell } from './ui.mjs';
import * as site from './site.mjs';

let openProduct = null;

const units = (p) => Number(p.units) || 1;
const countOf = (store, p) => (p.itemId ? Math.floor((store.stockOf(p.itemId) + 1e-9) / units(p)) : null);
const lowOf = (store, p) => {
  if (!p.itemId) return null;
  const item = store.resolve('item:' + p.itemId);
  const have = store.stockOf(p.itemId);
  if (have < units(p) - 1e-9) return 'out';
  if (item && Number(item.reorderAt) > 0 && have <= Number(item.reorderAt) && units(p) === 1) return 'low';
  return null;
};

// what one sale of this product costs, and how that is known: a made thing carries its batch's
// materials AND the labor booked on that batch (Matt, 2026-10-04 18:58Z: "Tags the product with an
// average unit price on shelf"; the labor is in Books as owed until a pay run on People pays it)
function costOf(store, p) {
  const kind = V.kindOf(store, p);
  const recipe = V.recipeFor(store, p);
  if (kind === 'service') {
    if (!recipe || !(recipe.lines ?? []).length) return { each: 0, how: 'no supplies on record' };
    const c = recipeCost(store, recipe);
    return c.uncostedCount ? { each: null, why: 'a supply it uses has no price yet' } : { each: c.perBatch, how: 'the supplies one job uses' };
  }
  const u = V.unitCostOfItem(store, p.itemId);
  if (u.perUnit !== null) {
    const labor = u.laborPerUnit || 0;
    return { each: (u.perUnit + labor) * units(p), labor: labor > 0, how: kind !== 'made' ? 'the average of what you paid' : labor > 0 ? 'what its batch cost to make, labor counted' : 'what its batch cost to make' };
  }
  // a formula whose batch size is not set yet costs a batch, not one: nothing is said until it is
  if (kind === 'made' && recipe && !(Number(recipe.yieldPlanned) > 0)) return { each: null, why: 'how many one batch makes is not set yet' };
  if (kind === 'made' && recipe) {
    const c = recipeCost(store, recipe);
    const work = laborPerBatch(store, recipe);
    const laborEach = work.some((l) => l.cost === null) ? null : work.reduce((s, l) => s + l.cost, 0) / (Number(recipe.yieldPlanned) > 0 ? Number(recipe.yieldPlanned) : 1);
    if (!c.uncostedCount && c.lines.length && laborEach !== null) return { each: (c.perUnit + laborEach) * units(p), labor: laborEach > 0, how: 'at today’s prices' + (laborEach > 0 ? ', labor counted' : '') + '; no batch made yet', approx: true };
    return { each: null, why: laborEach === null ? 'a kind of worker on it is no longer on file' : 'a material in it has no price yet' };
  }
  return { each: null, why: kind === 'made' ? 'no batch made yet' : 'it has not been bought on Inventory yet' };
}

export const station = {
  id: 'shelf',
  title: 'Shelf',
  badge: (store) => store.data.products.products.filter((p) => lowOf(store, p)).length,
  commands: () => [{ label: 'Sell at the counter', hint: 'Shelf', hash: '#shelf' }, { label: 'Add something you resell', hint: 'Shelf', hash: '#shelf' }],
  render(el, desk) {
    const store = desk.store;
    const esc = store.esc;
    if (desk.fresh && store.route.ref?.startsWith('product:')) openProduct = store.route.ref.slice(8);
    const rate = Number(store.settings.taxRate) || 0;
    const order = { made: 0, bought: 1, service: 2 };
    const products = store.data.products.products.slice()
      .sort((a, b) => order[V.kindOf(store, a)] - order[V.kindOf(store, b)] || String(a.name).localeCompare(String(b.name)));
    const people = store.data.crew.people;

    const detail = (p) => {
      const kind = V.kindOf(store, p);
      const c = costOf(store, p);
      const price = Number(p.price) || 0;
      const split = V.splitTax(price, rate);
      const left = c.each === null ? null : V.round2(split.revenue - c.each);
      const recipe = V.recipeFor(store, p);
      return `<div class="open">
        <div class="row">
          ${cell('How many', '<input class="f" data-f="qty" inputmode="decimal" value="1" />', 's')}
          ${cell('Price each', `<input class="f" data-f="price" inputmode="decimal" placeholder="${esc(store.usd(price))}" />`, 's')}
          ${cell('Who bought it', '<input class="f" data-f="customer" list="people-names" placeholder="Optional" autocomplete="off" />')}
        </div>
        ${rate ? '<label class="chip sm" style="cursor:pointer;margin:0 0 8px"><input type="checkbox" data-f="notax" /> No sales tax on this one (out of state, exempt)</label>' : ''}
        <button type="button" class="btn fill" data-do="sell" data-product="${esc(p.id)}">Sell it now</button>
        <h3 class="sub">What one ${kind === 'service' ? 'job' : 'sale'} leaves you</h3>
        ${c.each === null
          ? `<p class="truth">⚠ What one costs is unknown (${esc(c.why)}), so what is left of the price cannot be said yet.</p>`
          : `<p>Of ${esc(store.usd(price))}: ${rate ? esc(store.usd(split.tax)) + ' is sales tax you owe, ' : ''}${c.approx ? 'about ' : ''}${esc(store.usd(c.each))} is what it cost (${esc(c.how)}), and <b>${esc(store.usd(left))}</b> is left. That is before shipping and card or PayPal fees${c.labor ? ', which this number does not know' : ', and your own time, none of which this number knows'}.</p>`}
        <div class="row">
          ${cell('A new price', `<input class="f" data-f="newprice" inputmode="decimal" placeholder="${esc(store.usd(price))} now" />`)}
          <button type="button" class="btn inline" data-do="price" data-product="${esc(p.id)}">Change the price</button>
        </div>
        ${p.itemId && units(p) === 1 ? `<div class="row">
          ${cell('Warn me at', `<input class="f" data-f="warn" data-item="${esc(p.itemId)}" inputmode="decimal" placeholder="How many left" value="${Number(store.resolve('item:' + p.itemId)?.reorderAt) > 0 ? esc(store.resolve('item:' + p.itemId).reorderAt) : ''}" />`, 's')}
        </div>
        <div class="row">
          ${cell('A pack of', '<input class="f" data-f="packn" inputmode="numeric" placeholder="e.g. 3" />', 's')}
          ${cell('Pack price', '<input class="f" data-f="packprice" inputmode="decimal" placeholder="$" />', 's')}
          <button type="button" class="btn inline" data-do="pack" data-product="${esc(p.id)}">Add a pack</button>
        </div>` : ''}
        ${desk.program && p.itemId ? `<label class="chip sm" style="cursor:pointer;margin:0 0 8px"><input type="checkbox" data-do="list" data-product="${esc(p.id)}"${site.listed(store).includes(p.id) ? ' checked' : ''} /> Show its count on my website</label>` : ''}
        <div class="btns">
          <a class="btn" href="#orders/product:${esc(p.id)}">${kind === 'service' ? 'Book a job' : 'Take an order'}</a>
          ${kind === 'made' && recipe ? `<a class="btn" href="#inventory/recipe:${esc(recipe.id)}">Make more</a>` : ''}
          ${kind === 'bought' ? `<a class="btn" href="#inventory/item:${esc(p.itemId)}">Buy more</a>` : ''}
          ${kind === 'service' && recipe ? `<a class="btn" href="#inventory/recipe:${esc(recipe.id)}">What a job uses</a>` : ''}
          ${p.itemId ? `<a class="btn" href="#inventory/item:${esc(p.itemId)}">See it on Inventory</a>` : ''}
        </div>
      </div>`;
    };

    const line = (p) => {
      const kind = V.kindOf(store, p);
      const n = countOf(store, p);
      const low = lowOf(store, p);
      const c = costOf(store, p);
      const isOpen = openProduct === p.id;
      return `<button type="button" class="line" data-do="open" data-product="${esc(p.id)}" data-ref="product:${esc(p.id)}" aria-expanded="${isOpen}">
          <span class="nm">${esc(p.name)}${low ? ` <span class="badge gold">${esc(low)}</span>` : ''}<small>${kind === 'service' ? 'a service' : kind === 'made' ? 'made here' : 'bought in'}${units(p) > 1 ? ' · a pack of ' + esc(units(p)) : ''} · ${n === null ? 'no shelf count' : esc(qty(n)) + ' ready'}${desk.program && site.listed(store).includes(p.id) ? ' · on your website' : ''}</small></span>
          <span class="amt">${esc(store.usd(Number(p.price) || 0))}${c.each !== null && kind !== 'service' ? `<small>costs ${c.approx ? 'about ' : ''}${esc(store.usd(c.each))} each</small>` : ''}</span>
        </button>${isOpen ? detail(p) : ''}`;
    };

    el.innerHTML = `
      <h1 class="title">Shelf</h1>
      <datalist id="people-names">${people.map((x) => `<option value="${esc(x.name)}"></option>`).join('')}</datalist>
      ${products.length ? `<div class="list">${products.map(line).join('')}</div>`
        : '<div class="btns"><a class="btn fill" href="#inventory/new">Add a product</a></div>'}
      <h2 class="sect">Add something you resell</h2>
      <div class="row">
        ${cell('Name', '<input class="f" id="sh-name" placeholder="As it came from your supplier" autocomplete="off" />')}
        ${cell('Price', '<input class="f" id="sh-price" inputmode="decimal" placeholder="$" />', 's')}
        ${cell('Warn me at', '<input class="f" id="sh-alert" inputmode="decimal" placeholder="Optional" />', 's')}
      </div>
      <button type="button" class="btn" data-do="add">Add it</button>
      ${site.sectionHTML(desk)}`;

    // the shelf's own warning: saved as the cursor leaves it, like Inventory's counts
    el.onchange = (e) => {
      const t = e.target;
      if (t.dataset?.f === 'warn') desk.act(() => V.setAlert(store, t.dataset.item, t.value), { keep: true, quiet: true });
    };
    el.onclick = (e) => {
      const b = e.target.closest('[data-do]');
      if (!b) return;
      if (site.onSectionClick(desk, b, el)) return;
      const id = b.dataset.product;
      const box = b.closest('.open');
      const f = (k) => box?.querySelector(`[data-f="${k}"]`)?.value ?? '';
      switch (b.dataset.do) {
        case 'open': openProduct = openProduct === id ? null : id; desk.rerender(); return;
        case 'sell': {
          const price = f('price').trim();
          const noTax = !!box?.querySelector('[data-f="notax"]')?.checked;
          desk.act(() => V.sell(store, id, f('qty'), { price: price === '' ? undefined : price, customer: f('customer').trim() || undefined, noTax }),
            { next: (r) => (r?.cost === null ? { label: 'Why no cost?', hash: '#shelf/product:' + id } : { label: 'See Books', hash: '#books' }) });
          return;
        }
        case 'price': desk.act(() => V.setPrice(store, id, f('newprice'))); return;
        case 'list': desk.act(() => V.listOnSite(store, id, b.checked), { keep: true }); return;
        case 'pack': {
          const r = desk.act(() => V.addPack(store, id, { units: Number(f('packn')), price: f('packprice') }));
          if (r) { openProduct = r.id; desk.rerender(); }
          return;
        }
        case 'add': {
          const r = desk.act(() => V.saveProduct(store, { name: el.querySelector('#sh-name').value, kind: 'bought',
            price: el.querySelector('#sh-price').value, alert: el.querySelector('#sh-alert').value || undefined }),
          { next: (res) => ({ label: 'Buy some', hash: '#inventory/item:' + res.itemId }) });
          if (r) { openProduct = r.productId; desk.rerender(); }
        }
      }
    };
  },
};
