// slide-over — the card a record chip opens, from any station. It shows the record's own fields,
// everything that points at it (the buy behind a stock move, the entries an order wrote), and the
// notes written on it, then one button to the station where the record is worked.
//
// Notes live ON the record (rec.notes, appended through store.write), so they are saved with the
// books, travel in a backup and come back with Undo like any other change. Notes written before
// 2026-10-04 lived in this browser only (localStorage 'os.chatter'); they are shown read-only,
// marked as such, and never deleted.
//
// slideOverHTML() is pure string-building (Node-importable); only openSlideOver/closeSlideOver touch
// the document.

const WORD = {
  ledger: 'Entry', item: 'Material', move: 'Stock move', vendor: 'Source', po: 'Purchase', person: 'Person',
  timesheet: 'Hours', payrun: 'Pay', event: 'Date', recipe: 'Recipe', batch: 'Batch', reservation: 'Planned batch',
  order: 'Order', product: 'Product', jar: 'Jar', rule: 'Filing rule',
};
const STATION_TITLE = { inventory: 'Inventory', shelf: 'Shelf', orders: 'Orders', books: 'Books', people: 'Labor', calendar: 'Calendar' };
// display-only: which numeric fields read as dollars
const MONEYISH = /^(amount|price|cost|total|fee|paid|rate|target|unitcost|landedtotal|landedperunit|perbatch|perunit)$/i;
const SKIP = new Set(['notes']);

const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\//.test(v);
const words = (k) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();

function looksLikeRef(store, v) {
  if (typeof v !== 'string' || !/^[a-z][\w-]*:.+/i.test(v) || isHttpUrl(v)) return false;
  return !!store.resolve(v) || !!store.moduleFor(String(v).split(':')[0]);
}

function compact(store, o) {
  const esc = store.esc;
  const parts = [];
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith('_') || v === null || v === undefined || v === '' || typeof v === 'object') continue;
    if (typeof v === 'number' && MONEYISH.test(k)) parts.push(`${esc(words(k))} ${store.usd(v)}`);
    else if (looksLikeRef(store, v)) parts.push(store.chip(v));
    else if (isHttpUrl(v)) parts.push(`<a class="chip sm" href="${esc(v)}" target="_blank" rel="noopener">link</a>`);
    else parts.push(esc(String(v).length > 48 ? String(v).slice(0, 48) + '…' : String(v)));
  }
  return parts.join(' · ') || '—';
}

function value(store, key, v) {
  const esc = store.esc;
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return MONEYISH.test(key) ? store.usd(v) : esc(String(v));
  if (isHttpUrl(v)) return `<a class="chip sm" href="${esc(v)}" target="_blank" rel="noopener">open the link</a>`;
  if (looksLikeRef(store, v)) return store.chip(v);
  if (Array.isArray(v)) {
    if (!v.length) return '—';
    if (v.every((x) => looksLikeRef(store, x))) return v.map((x) => store.chip(x)).join(' ');
    const shown = v.slice(0, 6);
    return shown.map((x) => `<div>${x && typeof x === 'object' ? compact(store, x) : esc(String(x))}</div>`).join('')
      + (v.length > shown.length ? `<div class="note">${shown.length} of ${v.length}; the station shows them all</div>` : '');
  }
  if (typeof v === 'object') return compact(store, v);
  return esc(String(v));
}

function oldNotes(ref) {
  try {
    const all = JSON.parse(globalThis.localStorage?.getItem('os.chatter') ?? 'null');
    const list = all && Array.isArray(all[ref]) ? all[ref] : [];
    return list.filter((n) => n && typeof n.text === 'string');
  } catch {
    return [];
  }
}

export function slideOverHTML(store, ref) {
  const esc = store.esc;
  const rec = store.resolve(ref);
  if (!rec) {
    return `<p class="k">Not on the books</p><h2 class="sect" style="margin-top:4px">${esc(String(ref))}</h2>
      <p class="note">Something points at this, but no record by that name exists. It is shown broken on purpose, never hidden.</p>`;
  }
  const type = String(ref).split(':')[0];
  const rows = Object.entries(rec).filter(([k]) => !k.startsWith('_') && !SKIP.has(k))
    .map(([k, v]) => `<tr><td>${esc(words(k))}</td><td>${value(store, k, v)}</td></tr>`).join('');
  const pointers = store.refsTo(ref) ?? [];
  const seen = new Set(pointers.map((p) => p.ref));
  const money = (store.ledgerFor(ref) ?? []).filter((e) => !seen.has('ledger:' + e.id));
  const back = [...pointers.map((p) => store.chip(p.ref)), ...money.map((e) => store.chip('ledger:' + e.id))].join(' ');
  // a note is { at, text } once written here; a record brought in with its notes as plain words
  // (the owner's vendors and recipes) shows those words as its first note
  const notes = (Array.isArray(rec.notes) ? rec.notes : rec.notes == null || rec.notes === '' ? [] : [rec.notes])
    .map((n) => (n && typeof n === 'object' ? n : { text: String(n) }));
  const legacy = oldNotes(ref);
  const note = (n) => `<div class="line" style="display:block;padding:8px 0">${n.at ? `<small class="note">${esc(String(n.at).slice(0, 16).replace('T', ' '))}</small>` : ''}<div>${esc(n.text ?? '')}</div></div>`;
  return `
    <p class="k">${esc(WORD[type] ?? type)}</p>
    <h2 class="sect" style="margin-top:4px">${esc(store.labelFor(ref))}</h2>
    <table class="tbl">${rows}</table>
    <h3 class="sub">Points here</h3>
    <div class="chips">${back || '<span class="note">Nothing yet. Links appear as other records name this one.</span>'}</div>
    <h3 class="sub">Notes</h3>
    ${notes.map(note).join('') || '<p class="note">None yet. A note here is saved with the books: the why behind this record.</p>'}
    ${legacy.length ? `<p class="note">Kept in this browser before notes were saved with the books (read only):</p>${legacy.map(note).join('')}` : ''}
    <div class="row"><input class="f" data-so-note placeholder="Add a note" /><button type="button" class="btn inline" data-so-add>Add</button></div>`;
}

