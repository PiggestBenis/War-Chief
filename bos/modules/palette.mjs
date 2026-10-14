// command palette — one registry of every verb and every record, fuzzy-searched
// from anywhere (Linear trait, CONTRACT v2 §5.4).
//
// The index = every module's commands(store) (this file is the ONLY consumer
// of commands(), §1.7) + every record in the spine via the integrator's
// store.allRefs(). Selecting a verb navigates to its hash; selecting a record
// opens its slide-over. Every keystroke filters synchronously — local files
// make instant free; spend it (§7 rule 9).
//
// Keyboard: the integrator binds "/" and Ctrl/Cmd+K to openPalette in
// index.html, plus the #palette-open header button for the phone, where the
// same overlay renders as a pull-down sheet. Inside: arrows + Enter navigate,
// Esc closes.
//
// buildIndex / fuzzyScore / fuzzyFilter / createPaletteState are pure and
// Node-importable (§5.7-2 tests them with callback spies, no DOM); only
// openPalette/closePalette touch the document.

import { openSlideOver } from './slideover.mjs';

const KIND = {
  ledger: 'entry', item: 'material', move: 'stock move', vendor: 'source', po: 'purchase', person: 'person',
  timesheet: 'hours', payrun: 'pay', event: 'date', recipe: 'recipe', batch: 'batch', reservation: 'planned batch',
  order: 'order', product: 'product', jar: 'jar', rule: 'filing rule',
};

export function buildIndex(store, modules) {
  const verbs = [];
  // §7 rule 10: the palette reaches EVERY screen by name — one seeded
  // navigation verb per module, before any commands() run, so typing a
  // module's title always lands on its screen. One line here covers every
  // future module, whether or not it remembers to declare commands().
  for (const m of modules ?? []) {
    if (!m?.id || !m.title) continue;
    verbs.push({ kind: 'verb', label: 'Open ' + m.title, hint: 'a station', hash: '#' + m.id });
  }
  for (const m of modules ?? []) {
    if (typeof m?.commands !== 'function') continue;
    for (const c of m.commands(store) ?? []) {
      if (!c?.label) continue;
      verbs.push({ kind: 'verb', label: c.label, hint: c.hint ?? '', hash: c.hash ?? '#' + m.id });
    }
  }
  // one row per verb: a module whose commands() repeats a seeded label (e.g.
  // crew's "Open crew") replaces the seed — its hint is the better one.
  const byKey = new Map();
  for (const v of verbs) byKey.set(v.label.toLowerCase() + '|' + v.hash, v);
  const deduped = [...byKey.values()];
  // records come from the integrator's store.allRefs() (§1 / §5.4). Before
  // that lands, verbs alone still work — records join when the store can
  // list them; nothing here re-walks collections (call, never reimplement).
  const records = (typeof store.allRefs === 'function' ? store.allRefs() ?? [] : [])
    .map((r) => ({ kind: 'record', label: String(r.label ?? r.ref), ref: r.ref }));
  return [...deduped, ...records];
}

// case-insensitive subsequence match. Returns { run, first } (longest
// consecutive run, earliest matched index) or null for no match.
export function fuzzyScore(query, text) {
  const q = String(query).toLowerCase();
  const t = String(text).toLowerCase();
  let qi = 0;
  let first = -1;
  let prev = -2;
  let run = 0;
  let best = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    if (first < 0) first = ti;
    run = ti === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = ti;
    qi++;
  }
  return qi === q.length ? { run: best, first } : null;
}

// Ranking: consecutive-run length, then verbs before records, then earliest
// match, then shorter label. ERRATUM for the integrator: §5.4 lists
// earliest-match ahead of verbs-before-records, but on the real data that
// ordering fails the contract's own acceptance §5.7-2 — "Wholesale Supplies
// Plus" (run 4 at index 5) and the "Sales tax" calendar events (run 4 at 0)
// would out-rank the "Record a market sale" verb (run 4 at 16) for the query
// "sale". The acceptance test is the binding side, so verbs break the tie
// before position does.
export function fuzzyFilter(index, query) {
  const q = String(query ?? '').trim();
  if (!q) {
    const verbs = index.filter((h) => h.kind === 'verb');
    const records = index.filter((h) => h.kind !== 'verb');
    return [...verbs, ...records];
  }
  const scored = [];
  for (const hit of index) {
    const s = fuzzyScore(q, hit.label) ?? (hit.ref ? fuzzyScore(q, hit.ref) : null);
    if (s) scored.push({ hit, s });
  }
  scored.sort(
    (a, b) =>
      b.s.run - a.s.run ||
      (a.hit.kind === 'verb' ? 0 : 1) - (b.hit.kind === 'verb' ? 0 : 1) ||
      a.s.first - b.s.first ||
      String(a.hit.label).length - String(b.hit.label).length,
  );
  return scored.map((x) => x.hit);
}

