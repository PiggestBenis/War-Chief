// SHIP — the sixth station: orders waiting to go out. Buy the label at your carrier (in the
// program its page opens beside the desk as one of Ship's web tabs), then type what the label cost and
// its tracking number: one act books the label's cost in Books, puts the tracking number on the
// order, moves it to shipped and, if that had not happened yet, takes the goods off the shelf
// (verbs.labelBought). A label service's shipments file can do the typing instead: drop it and
// every row that names a waiting order is applied in one act. A label's receipt dragged out of
// the carrier's page onto the desk (takeLabel) fills the order's form the same way, and the one
// tap on Label bought still books it.
import * as V from './verbs.mjs';
import { copyText, outLink, cell } from './ui.mjs';

// The carriers, then the places that sell their labels: the major ones, none of them the default
// (Matt, 2026-10-05 22:26Z: "just because i use pirateship doesnt mean everyone has to"). Each opens
// at its sign-in, or the page closest to shipping something. Loaded 2026-10-05 in the program's own
// engine as a visitor not signed in: USPS lands on Click-N-Ship's sign-in, DHL on its page to ship a
// parcel, Amazon on Seller Central, Shippo on its sign-in. UPS and FedEx answered this test machine
// with a blank page and a "System Down" page, their wall against machines, so a deeper address could
// not be seen and they keep their front pages. Pirate Ship's app address answered on 2026-10-04.
export const CARRIERS = [
  { name: 'USPS', url: 'https://cns.usps.com/' },
  { name: 'UPS', url: 'https://www.ups.com' },
  { name: 'FedEx', url: 'https://www.fedex.com' },
  { name: 'DHL', url: 'https://mydhl.express.dhl/us/en/home.html' },
  { name: 'Amazon', url: 'https://sellercentral.amazon.com' },
  { name: 'Pirate Ship', url: 'https://ship.pirateship.com' },
  { name: 'Shippo', url: 'https://apps.goshippo.com' },
];

const form = new Map(); // orderId -> { carrier, cost, tracking }
let pending = null;     // a shipments file read but not applied: { name, result }
let dropped = null;     // a label read from a web page, not yet tied to an order (files.readDropped)
let addingCarrier = false;

// a label's numbers written into an order's form, where Label bought reads them; a carrier the
// person already picked for this order stays
const fillFrom = (o, lab) => {
  const f = form.get(o.id) ?? {};
  form.set(o.id, { ...f, tracking: lab.tracking || f.tracking || '', cost: lab.cost !== null && lab.cost !== undefined ? String(lab.cost) : (f.cost ?? ''), carrier: f.carrier || lab.carrier || '', date: lab.date || f.date || '' });
};
const waiting = (store) => store.data.orders.orders.filter((o) => o.ship && ['new', 'paid'].includes(V.statusOf(o)))
  .sort((a, b) => String(a.due || a.date).localeCompare(String(b.due || b.date)));
const carriersOf = (store) => {
  const custom = (store.settings.carriers ?? []).filter((c) => c && c.name);
  // the ones this desk has used come first
  const used = [...new Set(store.data.orders.orders.map((o) => o.carrier).filter(Boolean))];
  const all = [...CARRIERS, ...custom.filter((c) => !CARRIERS.some((d) => d.name === c.name))];
  return all.sort((a, b) => (used.includes(b.name) ? 1 : 0) - (used.includes(a.name) ? 1 : 0));
};

// The orders waiting to ship whose customer's name is written in a label's text (a label prints
// the name it goes to). Two orders for one name is no answer: the desk asks.
export function ordersNamedIn(store, text) {
  const t = ' ' + String(text ?? '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  return waiting(store).filter((o) => {
    const name = String(o.customer ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (name.length < 3) return false;
    // every place the name occurs, since the first may be inside a longer name (Jada before Ada)
    for (let at = t.indexOf(name); at > 0; at = t.indexOf(name, at + 1)) {
      if (!/[a-z0-9]/.test(t[at - 1]) && !/[a-z0-9]/.test(t[at + name.length] ?? ' ')) return true;
    }
    return false;
  });
}

// What a shipments file would do, before it does it.
function preview(store, result) {
  const seen = new Set();
  const rows = { match: [], known: [], none: [] };
  for (const ln of result.lines) {
    if (V.hasTracking(store, ln.tracking)) { rows.known.push(ln); continue; }
    const o = V.orderForShipment(store, ln);
    if (!o || seen.has(o.id)) { rows.none.push(ln); continue; }
    seen.add(o.id);
    rows.match.push({ ...ln, orderId: o.id, customer: o.customer });
  }
  return rows;
}