let escHandler = null;

function ensureStyles() {
  if (document.getElementById('so-styles')) return;
  const s = document.createElement('style');
  s.id = 'so-styles';
  s.textContent = `
    #slideover-root .so-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:40; }
    #slideover-root .so-sheet { position:fixed; top:0; right:0; bottom:0; width:min(440px,100vw); z-index:41; display:flex; flex-direction:column;
      background:var(--bg); color:var(--fg); border-left:2px solid var(--accent); box-shadow:-14px 0 34px rgba(0,0,0,.25); }
    #slideover-root .so-body { flex:1 1 auto; overflow-y:auto; padding:18px 16px; -webkit-overflow-scrolling:touch; }
    #slideover-root .so-foot { flex:0 0 auto; display:flex; gap:8px; padding:12px 16px calc(12px + env(safe-area-inset-bottom)); border-top:1px solid var(--elevated); }
    #slideover-root .so-foot .btn { flex:1 1 auto; width:auto; }
    @media (max-width: 480px) {
      #slideover-root .so-sheet { top:auto; left:0; width:100%; max-height:88vh; border-left:0; border-top:2px solid var(--accent); border-radius:16px 16px 0 0; }
    }`;
  document.head.appendChild(s);
}

// notOn: the station on screen could not show this record as a line (index.html, route), so the
// foot says so instead of offering to open that station again
export function openSlideOver(store, ref, desk = null, { notOn = null } = {}) {
  if (typeof document === 'undefined') return;
  ensureStyles();
  let root = document.getElementById('slideover-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'slideover-root';
    document.body.appendChild(root);
  }
  const esc = store.esc;
  const station = store.moduleFor(String(ref).split(':')[0]);
  const paint = () => {
    root.innerHTML = `
      <div class="so-backdrop" data-so-close></div>
      <div class="so-sheet" role="dialog" aria-label="${esc(store.labelFor(ref))}">
        <div class="so-body">${slideOverHTML(store, ref)}</div>
        <div class="so-foot">
          ${station && station === notOn ? `<span class="note" style="flex:1 1 auto">${esc(STATION_TITLE[station] ?? station)} has no line of its own for this one; this card holds all of it.</span>`
            : station ? `<a class="btn fill" data-so-nav href="#${esc(station)}/${esc(String(ref))}">Open in ${esc(STATION_TITLE[station] ?? station)}</a>` : ''}
          <button type="button" class="btn" data-so-close>Close</button>
        </div>
      </div>`;
    // the toast stands above this foot while the card is open (index.html, .toast)
    document.documentElement.style.setProperty('--so-foot', root.querySelector('.so-foot').offsetHeight + 'px');
    root.querySelectorAll('[data-so-close]').forEach((n) => n.addEventListener('click', closeSlideOver));
    root.querySelectorAll('[data-so-nav]').forEach((n) => n.addEventListener('click', () => closeSlideOver()));
    const input = root.querySelector('[data-so-note]');
    const add = () => {
      const text = String(input?.value ?? '').trim();
      if (!text) { desk?.toast('Type the note first, then press Add', { error: true }); input?.focus(); return; }
      if (!store.resolve(ref)) { desk?.toast('That one is not on the books any more, so the note has nowhere to go', { error: true }); return; }
      const write = () => ({ act: store.write('a note on ' + store.labelFor(ref), [{ op: 'set', ref, push: { notes: { at: new Date().toISOString(), text } } }]) });
      if (desk) desk.act(write); else write();
      paint();
    };
    root.querySelector('[data-so-add]')?.addEventListener('click', add);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  };
  paint();
  escHandler = (e) => { if (e.key === 'Escape') closeSlideOver(); };
  document.addEventListener('keydown', escHandler);
}

export function closeSlideOver() {
  if (typeof document === 'undefined') return;
  const root = document.getElementById('slideover-root');
  if (root) root.innerHTML = '';
  document.documentElement.style.removeProperty('--so-foot');
  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
}
