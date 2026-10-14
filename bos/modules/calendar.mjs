// CALENDAR — beside the line: what is late and what is next. The helpers below (the yearly
// projection and the agenda) are pure and Node-importable; the station at the foot draws them.
//
// An event carries a date, a title, a kind and refs[]; it has no amounts and no copies of
// anything. A repeat:'yearly' event is projected forward when drawn, never stored twice, so a
// yearly filing marked done comes back next year by arithmetic.

import * as V from './verbs.mjs';
import { cell } from './ui.mjs';
import { deadlines, needsFormedMonth, stateChoices, entityWord, ENTITIES } from './compliance.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// parse the ISO date string by hand — new Date('YYYY-MM-DD') is UTC and can
// shift a day under a local timezone, which is exactly the wrong bug for a calendar.
function dayLabel(iso, withYear = false) {
  const [y, m, d] = String(iso ?? '').split('-');
  const month = MONTHS[+m - 1];
  if (!month) return String(iso ?? '');
  return `${month.slice(0, 3)} ${+d}` + (withYear ? ` ${y}` : '');
}

// today as a LOCAL ISO date — toISOString() can already be tomorrow.
export function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// whole-day difference between two ISO dates; UTC on both sides so no TZ drift.
export function daysBetween(fromIso, toIso) {
  const [fy, fm, fd] = String(fromIso).split('-').map(Number);
  const [ty, tm, td] = String(toIso).split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

function addYears(iso, n) {
  const [y, m, d] = String(iso).split('-');
  return `${Number(y) + n}-${m}-${d}`;
}

// a hand-edited row with a missing or malformed date must never take the page
// down — it gets skipped here and reported as a visible gate line instead.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function hasValidDate(ev) {
  return typeof ev.date === 'string' && ISO_DATE.test(ev.date);
}

// --- the projection (pure, exported for tests) --------------------------------
// Future occurrences of repeat:'yearly' events, from the year after the stored
// date up to the horizon. Rendered as views ({projected:true, done:false});
// NEVER stored. A yearly event marked done therefore resurfaces next year.
export function projectYearly(events, horizonIso) {
  const out = [];
  for (const ev of events) {
    if (ev.repeat !== 'yearly' || !hasValidDate(ev)) continue;
    for (let k = 1; k <= 5; k++) {
      const date = addYears(ev.date, k);
      if (date > horizonIso) break;
      out.push({ ...ev, date, done: false, projected: true });
    }
  }
  return out;
}

// --- the agenda (pure, exported for tests) ------------------------------------
// { overdue, soon, later, earlier, next } over real events + projections.
//   overdue — not done, date < today (real rows only; a projection cannot be late)
//   soon    — today .. today+90
//   later   — beyond 90 days (yearly projections included up to today+1y)
//   earlier — the past that needs nothing (done, or historical)
//   next    — the next undone compliance event, overdue first: THE deadline.
export function agendaOf(store, today = todayIso()) {
  const events = ((store.data?.calendar ?? {}).events ?? []).filter(hasValidDate);
  const horizon = addYears(today, 1);
  const all = [...events, ...projectYearly(events, horizon)]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.id) < String(b.id) ? -1 : 1));

  const overdue = [], soon = [], later = [], earlier = [];
  for (const ev of all) {
    if (ev.date < today) {
      (ev.done !== true && !ev.projected ? overdue : earlier).push(ev);
    } else if (daysBetween(today, ev.date) <= 90) {
      soon.push(ev);
    } else {
      later.push(ev);
    }
  }
  const next = [...overdue, ...soon, ...later]
    .find((ev) => ev.kind === 'compliance' && ev.done !== true) ?? null;
  return { overdue, soon, later, earlier, next, today };
}

// --- the station ----------------------------------------------------------------------
// One agenda for everything with a day on it: the dates on file (filings, renewals, markets),
// jobs and orders promised for a day, and batches planned on Inventory. Each item links to where it
// is done. Red marks one thing only: a filing or renewal that is late, because that can cost
// money; anything else late is marked in gold.

let showLater = false;
let showEarlier = false;
let kind = 'ops';
let yearly = false;
let monthCursor = '';
let openDay = '';
const WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const KIND_WORD = { ops: 'Task', money: 'Money', compliance: 'Filing', post: 'Post' };