export const station = {
  id: 'ship',
  title: 'Ship',
  badge: (store) => waiting(store).length,
  commands: () => [{ label: 'Ship an order', hint: 'Ship', hash: '#ship' }, { label: 'Read a shipments file', hint: 'Ship', hash: '#ship' }],
  // the chips at the foot of the program's left bar (public/bos/index.html, sitesOf)
  web: { presets: CARRIERS, keys: ['carriers'] },
  take(result, name) { pending = { name, result }; },
  // A label read from a web page: { tracking, carrier, cost, amounts, text }. One waiting order
  // named in it, and a cost that is not in question: that order's form is filled and the desk
  // opens at it. Anything less certain waits at the top of Ship for a tap. Says where to go.
  takeLabel(store, lab) {
    const had = lab.tracking ? store.data.orders.orders.find((o) => o.tracking === lab.tracking) : null;
    if (had) return { hash: '#ship/order:' + had.id, say: `That label is already on ${V.orderName(had)}; nothing was changed` };
    const hits = ordersNamedIn(store, lab.text);
    if (hits.length === 1 && (lab.cost !== null || !lab.amounts.length)) {
      fillFrom(hits[0], lab);
      dropped = null;
      return { hash: '#ship/order:' + hits[0].id, say: `Read a label for ${hits[0].customer}${lab.cost !== null ? ': ' + store.usd(lab.cost) : ''}. Check it, then tap Label bought` };
    }
    dropped = { ...lab };
    return { hash: '#ship', say: 'Read a label. Tell the desk which order it is for' };
  },
  render(el, desk) {
    const store = desk.store;
    const esc = store.esc;
    const list = waiting(store);
    const carriers = carriersOf(store);
    const shipped = store.data.orders.orders.filter((o) => o.ship && ['shipped', 'done'].includes(V.statusOf(o)) && (o.tracking || o.carrier))
      .sort((a, b) => String(b.shippedDate ?? b.date).localeCompare(String(a.shippedDate ?? a.date))).slice(0, 12);

    const card = (o) => {
      const f = form.get(o.id) ?? {};
      const lines = (o.lines ?? []).map((ln) => `${esc(ln.qty)} × ${esc(store.resolve('product:' + ln.productId)?.name ?? ln.productId)}`).join(', ');
      return `<div class="card" data-ref="order:${esc(o.id)}" data-order="${esc(o.id)}">
        <div class="line" style="padding:0;border:0">
          <span class="nm"><b>${esc(o.customer || 'A customer')}</b> <span class="badge plain">${esc(V.statusOf(o))}</span><small>${esc(V.orderName(o))} · ${lines}</small></span>
          <span class="amt">${esc(store.usd(V.orderTotal(store, o)))}</span>
        </div>
        ${o.address ? `<pre class="letter" style="margin:8px 0">${esc(o.address)}</pre>
          <button type="button" class="chip sm" data-do="copy" data-text="${esc([o.customer, o.address].filter(Boolean).join('\n'))}">Copy the address</button>`
          : `<p class="truth">⚠ No address on this order. Add it on <a href="#orders/order:${esc(o.id)}">Orders</a> or type it at the carrier.</p>`}
        <label class="lab">Buy the label at</label>
        <div class="chips">${carriers.map((c) => `<a class="chip sm${f.carrier === c.name ? ' on' : ''}" href="${esc(c.url)}" target="_blank" rel="noopener" data-do="carrier" data-name="${esc(c.name)}">${esc(c.name)}</a>`).join('')}</div>
        <div class="row">
          ${cell('What the label cost', `<input class="f" data-f="cost" inputmode="decimal" placeholder="$" value="${esc(f.cost ?? '')}" />`, 'm')}
          ${cell('Tracking number', `<input class="f" data-f="tracking" placeholder="Paste it from the carrier" value="${esc(f.tracking ?? '')}" autocomplete="off" />`)}
        </div>
        ${f.date ? `<p class="note">Bought ${esc(f.date)}, read from the label you dropped: the postage is booked on that day.</p>` : ''}
        <div class="btns">
          <button type="button" class="btn fill" data-do="label">Label bought${f.carrier ? ' at ' + esc(f.carrier) : ''}</button>
          <button type="button" class="btn" data-do="handoff">Handed over, no label</button>
        </div>
      </div>`;
    };

    let dropCard = '';
    if (dropped) {
      const d = dropped;
      const hits = ordersNamedIn(store, d.text);
      dropCard = `<div class="card" data-ref="drop:label">
        <h3 class="sub" style="margin-top:0">A label, read from the web page</h3>
        <p>${esc([d.carrier, d.tracking].filter(Boolean).join(' '))} · ${d.cost !== null ? esc(store.usd(d.cost)) : d.amounts.length ? 'which amount did it cost?' : 'no dollar amount in it'} · ${d.date ? 'bought ' + esc(d.date) : 'no date in it, so it is booked today'}</p>
        ${d.cost === null && d.amounts.length > 1 ? `<div class="chips">${d.amounts.map((a) => `<button type="button" class="chip sm" data-do="drop-cost" data-v="${esc(a)}">${esc(store.usd(a))}</button>`).join('')}</div>` : ''}
        ${list.length ? `<label class="lab">Which order is it for?</label>
          <div class="chips">${list.map((o) => `<button type="button" class="chip sm${hits.includes(o) ? ' on' : ''}" data-do="drop-order" data-v="${esc(o.id)}">${esc(o.customer || 'A customer')} · ${esc(V.orderName(o))}</button>`).join('')}</div>`
          : '<p class="note">No order is waiting to ship.</p>'}
        <div class="btns">
          ${d.cost !== null ? `<button type="button" class="btn" data-do="drop-postage">Book ${esc(store.usd(d.cost))} as postage, with no order</button>` : ''}
          <button type="button" class="btn" data-do="drop-away">Put it away</button>
        </div>
        <p class="truth">⚠ Read from the page’s words, not from the carrier’s records: check the cost and the tracking number on the order before you tap Label bought.</p>
      </div>`;
    }

    let fileCard = '';
    if (pending) {
      const p = preview(store, pending.result);
      fileCard = `<div class="card">
        <h3 class="sub" style="margin-top:0">${esc(pending.name)}</h3>
        <p>${p.match.length} label${p.match.length === 1 ? '' : 's'} match${p.match.length === 1 ? 'es' : ''} an order waiting to ship${p.known.length ? `; ${p.known.length} already on an order` : ''}${p.none.length ? `; ${p.none.length} match nothing` : ''}${pending.result.unreadable.length ? `; ${pending.result.unreadable.length} row${pending.result.unreadable.length === 1 ? '' : 's'} could not be read` : ''}.</p>
        ${p.match.length ? `<table class="tbl">${p.match.map((m) => `<tr><td>${esc(m.customer || m.orderId)}</td><td>${esc(m.carrier || '')} ${esc(m.tracking)}</td><td class="r">${esc(store.usd(m.cost))}</td></tr>`).join('')}</table>
          <button type="button" class="btn fill" data-do="apply-file" style="margin-top:10px">Book these ${p.match.length} label${p.match.length === 1 ? '' : 's'}</button>` : ''}
        ${p.none.length ? `<h3 class="sub">Matched no order</h3><table class="tbl">${p.none.map((m) => `<tr><td>${esc(m.recipient || m.order || '?')}</td><td>${esc(m.tracking)}</td><td class="r">${esc(store.usd(m.cost))}</td></tr>`).join('')}</table>
          <p class="note">A row matches by its order number, or by the one open order whose customer has the recipient’s name. Type these on their orders above if they belong to one.</p>` : ''}
        <p class="truth">⚠ This reader has not yet seen a real export from a label service, so it finds its columns by the usual words (tracking, cost or postage, order, recipient). Check the matches above before booking them.</p>
        <button type="button" class="btn" data-do="drop-file">Put it away</button>
      </div>`;
    }

    el.innerHTML = `
      <h1 class="title">Ship</h1>
      ${dropCard}
      ${fileCard}
      ${list.length ? list.map(card).join('') : '<p class="note">Nothing waiting to ship. An order marked “It ships” on Orders shows up here.</p>'}
      <div class="drop" id="sh-drop">Drop a label service’s shipments file here (CSV), or <label class="chip sm" style="display:inline-flex">pick one<input type="file" accept=".csv,text/csv" id="sh-file" hidden /></label></div>
      ${shipped.length ? `<h2 class="sect">Shipped lately</h2><div class="list">${shipped.map((o) => `
        <div class="line" data-ref="order:${esc(o.id)}"><span class="nm">${esc(o.customer || 'A customer')}<small>${esc(o.carrier ?? '')}${o.shippedDate ? ' · ' + esc(o.shippedDate) : ''} · ${store.chip('order:' + o.id, V.orderName(o))}</small></span>
          <span class="amt">${o.tracking ? `<button type="button" class="chip sm" data-do="copy" data-text="${esc(o.tracking)}">${esc(o.tracking)}</button>` : ''}</span></div>`).join('')}</div>` : ''}
      ${desk.program ? '' /* the program has them at the foot of its left bar */ : `<h2 class="sect">Carriers</h2>
      <div class="chips">${carriers.map((c) => outLink(c.url, c.name, esc)).join('')}
        <button type="button" class="chip" data-do="add-carrier">+ Custom</button></div>
      ${addingCarrier ? `<div class="row">
          <input class="f" id="ca-name" placeholder="Name (a courier, a freight line)" autocomplete="off" />
          <input class="f" id="ca-url" inputmode="url" placeholder="https://…" />
          <button type="button" class="btn inline" data-do="save-carrier">Add</button>
        </div>` : ''}`}`;

    const orderOf = (node) => node.closest('[data-order]')?.dataset.order;
    el.oninput = (e) => {
      const id = orderOf(e.target);
      const k = e.target.dataset?.f;
      if (!id || !k) return;
      form.set(id, { ...(form.get(id) ?? {}), [k]: e.target.value });
    };
    el.onchange = async (e) => {
      if (e.target.id !== 'sh-file' || !e.target.files?.[0]) return;
      await desk.takeFile(e.target.files[0]);
    };
    el.onclick = async (e) => {
      const b = e.target.closest('[data-do]');
      if (!b) return;
      const id = orderOf(b);
      switch (b.dataset.do) {
        case 'carrier':
          // the link still opens the carrier's page; this only remembers which one it was
          form.set(id, { ...(form.get(id) ?? {}), carrier: b.dataset.name });
          setTimeout(() => desk.rerender(), 0);
          return;
        case 'label': {
          const f = form.get(id) ?? {};
          if (!String(f.cost ?? '').trim() && !String(f.tracking ?? '').trim()) { desk.toast('Type what the label cost, or its tracking number', { error: true }); return; }
          const r = desk.act(() => V.labelBought(store, id, { cost: f.cost, carrier: f.carrier ?? '', tracking: f.tracking ?? '' }, f.date ? { now: f.date + 'T12:00:00' } : {}),
            { next: { label: 'Tell them', hash: '#mail/order:' + id } });
          if (r) form.delete(id);
          return;
        }
        case 'handoff': {
          const r = desk.act(() => V.transition(store, id, 'shipped', { carrier: 'Hand off' }), { next: { label: 'Tell them', hash: '#mail/order:' + id } });
          if (r) form.delete(id);
          return;
        }
        case 'copy': desk.toast((await copyText(b.dataset.text)) ? 'Copied' : 'Could not copy; select it and copy by hand'); return;
        case 'apply-file': {
          const p = preview(store, pending.result);
          const r = desk.act(() => V.applyShipments(store, p.match.map((m) => ({ ...m }))), { next: { label: 'See Books', hash: '#books' } });
          if (r) { pending = null; desk.rerender(); }
          return;
        }
        case 'drop-file': pending = null; desk.rerender(); return;
        case 'drop-cost': dropped.cost = Number(b.dataset.v); desk.rerender(); return;
        case 'drop-order': {
          const o = store.resolve('order:' + b.dataset.v);
          if (!o) return;
          fillFrom(o, dropped);
          dropped = null;
          desk.go('#ship/order:' + o.id);
          return;
        }
        case 'drop-postage': {
          const d = dropped;
          const r = desk.act(() => V.addExpense(store, { what: `Postage${d.carrier ? ' (' + d.carrier + ')' : ''}${d.tracking ? ' ' + d.tracking : ''}`, amount: d.cost, category: 'shipping', date: d.date || undefined }),
            { next: { label: 'See Books', hash: '#books' } });
          if (r) { dropped = null; desk.rerender(); }
          return;
        }
        case 'drop-away': dropped = null; desk.rerender(); return;
        case 'add-carrier': addingCarrier = !addingCarrier; desk.rerender(); return;
        case 'save-carrier': {
          const name = el.querySelector('#ca-name').value.trim();
          const url = el.querySelector('#ca-url').value.trim();
          if (!name) { desk.toast('Name the carrier', { error: true }); return; }
          if (!/^https:\/\//i.test(url)) { desk.toast('A carrier’s link starts with https://', { error: true }); return; }
          const r = desk.act(() => ({ act: store.conf({ carriers: [...(store.settings.carriers ?? []), { name, url }] }, 'added the carrier ' + name) }));
          if (r) { addingCarrier = false; desk.rerender(); }
        }
      }
    };
  },
};
