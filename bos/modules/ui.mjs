// ui — the handful of pieces every station draws the same way, so the desk reads as one thing.
// No state in here beyond the toast; stations keep their own view state.

import { PAPERS, LINES } from './theme.mjs';

const EYE = '<svg class="eye-open" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><svg class="eye-shut" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6.5 0 10 6 10 6a18 18 0 0 1-3.2 3.8"/><path d="M6.7 6.7C3.6 8.6 2 12 2 12s3.5 6 10 6c1.6 0 3-.3 4.2-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

// A password the person can look at. The button is the same eye the signpost uses.
export function secretField(id, placeholder, autocomplete) {
  return `<span class="pw"><input class="f" id="${id}" type="password" placeholder="${placeholder}" autocomplete="${autocomplete}" /><button type="button" class="eye" data-eye="${id}" aria-label="Show password" aria-pressed="false">${EYE}</button></span>`;
}

// The units a material can be counted in, grouped the way a person thinks of them. Any other
// word (sheet, spool, bag) is allowed too: it simply converts only to itself.
export const UNIT_GROUPS = [
  ['Count', ['each', 'dozen', 'pair']],
  ['Weight', ['g', 'kg', 'oz', 'lb']],
  ['Volume', ['ml', 'l', 'floz', 'cup', 'pt', 'qt', 'gal']],
  ['Length', ['in', 'ft', 'yd', 'm']],
  ['Area', ['sqft', 'sqyd', 'acre']],
  ['Bulk', ['cuft', 'cuyd']],
];
const KNOWN = new Set(UNIT_GROUPS.flatMap((g) => g[1]));

export function unitOptions(selected = 'each', esc = (s) => s) {
  const sel = String(selected || 'each').toLowerCase();
  const extra = KNOWN.has(sel) ? '' : `<option value="${esc(sel)}" selected>${esc(sel)}</option>`;
  return extra + UNIT_GROUPS.map(([label, units]) =>
    `<optgroup label="${label}">${units.map((u) => `<option value="${u}"${u === sel ? ' selected' : ''}>${u}</option>`).join('')}</optgroup>`,
  ).join('') + '<option value="__other">another word…</option>';
}

// "another word…": the list turns into a field for the word, in place, and back into the list with
// the word chosen once it is typed (Enter or leaving the field keeps it, Escape keeps the unit it
// had). A field and never prompt(), which the program's browser refuses outright (measured on
// Electron 44, 2026-10-04: "prompt() is not supported"), so the choice did nothing there. `was` is
// the unit before the choice; keep(unit) hears the one chosen.
export function askUnit(select, was, keep) {
  const field = document.createElement('input');
  field.className = select.className;
  field.placeholder = 'One word: sheet, spool, bag…';
  field.setAttribute('aria-label', 'What is it counted in?');
  field.autocomplete = 'off';
  let done = false;
  const finish = (typed) => {
    if (done) return;
    done = true;
    const unit = String(typed ?? '').trim().toLowerCase() || was;
    if (![...select.options].some((o) => o.value === unit)) select.prepend(new Option(unit, unit));
    select.value = unit;
    field.replaceWith(select);
    keep(unit);
  };
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(field.value); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(''); }
  });
  field.addEventListener('blur', () => finish(field.value));
  select.replaceWith(field);
  field.focus();
}

// "How many g did one each hold?": the list turns into a field for that number, in place, the same
// way (a field, never prompt()). The list goes back to the unit the books hold; keep(n) hears the
// number, or 0 when the field was left empty or Escape was pressed.
export function askPer(select, from, to, keep) {
  const was = [...select.options].find((o) => o.defaultSelected)?.value ?? from;
  const field = document.createElement('input');
  field.className = select.className;
  field.inputMode = 'decimal';
  field.placeholder = `${to} in 1 ${from}`;
  field.setAttribute('aria-label', `How many ${to} did one ${from} hold?`);
  field.autocomplete = 'off';
  let done = false;
  const finish = (typed) => {
    if (done) return;
    done = true;
    select.value = was;
    field.replaceWith(select);
    const n = Number(String(typed ?? '').replace(/[,\s]/g, ''));
    keep(Number.isFinite(n) && n > 0 ? n : 0);
  };
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(field.value); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(''); }
  });
  field.addEventListener('blur', () => finish(field.value));
  select.replaceWith(field);
  field.focus();
}