function items(store, today) {
  const a = agendaOf(store, today);
  const out = [];
  const push = (it) => out.push(it);
  for (const ev of [...a.overdue, ...a.soon, ...a.later]) {
    push({ date: ev.date, title: ev.title, kind: ev.kind, ev, late: ev.date < today && ev.done !== true && !ev.projected });
  }
  for (const o of store.data.orders.orders) {
    const st = V.statusOf(o);
    if (!o.due || !['new', 'paid', 'shipped'].includes(st)) continue;
    push({ date: o.due, title: `${o.customer || 'An order'}: ${(o.lines ?? []).map((ln) => store.resolve('product:' + ln.productId)?.name ?? ln.productId).join(', ')}`, kind: 'order', order: o, late: o.due < today });
  }
  for (const r of store.data.reservations.reservations) {
    if (r.status !== 'planned' || !ISO_DATE.test(String(r.date))) continue;
    const rec = store.resolve('recipe:' + r.recipeId);
    push({ date: r.date, title: `Make ${rec?.name ?? r.recipeId}${Number(r.batches) > 1 ? ' ×' + r.batches : ''}`, kind: 'make', rsv: r, late: r.date < today });
  }
  out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  return { all: out, earlier: a.earlier };
}

export const station = {
  id: 'calendar',
  title: 'Calendar',
  badge: (store) => items(store, todayIso()).all.filter((i) => i.late).length,
  commands: () => [{ label: 'Add a date', hint: 'Calendar', hash: '#calendar' }],
  render(el, desk) {
    const store = desk.store;
    const esc = store.esc;
    const today = todayIso();
    const { all, earlier } = items(store, today);
    const late = all.filter((i) => i.late);
    const soon = all.filter((i) => !i.late && daysBetween(today, i.date) <= 90);
    const later = all.filter((i) => !i.late && daysBetween(today, i.date) > 90);
    // a link to one date opens the fold that holds it
    const linked = desk.fresh && String(store.route.ref ?? '').startsWith('event:') ? store.route.ref.slice(6) : null;
    if (linked && later.some((i) => i.ev?.id === linked && !i.ev.projected)) showLater = true;
    if (linked && earlier.some((ev) => ev.id === linked)) showEarlier = true;

    const row = (i) => {
      const thisYear = i.date.slice(0, 4) === today.slice(0, 4);
      const lateBadge = i.late ? ` <span class="badge ${i.kind === 'compliance' ? 'red' : 'gold'}">late ${daysBetween(i.date, today)} day${daysBetween(i.date, today) === 1 ? '' : 's'}</span>` : '';
      let act = '';
      let ref = '';
      if (i.ev && !i.ev.projected) {
        ref = 'event:' + i.ev.id;
        act = `<button type="button" class="btn inline" data-do="done" data-ev="${esc(i.ev.id)}" data-v="${i.ev.done ? '0' : '1'}">${i.ev.done ? 'Reopen' : 'Done'}</button>`;
      } else if (i.order) {
        ref = 'order:' + i.order.id;
        act = `<a class="btn inline" href="#orders/order:${esc(i.order.id)}">Open</a>`;
      } else if (i.rsv) {
        ref = 'reservation:' + i.rsv.id;
        act = `<a class="btn inline" href="#inventory/recipe:${esc(i.rsv.recipeId)}">Make</a>`;
      }
      const tag = i.ev ? (KIND_WORD[i.ev.kind] ?? i.ev.kind) : i.kind === 'order' ? 'Order' : 'Make';
      return `<div class="line"${ref ? ` data-ref="${esc(ref)}"` : ''}><span class="nm">${esc(i.title)}${lateBadge}${i.ev?.done ? ' <span class="badge plain">done</span>' : ''}<small>${esc(dayLabel(i.date, !thisYear))} · ${esc(tag)}${i.ev?.repeat === 'yearly' ? ' · every year' : ''}${i.ev?.projected ? ' (next time round)' : ''} ${(i.ev?.refs ?? []).map((r) => store.chip(r)).join(' ')}</small></span>${act}</div>`;
    };

    const orders = store.data.orders?.orders ?? [];
    const st = (o) => V.statusOf(o);
    const openN = orders.filter((o) => st(o) === 'new' || st(o) === 'paid').length;
    const soldN = orders.filter((o) => ['paid', 'shipped', 'done'].includes(st(o))).reduce((n, o) => n + (o.lines ?? []).reduce((m, ln) => m + (Number(ln.qty) || 0), 0), 0);
    const shelf = (store.data.products?.products ?? []).map((p) => {
      const units = Number(p.units) || 1;
      const have = p.itemId ? store.stockOf(p.itemId) : 0;
      return `(${Math.max(0, Math.floor((have + 1e-9) / units))}) ${p.name}`;
    });
    const named = new Map((store.data.inventory?.items ?? []).map((i) => [i.id, i]));
    const short = [];
    for (const r of store.data.recipes?.recipes ?? []) {
      for (const ln of r.lines ?? []) {
        const have = store.stockOf(ln.itemId);
        const item = named.get(ln.itemId);
        const floor = Number(item?.reorderAt);
        const mark = Number.isFinite(floor) && floor > 0 ? floor : (Number(ln.qty) || 0);
        if (have + 1e-9 < mark) short.push(`${item?.name || ln.itemId}: ${Math.round(have)} ${ln.unit || item?.unit || ''}, one batch asks ${Math.round(mark)}`);
      }
    }
    const ym = /^\d{4}-\d{2}$/.test(monthCursor) ? monthCursor : today.slice(0, 7);
    const [yy, mm] = ym.split('-').map(Number);
    const filings = [yy - 1, yy, yy + 1].flatMap((y) => deadlines(store.settings, y));
    const seen = new Set();
    const days = new Map();
    const put = (date, item) => {
      const key = date + '|' + item.title;
      if (seen.has(key)) return;
      seen.add(key);
      if (!days.has(date)) days.set(date, []);
      days.get(date).push(item);
    };
    for (const i of all) put(i.date, i);
    for (const f of filings) put(f.date, { date: f.date, title: f.title, kind: 'compliance', filing: true, note: f.note, url: f.url, late: f.date < today });
    const lateFilings = [...days.values()].flat().filter((i) => i.filing && i.date < today && daysBetween(i.date, today) < 400);
    const firstDow = new Date(yy, mm - 1, 1).getDay();
    const dim = new Date(yy, mm, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) cells.push(d);
    while (cells.length % 7) cells.push(null);
    const monthName = MONTHS[mm - 1] + ' ' + yy;
    const cellHtml = cells.map((d) => {
      if (!d) return '<div class="cal-day blank"></div>';
      const date = `${yy}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const list = days.get(date) ?? [];
      const filing = list.some((i) => i.filing);
      const late = list.some((i) => i.late);
      const cls = ['cal-day', date === today ? 'today' : '', date === openDay ? 'open' : '', filing ? 'filing' : '', list.length && !filing ? 'marked' : '', late ? 'late' : ''].filter(Boolean).join(' ');
      const labels = list.slice(0, 2).map((i) => `<span>${esc(i.title)}</span>`).join('');
      return `<button type="button" class="${cls}" data-do="day" data-v="${date}"><b>${d}</b>${labels}${list.length > 2 ? `<small>+${list.length - 2}</small>` : ''}</button>`;
    }).join('');
    const openList = (days.get(openDay) ?? []).slice().sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')));
    const overlay = openDay ? `<div class="card cal-overlay">
      <div class="btns"><h3 class="sub" style="margin:0;flex:1">${esc(dayLabel(openDay, true))}</h3><button type="button" class="btn" data-do="day-close">Close</button></div>
      ${openList.length ? openList.map((i) => `<div class="line"><span class="nm">${i.time ? esc(i.time) : 'All day'} · ${esc(i.title)}<small>${esc(i.note || (i.filing ? 'A date the state requires' : (KIND_WORD[i.kind] || i.kind || '')))}${i.url ? ` · <a href="${esc(i.url)}" target="_blank" rel="noopener">Open the filing page</a>` : ''}</small></span></div>`).join('') : '<p class="note">Nothing on this day. What you add with no time stays all day.</p>'}
      <div class="row">
        ${cell('Add', `<input class="f" id="cl-title" placeholder="A market, a call, do the taxes" autocomplete="off" />`)}
        ${cell('Time', '<input class="f" id="cl-time" type="time" />', 's')}
      </div>
      <button type="button" class="btn" data-do="add-day">Add it</button>
    </div>` : '';
    const who = entityWord(store.settings.entity);
    const where = stateChoices().find((s) => s.code === store.settings.state)?.name || '';
    const identity = `<div class="row">
      ${cell('State', `<select class="f" id="cal-state"><option value="">Pick a state</option>${stateChoices().map((s) => `<option value="${s.code}"${s.code === store.settings.state ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`)}
      ${cell('Kind', `<select class="f" id="cal-entity"><option value="">Kind of company</option>${ENTITIES.map(([k, w]) => `<option value="${k}"${k === store.settings.entity ? ' selected' : ''}>${esc(w)}</option>`).join('')}</select>`, 'm')}
      ${cell('Formed', `<select class="f" id="cal-formed"><option value="">Month</option>${MONTHS.map((name, i) => { const v = String(i + 1).padStart(2, '0'); return `<option value="${v}"${store.settings.formed === v ? ' selected' : ''}>${name.slice(0, 3)}</option>`; }).join('')}</select>`, 's')}
    </div>
    <label class="chip" style="cursor:pointer"><input type="checkbox" id="cal-exempt" ${store.settings.taxExempt ? 'checked' : ''} /> Tax exempt</label>
    <p class="note">${where && who ? `${esc(where)} ${esc(who)}. ` : 'Pick the state and the kind of company and the required dates fill in. '}${needsFormedMonth(store.settings) ? 'This state’s renewal follows the month you formed. Set that month. ' : ''}${store.settings.taxExempt ? 'State tax days are off. The renewal stays. ' : ''}A weekend deadline moves to Monday. Confirm it on the state’s site before you file.</p>`;

    const report = `
      <h2 class="sect">Today</h2>
      <div class="list">
        <div class="line"><span class="nm">Orders open<small>New or paid. An order is an alert, not a letter to read.</small></span><span class="amt">${openN}</span></div>
        <div class="line"><span class="nm">Sold<small>Paid, shipped, or done.</small></span><span class="amt">${soldN}</span></div>
        <div class="line"><span class="nm">On the shelf<small>${esc(shelf.join(' · ') || 'No products')}</small></span></div>
        <div class="line"><span class="nm">Materials short<small>${esc(short.slice(0, 6).join(' · ') || 'Nothing under its line.')}${short.length > 6 ? ` · ${short.length - 6} more` : ''}</small></span></div>
        <div class="line"><span class="nm">Mail<small>Filed by the address it was sent to. Nothing in a bin is waiting to be read.</small></span></div>
      </div>
      <p class="note">Counted from the books. Nothing was asked to interpret it.</p>`;

    el.innerHTML = `
      <h1 class="title">Calendar</h1>
      ${identity}
      ${lateFilings.length ? `<div class="list">${lateFilings.map((i) => `<div class="line"><span class="nm">${esc(i.title)} <span class="badge red">late</span><small>${esc(dayLabel(i.date, true))}. ${esc(i.note || '')}</small></span></div>`).join('')}</div>` : ''}
      <div class="cal-head">
        <button type="button" class="btn" data-do="month" data-v="-1" aria-label="Previous month">‹</button>
        <h2 class="sect" style="margin:0">${esc(monthName)}</h2>
        <button type="button" class="btn" data-do="month" data-v="1" aria-label="Next month">›</button>
      </div>
      <div class="cal-week">${WEEK.map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${cellHtml}</div>
      ${overlay}
      ${report}
      <p class="note">Google Calendar stays a chip on the left, if you want that one open beside this. This month is the desk.</p>`;

    el.onchange = (e) => {
      const t = e.target;
      if (!['cal-state', 'cal-entity', 'cal-formed', 'cal-exempt'].includes(t.id)) return;
      const state = el.querySelector('#cal-state').value;
      const entity = el.querySelector('#cal-entity').value;
      const formed = el.querySelector('#cal-formed').value;
      const taxExempt = el.querySelector('#cal-exempt').checked;
      desk.act(() => ({ act: store.conf({ state, entity, formed, taxExempt }, 'where the company stands') }));
    };
    el.onclick = (e) => {
      const b = e.target.closest('[data-do]');
      if (!b) return;
      switch (b.dataset.do) {
        case 'month': {
          const dir = Number(b.dataset.v) || 0;
          const [y, m] = ym.split('-').map(Number);
          const dt = new Date(y, m - 1 + dir, 1);
          monthCursor = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
          openDay = '';
          desk.rerender();
          return;
        }
        case 'day': openDay = openDay === b.dataset.v ? '' : b.dataset.v; desk.rerender(); return;
        case 'day-close': openDay = ''; desk.rerender(); return;
        case 'add-day': {
          const r = desk.act(() => V.addEvent(store, { title: el.querySelector('#cl-title').value, date: openDay, time: el.querySelector('#cl-time').value, kind: 'ops' }));
          if (r) desk.rerender();
          return;
        }
        case 'kind': kind = b.dataset.v; desk.rerender(); return;
        case 'yearly': yearly = !yearly; desk.rerender(); return;
        case 'done': desk.act(() => V.markDone(store, b.dataset.ev, b.dataset.v === '1')); return;
        default: return;
      }
    };
  },
};