// the palette's whole behavior as a plain object — the DOM below is a thin
// skin over it, and the tests drive it directly.
export function createPaletteState(index, { onPick, onClose } = {}) {
  const state = {
    query: '',
    sel: 0,
    results: fuzzyFilter(index, ''),
    setQuery(q) {
      state.query = q;
      state.results = fuzzyFilter(index, q);
      state.sel = 0;
    },
    key(k) {
      if (k === 'ArrowDown') state.sel = Math.min(Math.max(0, state.results.length - 1), state.sel + 1);
      else if (k === 'ArrowUp') state.sel = Math.max(0, state.sel - 1);
      else if (k === 'Enter') {
        const hit = state.results[state.sel];
        if (hit && onPick) onPick(hit);
      } else if (k === 'Escape') {
        if (onClose) onClose();
      }
    },
  };
  return state;
}

function ensureStyles() {
  if (document.getElementById('pal-styles')) return;
  const s = document.createElement('style');
  s.id = 'pal-styles';
  s.textContent = `
    #os-palette .pal-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:50; }
    /* one overlay, both shapes: a centred sheet at the desk, a pull-down sheet on the phone */
    #os-palette .pal-sheet { position:fixed; top:0; left:50%; transform:translateX(-50%); z-index:51;
      width:min(640px,100vw); max-height:min(70vh,520px); display:flex; flex-direction:column;
      background:var(--bg); color:var(--fg); border:2px solid var(--accent); border-top:0;
      border-radius:0 0 16px 16px; box-shadow:0 14px 34px rgba(0,0,0,.25); }
    #os-palette .pal-input { flex:0 0 auto; margin:12px; min-height:48px; background:var(--surface);
      border:2px solid var(--accent); border-radius:12px; color:var(--fg); padding:8px 14px; font:16px/1.3 var(--sans); }
    #os-palette .pal-input:focus-visible { outline:3px solid var(--fg); outline-offset:2px; }
    @media (min-width: 600px) { #os-palette .pal-sheet { top:8vh; border-top:2px solid var(--accent); border-radius:16px; } }
    #os-palette .pal-list { flex:1 1 auto; overflow-y:auto; padding:0 8px 10px; -webkit-overflow-scrolling:touch; }
    #os-palette .pal-item { display:flex; gap:8px; align-items:baseline; padding:10px; border-radius:10px; cursor:pointer; font-size:15px; }
    #os-palette .pal-item.sel { background:var(--surface); box-shadow:inset 3px 0 0 var(--accent); }
    #os-palette .pal-label { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #os-palette .dim { color:var(--muted); }`;
  document.head.appendChild(s);
}

export function openPalette(store, modules, desk = null) {
  if (typeof document === 'undefined') return;
  ensureStyles();
  closePalette();
  const esc = store.esc;
  const index = buildIndex(store, modules);
  const wrap = document.createElement('div');
  wrap.id = 'os-palette';
  wrap.innerHTML = `
    <div class="pal-backdrop" data-pal-close></div>
    <div class="pal-sheet" role="dialog" aria-label="jump anywhere">
      <input class="pal-input" type="text" autocomplete="off"
        placeholder="Find anything: a station, a thing to do, a record" aria-label="Find anything" />
      <div class="pal-list"></div>
    </div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector('.pal-input');
  const list = wrap.querySelector('.pal-list');
  const state = createPaletteState(index, {
    onPick(hit) {
      closePalette();
      if (hit.kind === 'record') openSlideOver(store, hit.ref, desk);
      else if (hit.hash) location.hash = hit.hash;
    },
    onClose: closePalette,
  });
  const paint = () => {
    const total = state.results.length;
    const shown = state.results.slice(0, 12);
    if (state.sel > shown.length - 1) state.sel = Math.max(0, shown.length - 1);
    list.innerHTML =
      shown
        .map(
          (h, i) => `
      <div class="pal-item${i === state.sel ? ' sel' : ''}" data-pal-idx="${i}">
        <span class="dim" style="flex:0 0 auto">${h.kind === 'verb' ? '⚡' : '·'}</span>
        <span class="pal-label">${esc(h.label)}</span>
        <span class="dim" style="flex:0 0 auto;font-size:12px">${esc(h.kind === 'record' ? (KIND[String(h.ref).split(':')[0]] ?? '') : h.hint ?? '')}</span>
      </div>`,
        )
        .join('') +
      (total > shown.length
        ? `<div class="dim" style="padding:6px 10px;font-size:13px">${shown.length} of ${total}; keep typing to narrow it</div>`
        : '') +
      (total === 0 ? '<div class="dim" style="padding:6px 10px;font-size:14px">Nothing matches. Fewer letters finds more.</div>' : '');
    list.querySelectorAll('[data-pal-idx]').forEach((n) =>
      n.addEventListener('click', () => {
        state.sel = Number(n.getAttribute('data-pal-idx'));
        state.key('Enter');
      }),
    );
  };
  input.addEventListener('input', () => {
    state.setQuery(input.value);
    paint();
  });
  input.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
      e.preventDefault();
      state.key(e.key);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') paint();
    }
  });
  wrap.querySelector('[data-pal-close]').addEventListener('click', closePalette);
  paint();
  input.focus();
}

export function closePalette() {
  if (typeof document === 'undefined') return;
  document.getElementById('os-palette')?.remove();
}