// "$4.41 each", "$3.49 a gallon": the words after a price per unit. Any other word (sheet, spool)
// reads "a sheet".
const PER = {
  each: 'each', dozen: 'a dozen', pair: 'a pair', g: 'a gram', kg: 'a kilo', oz: 'an ounce', lb: 'a pound',
  ml: 'a millilitre', l: 'a litre', floz: 'a fluid ounce', cup: 'a cup', pt: 'a pint', qt: 'a quart', gal: 'a gallon',
  in: 'an inch', ft: 'a foot', yd: 'a yard', m: 'a metre', sqft: 'a square foot', sqyd: 'a square yard', acre: 'an acre',
  cuft: 'a cubic foot', cuyd: 'a cubic yard',
};
// a price for one unit: cents from a dime up; below that four decimals, because a gram of wax at
// $0.0265 rounded to $0.03 would not multiply back to the total printed beside it
export const unitPrice = (usd, n) => (Math.abs(Number(n)) >= 0.1 ? usd(Number(n)) : '$' + Number(n).toFixed(4));
export const perWord = (unit) => PER[String(unit ?? '').toLowerCase()] ?? 'a ' + String(unit ?? 'unit');

// 5.5 gal · 0.25 qt · 12 each: at most three decimals, no trailing zeros
export function qty(n, unit = '') {
  const v = Math.round((Number(n) || 0) * 1000) / 1000;
  return `${v.toLocaleString('en-US', { maximumFractionDigits: 3 })}${unit ? ' ' + unit : ''}`;
}

// A field with its name above it, the way the mill draws its calculator. A placeholder alone
// vanishes the moment the box holds a value, and a bare "1" or "24" in a box says nothing about
// what it counts. cap is HTML: escape anything that came from the books before passing it.
export const cell = (cap, input, size = '') => `<label class="cell${size ? ' ' + size : ''}"><span class="cap">${cap}</span>${input}</label>`;

export const todayIso = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// A link to a page outside the desk. In the program it opens beside the desk as a web tab of the
// station on screen (one of its tabs already on that site is reused); in a plain browser it is a
// new tab. Only http(s) links are drawn.
export function outLink(url, label, esc, cls = 'chip') {
  const u = String(url ?? '').trim();
  if (!/^https?:\/\//i.test(u)) return '';
  return `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener">${esc(label)}</a>`;
}

// A web search for words typed on the desk. DuckDuckGo, which needs no account to search; the
// program's address box sends plain words to the same place (warchief-desktop/main.js, SEARCH).
export const searchUrl = (words) => 'https://duckduckgo.com/?q=' + encodeURIComponent(String(words ?? '').trim());

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch {
    // older engines and some locked-down pages: the hidden-textarea route
    const ta = document.createElement('textarea');
    ta.value = String(text);
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

// The toast: what just happened, Undo, and the next step on the line.
let toastTimer = null;
export function toast(message, { undo, next, error = false } = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  clearTimeout(toastTimer);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  el.className = 'toast show' + (error ? ' err' : '');
  el.innerHTML = `<span class="tmsg">${esc(message)}</span>`
    + (undo ? '<button type="button" class="tbtn" data-toast-undo>Undo</button>' : '')
    + (next ? `<a class="tbtn" href="${esc(next.hash)}" data-toast-next>${esc(next.label)}</a>` : '')
    + '<button type="button" class="tx" data-toast-close aria-label="close">×</button>';
  el.querySelector('[data-toast-undo]')?.addEventListener('click', () => { hideToast(); undo(); });
  el.querySelector('[data-toast-next]')?.addEventListener('click', hideToast);
  el.querySelector('[data-toast-close]')?.addEventListener('click', hideToast);
  toastTimer = setTimeout(hideToast, error ? 9000 : 7000);
}
export function hideToast() {
  const el = document.getElementById('toast');
  if (el) el.className = 'toast';
}

// A file the person picked or dropped, as text. Big files are refused before they are read.
export function readText(file, maxBytes = 15 * 1024 * 1024) {
  if (!file) return Promise.reject(new Error('no file'));
  if (file.size > maxBytes) return Promise.reject(new Error(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB; the desk reads files up to ${Math.round(maxBytes / 1048576)} MB`));
  return file.text();
}

// Download a text file the person asked for (a backup, a workbook).
export function saveAs(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// The paper and line-colour chips, for the setup page and the company settings on Books.
export function themeChips(paper, line, esc = (s) => s) {
  const cur = PAPERS[paper] ?? PAPERS.cream;
  const papers = Object.entries(PAPERS).map(([id, v]) =>
    `<button type="button" class="chip paper-chip${id === paper ? ' on' : ''}" data-paper="${id}" aria-pressed="${id === paper}" style="background:${v.bg};color:${v.fg}">${esc(v.label)}</button>`).join('');
  const lines = Object.entries(LINES).map(([id, v]) => {
    const c = cur.dark ? v.dark : v.light;
    return `<button type="button" class="chip line-chip${id === line ? ' on' : ''}" data-line="${id}" aria-pressed="${id === line}" style="border-color:${c}"><span class="dot" style="background:${c}"></span>${esc(v.label)}</button>`;
  }).join('');
  return `<label class="lab">Paper</label><div class="chips">${papers}</div><label class="lab">Line color</label><div class="chips">${lines}</div>`;
}
