// ORDERS — the fifth station: orders and jobs, from taken to paid to done.
//
// An order is taken with nothing in the books. Each step after it books only what it has to
// (verbs.transition): Paid puts the money in Books with the tax split out, Shipped or Done takes
// the goods (or a job's supplies) off Stock and moves their cost, Refund puts the money back and,
// when the goods came back, the stock too. A step can be skipped (a job paid on the day it is
// done) and everything is still booked exactly once, because each step reads what the order has
// already written instead of trusting a flag.
import * as V from './verbs.mjs';
import { copyText, todayIso, cell } from './ui.mjs';
import * as site from './site.mjs';

let filter = 'open';
let draft = null;
let refundAsk = null;
let showAll = false;
const blankLine = () => ({ productId: '', qty: '1', price: '' });
const freshDraft = () => ({ customer: '', email: '', phone: '', address: '', lines: [blankLine()], due: '', ship: false, note: '', noTax: false });

const OPEN = new Set(['new', 'paid', 'shipped']);
const WORD = { paid: 'Paid', shipped: 'Shipped', done: 'Done', cancelled: 'Cancel' };

function orderForm(store) {
  const esc = store.esc;
  const d = draft;
  const products = store.data.products.products.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  // the first line carries the captions; the lines under it read by the same columns
  const row = (ln, i) => {
    const c = (cap, input, size) => (i === 0 ? cell(cap, input, size) : input);
    const sz = i === 0 ? '' : ' s';
    return `<div class="row" data-line="${i}">
      ${c('What they want', `<select class="f" data-f="productId" aria-label="Product">
        <option value="">Pick a product or job</option>
        ${products.map((p) => `<option value="${esc(p.id)}"${p.id === ln.productId ? ' selected' : ''}>${esc(p.name)} · ${esc(store.usd(Number(p.price) || 0))}</option>`).join('')}
      </select>`)}
      ${c('How many', `<input class="f${sz}" data-f="qty" inputmode="decimal" placeholder="How many" value="${esc(ln.qty)}" aria-label="How many" />`, 's')}
      ${c('Price each', `<input class="f${sz}" data-f="price" inputmode="decimal" placeholder="As listed" value="${esc(ln.price)}" aria-label="Price each, if different" />`, 's')}
      ${d.lines.length > 1 ? `<button type="button" class="btn inline" data-do="drop-line" data-i="${i}" aria-label="Remove">×</button>` : ''}
    </div>`;
  };
  return `<div class="card" id="or-form">
    <h3 class="sub" style="margin-top:0">Take an order</h3>
    <datalist id="people-names">${store.data.crew.people.map((x) => `<option value="${esc(x.name)}"></option>`).join('')}</datalist>
    ${cell('Who it is for', `<input class="f" data-d="customer" list="people-names" placeholder="A name" value="${esc(d.customer)}" autocomplete="off" />`)}
    <div class="row">
      ${cell('Email', `<input class="f" data-d="email" type="email" placeholder="Optional" value="${esc(d.email)}" />`)}
      ${cell('Phone', `<input class="f" data-d="phone" type="tel" placeholder="Optional" value="${esc(d.phone)}" />`)}
    </div>
    ${cell('Address', `<textarea class="f" data-d="address" placeholder="Where it ships, or where the job is" style="min-height:70px">${esc(d.address)}</textarea>`)}
    ${d.lines.map(row).join('')}
    ${products.length ? '<button type="button" class="btn inline" data-do="add-line" style="margin:2px 0 8px">+ Another line</button>'
      : '<p class="note">Nothing to sell yet. Add a product on Inventory.</p>'}
    ${cell('When (a promised day, or the day of the job)', `<input class="f" data-d="due" type="date" value="${esc(d.due)}" />`)}
    <div class="chips">
      <button type="button" class="chip${d.ship ? ' on' : ''}" data-do="ship" data-v="1" aria-pressed="${d.ship}">It ships</button>
      <button type="button" class="chip${d.ship ? '' : ' on'}" data-do="ship" data-v="0" aria-pressed="${!d.ship}">Picked up or done on site</button>
    </div>
    ${Number(store.settings.taxRate) > 0 ? `<div class="chips">
      <button type="button" class="chip${d.noTax ? '' : ' on'}" data-do="tax" data-v="1" aria-pressed="${!d.noTax}">Sales tax is in the price</button>
      <button type="button" class="chip${d.noTax ? ' on' : ''}" data-do="tax" data-v="0" aria-pressed="${d.noTax}">No sales tax (out of state, exempt)</button>
    </div>` : ''}
    ${cell('A note', `<input class="f" data-d="note" placeholder="A gate code, a size, a colour…" value="${esc(d.note)}" />`)}
    <div class="btns">
      <button type="button" class="btn fill" data-do="take">Take the order</button>
      <button type="button" class="btn" data-do="close-form">Not now</button>
    </div>
    <p class="note">Nothing goes into the books yet. Mark it paid when the money comes, and done (or shipped) when it is.</p>
  </div>`;
}

