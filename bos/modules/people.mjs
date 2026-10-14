// PEOPLE — beside the line: the customers you sell to, the crew who work for you, and anyone else
// the business deals with. Hours are logged here and paid here; a pay run books the wages in Books
// and names the hours it covered, so the same hour is never paid twice. The kinds of worker live
// here too (Matt, 2026-10-04 18:42Z: "the labor will go to a labor page"): a kind is a rate an hour,
// a product on Inventory names hours of it per batch, and Make books hours × rate in Books as owed
// until a pay here draws it down (verbs.payRun pays the owed pool before it books fresh wages).
import * as V from './verbs.mjs';
import { todayIso, cell } from './ui.mjs';

let openPerson = null;
let role = 'Customer';
const ownMoney = new Set();

const isCrew = (store, p) => p.role === 'Crew' || p.arrangement || store.data.crew.timesheets.some((t) => t.personId === p.id);
const ordersOf = (store, p) => store.data.orders.orders.filter((o) => o.customerId === p.id
  || (!o.customerId && o.customer && String(o.customer).trim().toLowerCase() === String(p.name).toLowerCase()));
function owed(store, p) {
  const paid = new Set(store.data.crew.payruns.flatMap((r) => r.timesheetIds ?? []));
  const open = store.data.crew.timesheets.filter((t) => t.personId === p.id && !paid.has(t.id));
  const hours = V.round2(open.reduce((s, t) => s + (Number(t.hours) || 0), 0));
  const rate = p.arrangement?.kind === 'hourly' ? Number(p.arrangement.rate) || 0 : 0;
  return { hours, rate, amount: V.round2(hours * rate), open };
}

export const station = {
  id: 'people',
  title: 'Labor',
  badge: (store) => store.data.crew.people.filter((p) => isCrew(store, p) && owed(store, p).hours > 0).length,
  commands: () => [{ label: 'Log hours', hint: 'Labor', hash: '#people' }, { label: 'Pay someone', hint: 'Labor', hash: '#people' }, { label: 'Add a customer', hint: 'Labor', hash: '#people' }],
  render(el, desk) {
    const store = desk.store;
    const esc = store.esc;
    if (desk.fresh && store.route.ref?.startsWith('person:')) openPerson = store.route.ref.slice(7);
    const people = store.data.crew.people.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const crew = people.filter((p) => isCrew(store, p));
    const customers = people.filter((p) => !isCrew(store, p) && (p.role === 'Customer' || ordersOf(store, p).length));
    const others = people.filter((p) => !crew.includes(p) && !customers.includes(p));

    const contact = (p) => [
      p.email ? `<a class="chip sm" href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '',
      p.phone ? `<a class="chip sm" href="tel:${esc(String(p.phone).replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a>` : '',
    ].join('');

    const classes = Array.isArray(store.settings.laborClasses) ? store.settings.laborClasses : [];
    const pool = V.laborOwed(store);
    const classUsers = (c) => store.data.recipes.recipes.filter((r) => (r.labor ?? []).some((l) => l.classId === c.id));
    const crewDetail = (p) => {
      const o = owed(store, p);
      const runs = store.data.crew.payruns.filter((r) => r.personId === p.id).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);
      return `<div class="open">
        <div class="chips">${contact(p)}</div>
        <div class="row">
          ${cell('Hours', '<input class="f" data-f="hours" inputmode="decimal" />', 's')}
          ${cell('Day', `<input class="f" data-f="date" type="date" value="${esc(todayIso())}" />`, 'm')}
          ${cell('What they did', '<input class="f" data-f="what" placeholder="Optional" />')}
          <button type="button" class="btn inline" data-do="hours" data-person="${esc(p.id)}">Log it</button>
        </div>
        <p class="note">${o.hours ? `${esc(o.hours)} hour${o.hours === 1 ? '' : 's'} not paid yet${o.rate ? ` at ${esc(store.usd(o.rate))} an hour: ${esc(store.usd(o.amount))}` : ''}.` : 'Every logged hour is paid.'}${pool > 0 ? ` Batches on Inventory have booked ${esc(store.usd(pool))} of labor not paid to anyone yet; a pay here draws that down first.` : ''}</p>
        <div class="row">
          ${cell('What you paid them', `<input class="f" data-f="pay" inputmode="decimal" placeholder="${o.amount ? esc(store.usd(o.amount)) + ' owed, or type another amount' : pool > 0 ? esc(store.usd(pool)) + ' owed by batches, or type another amount' : '$'}" />`)}
          <button type="button" class="btn inline fill" data-do="pay" data-person="${esc(p.id)}">Pay</button>
        </div>
        <div class="chips"><button type="button" class="chip sm${ownMoney.has(p.id) ? '' : ' on'}" data-do="own" data-v="0" data-person="${esc(p.id)}">Business money</button>
          <button type="button" class="chip sm${ownMoney.has(p.id) ? ' on' : ''}" data-do="own" data-v="1" data-person="${esc(p.id)}">My own money</button></div>
        <p class="truth">This books what you paid as wages. Payroll taxes and withholding are not worked out here; if you have employees rather than helpers paid by the job, ask whoever does your taxes what you owe on top.</p>
        ${runs.length ? `<p class="note">Paid before: ${runs.map((r) => store.ledgerFor('payrun:' + r.id).map((e) => store.chip('ledger:' + e.id)).join(' ')).join(' ')}</p>` : ''}
      </div>`;
    };
    const customerDetail = (p) => {
      const os = ordersOf(store, p).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return `<div class="open">
        <div class="chips">${contact(p)}</div>
        ${p.address ? `<pre class="letter">${esc(p.address)}</pre>` : ''}
        ${os.length ? `<p class="note">Orders: ${os.slice(0, 8).map((o) => store.chip('order:' + o.id, `${V.orderName(o)} · ${V.statusOf(o)}`)).join(' ')}</p>` : ''}
        <div class="btns">
          <a class="btn" href="#orders/person:${esc(p.id)}">New order for ${esc(p.name)}</a>
          <a class="btn" href="#mail/person:${esc(p.id)}">Write to them</a>
        </div>
      </div>`;
    };
    const line = (p, kind) => {
      const isOpen = openPerson === p.id;
      let sub = '';
      let amt = '';
      if (kind === 'crew') {
        const o = owed(store, p);
        sub = o.rate ? store.usd(o.rate) + ' an hour' : 'no rate set';
        amt = o.hours ? `${o.hours} h${o.amount ? `<small>${store.usd(o.amount)} owed</small>` : ''}` : '<small>paid up</small>';
      } else if (kind === 'customer') {
        const os = ordersOf(store, p);
        const spent = os.filter((o) => ['paid', 'shipped', 'done'].includes(V.statusOf(o))).reduce((s, o) => s + V.orderTotal(store, o), 0);
        sub = `${os.length} order${os.length === 1 ? '' : 's'}${os.length ? ' · last ' + (os.map((o) => o.date).sort().at(-1) ?? '') : ''}`;
        amt = spent ? store.usd(spent) + '<small>spent</small>' : '';
      } else sub = p.role || '';
      return `<button type="button" class="line" data-do="open" data-person="${esc(p.id)}" data-ref="person:${esc(p.id)}" aria-expanded="${isOpen}">
          <span class="nm">${esc(p.name)}<small>${esc(sub)}</small></span><span class="amt">${amt}</span>
        </button>${isOpen ? (kind === 'crew' ? crewDetail(p) : customerDetail(p)) : ''}`;
    };

    el.innerHTML = `
      <h1 class="title">Labor</h1>
      ${crew.length ? `<h2 class="sect">Crew</h2><div class="list">${crew.map((p) => line(p, 'crew')).join('')}</div>` : ''}
      <h2 class="sect">Customers</h2>
      ${customers.length ? `<div class="list">${customers.map((p) => line(p, 'customer')).join('')}</div>` : '<p class="note">A customer is added for you the first time you take their order. Add one by hand below.</p>'}
      ${others.length ? `<h2 class="sect">Others</h2><div class="list">${others.map((p) => line(p, 'other')).join('')}</div>` : ''}
      <h2 class="sect">Kinds of worker</h2>
      <p class="note">A kind of worker is a rate: what an hour of a helper, a skilled hand or your own time costs. A product on Inventory names hours of a kind for each batch, and Make books hours × rate in Books as labor owed until a pay here covers it.</p>
      ${pool > 0 ? `<p class="truth">⚠ Batches have booked ${esc(store.usd(pool))} of labor not paid to anyone yet. The next pay here draws that down first.</p>` : ''}
      ${classes.length ? `<div class="list">${classes.map((c) => {
        const used = classUsers(c);
        return `<div class="line" style="display:block">
          <div style="display:flex;gap:10px;align-items:center"><span class="nm">${esc(c.name)}<small>${used.length ? 'on ' + used.map((r) => store.chip('recipe:' + r.id, r.name)).join(' ') : 'on no product yet'}</small></span><span class="amt">${esc(store.usd(Number(c.rate) || 0))}<small>an hour</small></span></div>
          <div class="row">
            ${cell('A new rate an hour', `<input class="f" data-f="rate" inputmode="decimal" placeholder="${esc(store.usd(Number(c.rate) || 0))} now" />`, 's')}
            <button type="button" class="btn inline" data-do="set-rate" data-class="${esc(c.id)}">Change the rate</button>
            ${used.length ? '' : `<button type="button" class="btn inline" data-do="drop-class" data-class="${esc(c.id)}">Remove</button>`}
          </div>
        </div>`;
      }).join('')}</div>` : '<p class="note">None yet. Name one here, or name it on a product on Inventory and it lands here.</p>'}
      <div class="row">
        ${cell('Kind of worker', '<input class="f" id="lc-name" placeholder="Helper, skilled, me" autocomplete="off" />')}
        ${cell('An hour costs', '<input class="f" id="lc-rate" inputmode="decimal" placeholder="$" />', 's')}
        <button type="button" class="btn inline" data-do="add-class">Add</button>
      </div>
      <p class="note">A rate changed here prices the next batch; batches already made keep the rate they were made at.</p>
      <h2 class="sect">Add someone</h2>
      <div class="chips">${['Customer', 'Crew', 'Other'].map((r) => `<button type="button" class="chip${role === r ? ' on' : ''}" data-do="role" data-v="${r}" aria-pressed="${role === r}">${r}</button>`).join('')}</div>
      ${cell('Name', '<input class="f" id="pp-name" autocomplete="off" />')}
      <div class="row">
        ${cell('Email', '<input class="f" id="pp-email" type="email" placeholder="Optional" />')}
        ${cell('Phone', '<input class="f" id="pp-phone" type="tel" placeholder="Optional" />')}
        ${role === 'Crew' ? cell('Pay an hour', '<input class="f" id="pp-rate" inputmode="decimal" placeholder="$" />', 's') : ''}
      </div>
      ${role === 'Customer' ? cell('Address', '<textarea class="f" id="pp-address" placeholder="Optional" style="min-height:70px"></textarea>') : ''}
      <button type="button" class="btn" data-do="add" style="margin-top:8px">Add ${esc(role === 'Other' ? 'them' : 'the ' + role.toLowerCase())}</button>
      ${store.data.sourcing.vendors.length ? `<p class="note" style="margin-top:18px">The places you buy from live on Inventory: ${store.data.sourcing.vendors.map((v) => store.chip('vendor:' + v.id, v.name)).join(' ')}</p>` : ''}`;

    el.onclick = (e) => {
      const b = e.target.closest('[data-do]');
      if (!b) return;
      const id = b.dataset.person;
      const box = b.closest('.open');
      const f = (k) => box?.querySelector(`[data-f="${k}"]`)?.value ?? '';
      switch (b.dataset.do) {
        case 'open': openPerson = openPerson === id ? null : id; desk.rerender(); return;
        case 'role': role = b.dataset.v; desk.rerender(); return;
        case 'own': if (b.dataset.v === '1') ownMoney.add(id); else ownMoney.delete(id); desk.rerender(); return;
        case 'hours': desk.act(() => V.logHours(store, { personId: id, hours: f('hours'), date: f('date'), what: f('what').trim() })); return;
        case 'pay': {
          const amt = f('pay').trim();
          desk.act(() => V.payRun(store, { personId: id, amount: amt === '' ? undefined : amt, personal: ownMoney.has(id) }), { next: { label: 'See Books', hash: '#books' } });
          return;
        }
        case 'add-class': desk.act(() => V.addLaborClass(store, { name: el.querySelector('#lc-name').value, rate: el.querySelector('#lc-rate').value })); return;
        case 'set-rate': desk.act(() => V.setLaborRate(store, b.dataset.class, b.closest('.row')?.querySelector('[data-f="rate"]')?.value)); return;
        case 'drop-class': desk.act(() => V.dropLaborClass(store, b.dataset.class)); return;
        case 'add': {
          const v = (s) => el.querySelector(s)?.value?.trim() ?? '';
          const r = desk.act(() => V.addPerson(store, { name: v('#pp-name'), role, email: v('#pp-email'), phone: v('#pp-phone'), address: v('#pp-address'), rate: v('#pp-rate') }));
          if (r) { openPerson = r.id; desk.rerender(); }
        }
      }
    };
  },
};