function card(store, o) {
  const esc = store.esc;
  const st = V.statusOf(o);
  const trail = V.orderTrail(store, o);
  const total = V.orderTotal(store, o);
  const today = todayIso();
  const late = o.due && o.due < today && OPEN.has(st);
  const lines = (o.lines ?? []).map((ln) => {
    const p = store.resolve('product:' + ln.productId);
    return `${esc(ln.qty)} × ${p ? store.chip('product:' + p.id, p.name) : `<span class="chip gone">${esc(ln.productId)}</span>`} <span class="note">${esc(store.usd(Number(ln.price ?? p?.price ?? 0)))}</span>`;
  }).join('<br>');
  const hasGoods = (o.lines ?? []).some((ln) => store.resolve('product:' + ln.productId)?.itemId);
  const next = (V.FLOW[st] ?? []).filter((to) => !(to === 'shipped' && !o.ship));
  const buttons = next.map((to) => {
    // paid and going in the post, shipping is the next step, so it is the filled one, not Done
    if (to === 'shipped') return `<a class="btn${st === 'paid' ? ' fill' : ''}" href="#ship/order:${esc(o.id)}">Ship it</a>`;
    if (to === 'refunded') return `<button type="button" class="btn" data-do="refund-ask" data-order="${esc(o.id)}">Refund…</button>`;
    return `<button type="button" class="btn${to === 'paid' || (to === 'done' && !(st === 'paid' && o.ship)) ? ' fill' : ''}" data-do="go" data-to="${esc(to)}" data-order="${esc(o.id)}">${esc(to === 'done' && !hasGoods ? 'Job done' : WORD[to])}</button>`;
  }).join('');
  const refundRow = refundAsk === o.id ? `<div class="btns">
      ${trail.out && hasGoods ? `<button type="button" class="btn" data-do="refund" data-back="1" data-order="${esc(o.id)}">Refund, it came back</button>` : ''}
      <button type="button" class="btn" data-do="refund" data-back="0" data-order="${esc(o.id)}">Refund${trail.out && hasGoods ? ', they keep it' : ''}</button>
      <button type="button" class="btn" data-do="refund-no">Keep the sale</button>
    </div>` : '';
  const money = store.ledgerFor('order:' + o.id).map((e) => store.chip('ledger:' + e.id)).join(' ');
  const costUnknown = trail.sale && trail.out && !trail.cost && hasGoods;
  return `<div class="card" data-ref="order:${esc(o.id)}">
    <div class="line" style="padding:0;border:0">
      <span class="nm"><b>${esc(o.customer || 'A customer')}</b> <span class="badge plain">${esc(st)}</span>${late ? ' <span class="badge gold">late</span>' : ''}
        <small>${esc(V.orderName(o))} · taken ${esc(o.date ?? '')}${o.due ? ' · due ' + esc(o.due) : ''}${o.ship ? ' · ships' : ''}${o.noTax ? ' · no sales tax' : ''}${o.tracking ? ' · tracking ' + esc(o.tracking) : ''}</small></span>
      <span class="amt">${esc(store.usd(total))}</span>
    </div>
    <p style="margin:8px 0">${lines}</p>
    ${o.note ? `<p class="note">${esc(o.note)}</p>` : ''}
    <div class="chips">
      ${o.email ? `<a class="chip sm" href="mailto:${esc(o.email)}">${esc(o.email)}</a>` : ''}
      ${o.phone ? `<a class="chip sm" href="tel:${esc(String(o.phone).replace(/[^\d+]/g, ''))}">${esc(o.phone)}</a>` : ''}
      ${o.address ? `<button type="button" class="chip sm" data-do="copy" data-text="${esc(o.address)}">Copy the address</button>` : ''}
      <a class="chip sm" href="#mail/order:${esc(o.id)}">Write to them</a>
      ${o.customerId ? store.chip('person:' + o.customerId, 'Their card') : ''}
    </div>
    ${money ? `<div class="chips">${money}</div>` : ''}
    ${costUnknown ? '<p class="truth">⚠ The money is booked, but what these goods cost is unknown (a material or batch behind them has no price), so this sale’s cost is not in Books. It is never written as $0.</p>' : ''}
    ${buttons ? `<div class="btns">${buttons}</div>` : ''}${refundRow}
  </div>`;
}

export const station = {
  id: 'orders',
  title: 'Orders',
  // open orders, and the website's payments waiting for a pick (site.mjs)
  badge: (store) => store.data.orders.orders.filter((o) => ['new', 'paid'].includes(V.statusOf(o))).length + site.waiting().length,
  commands: () => [{ label: 'Take an order', hint: 'Orders', hash: '#orders' }, { label: 'Book a job', hint: 'Orders', hash: '#orders' }],
  render(el, desk) {
    const store = desk.store;
    const esc = store.esc;
    const ref = store.route.ref ?? '';
    if (desk.fresh && ref.startsWith('product:') && store.resolve(ref)) {
      draft = freshDraft();
      draft.lines = [{ productId: ref.slice(8), qty: '1', price: '' }];
    }
    if (desk.fresh && ref.startsWith('person:') && store.resolve(ref)) {
      const p = store.resolve(ref);
      draft = { ...freshDraft(), customer: p.name, email: p.email ?? '', phone: p.phone ?? '', address: p.address ?? '' };
    }
    if (desk.fresh && ref.startsWith('order:')) {
      const o = store.resolve(ref);
      if (o) filter = OPEN.has(V.statusOf(o)) ? 'open' : 'all';
    }
    const all = store.data.orders.orders;
    const pick = all.filter((o) => (filter === 'all' ? true : filter === 'open' ? OPEN.has(V.statusOf(o)) : V.statusOf(o) === 'done'));
    pick.sort(filter === 'open'
      ? (a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(b.date).localeCompare(String(a.date))
      : (a, b) => String(b.date).localeCompare(String(a.date)));
    if (desk.fresh && ref.startsWith('order:') && pick.findIndex((o) => 'order:' + o.id === ref) >= 40) showAll = true; // a link past the first forty
    const shown = showAll ? pick : pick.slice(0, 40);
    const count = (f) => all.filter((o) => (f === 'all' ? true : f === 'open' ? OPEN.has(V.statusOf(o)) : V.statusOf(o) === 'done')).length;

    el.innerHTML = `
      <h1 class="title">Orders</h1>
      ${site.waitingHTML(desk)}
      ${draft ? orderForm(store) : '<div class="btns"><button type="button" class="btn fill" data-do="open-form">+ Take an order</button></div>'}
      <div class="chips" role="tablist">
        ${[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([k, w]) => `<button type="button" class="chip${filter === k ? ' on' : ''}" data-do="filter" data-v="${k}" aria-pressed="${filter === k}">${w} · ${count(k)}</button>`).join('')}
      </div>
      ${shown.length ? shown.map((o) => card(store, o)).join('') : `<p class="note">${filter === 'open' ? 'No open orders.' : 'None yet.'}</p>`}
      ${pick.length > shown.length ? `<button type="button" class="btn" data-do="more">Show all ${pick.length}</button>` : ''}`;

    const lineAt = (node) => Number(node.closest('[data-line]')?.dataset.line);
    el.oninput = (e) => {
      if (!draft) return;
      const k = e.target.dataset?.d;
      if (k) { draft[k] = e.target.value; return; }
      const f = e.target.dataset?.f;
      const i = lineAt(e.target);
      if (f && Number.isInteger(i) && draft.lines[i]) draft.lines[i][f] = e.target.value;
    };
    el.onchange = (e) => {
      if (!draft) return;
      // a known customer fills in what the desk already has for them
      if (e.target.dataset?.d === 'customer') {
        const p = store.data.crew.people.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
        if (p && !draft.email && !draft.phone && !draft.address) {
          Object.assign(draft, { email: p.email ?? '', phone: p.phone ?? '', address: p.address ?? '' });
          desk.rerender();
        }
        return;
      }
      const f = e.target.dataset?.f;
      const i = lineAt(e.target);
      if (f === 'productId' && Number.isInteger(i) && draft.lines[i]) draft.lines[i].productId = e.target.value;
    };
    el.onclick = async (e) => {
      const b = e.target.closest('[data-do]');
      if (!b) return;
      if (site.onWaitingClick(desk, b)) return;
      const id = b.dataset.order;
      switch (b.dataset.do) {
        case 'open-form': draft = freshDraft(); desk.rerender(); el.querySelector('[data-d="customer"]')?.focus(); return;
        case 'close-form': draft = null; desk.rerender(); return;
        case 'add-line': draft.lines.push(blankLine()); desk.rerender(); return;
        case 'drop-line': draft.lines.splice(Number(b.dataset.i), 1); desk.rerender(); return;
        case 'ship': draft.ship = b.dataset.v === '1'; desk.rerender(); return;
        case 'tax': draft.noTax = b.dataset.v === '0'; desk.rerender(); return;
        case 'filter': filter = b.dataset.v; showAll = false; desk.rerender(); return;
        case 'more': showAll = true; desk.rerender(); return;
        case 'take': {
          const d = draft;
          const lines = d.lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, qty: l.qty, ...(String(l.price).trim() !== '' ? { price: l.price } : {}) }));
          const r = desk.act(() => V.newOrder(store, {
            customer: d.customer.trim(), email: d.email.trim(), phone: d.phone.trim(), address: d.address.trim(),
            lines, due: d.due, ship: d.ship, note: d.note.trim(), noTax: d.noTax,
          }), { next: (res) => (d.ship ? { label: 'Ship it', hash: '#ship/order:' + res.orderId } : { label: 'Write to them', hash: '#mail/order:' + res.orderId }) });
          if (r) { draft = null; filter = 'open'; desk.rerender(); }
          return;
        }
        case 'go': {
          const to = b.dataset.to;
          desk.act(() => V.transition(store, id, to), {
            next: to === 'paid' ? { label: 'Send the receipt', hash: '#mail/order:' + id } : to === 'done' ? { label: 'See Books', hash: '#books' } : undefined,
          });
          return;
        }
        case 'refund-ask': refundAsk = id; desk.rerender(); return;
        case 'refund-no': refundAsk = null; desk.rerender(); return;
        case 'refund': {
          const r = desk.act(() => V.transition(store, id, 'refunded', { goodsBack: b.dataset.back === '1' }), { next: { label: 'Tell them', hash: '#mail/order:' + id } });
          if (r) { refundAsk = null; desk.rerender(); }
          return;
        }
        case 'copy': desk.toast((await copyText(b.dataset.text)) ? 'Copied the address' : 'Could not copy; select it and copy by hand', { error: false });
      }
    };
  },
};
