import { arm, cloudLocked, seal } from './seal.mjs';

// store — the spine. Every station reads this one object and writes through it.
//
// It loads the data files, indexes every record by its "type:id" ref, and answers the only
// questions a station may ask: resolve a ref, walk the links, sum what the ledger says. Nothing
// in here stores a derived number: a count is the sum of its moves, a balance the sum of its
// postings.
//
// ONE WRITE PATH (2026-10-03, the War Chief's second ruling). store.write(label, ops) applies a
// list of ops all or none and remembers the inverse, so Undo takes the whole act back:
//
//   { op: 'add', type, rec }            a new record (an id is given when it has none)
//   { op: 'set', ref, patch, unset?, push? }   fields replaced, removed, or appended to a list
//   { op: 'del', ref }                  the record removed
//   { op: 'conf', patch, unset? }       the company settings (settings.json)
//
// Where an act lands depends on where the desk runs:
//   program (app://)   every touched file is PUT whole to app://localhost/data/<file>.json, which
//                      the program's protocol handler writes under the user's own data folder
//   browser (http/s)   the act is appended to localStorage 'os.ops' and replayed over the
//                      server's files at every load, so a newer server copy still shows through
//   Node (tests)       in memory; opts.save(file, json) receives each touched file when given
//
// The old draft layer (localStorage 'os.drafts': proposals exported to a file that the apply
// script it named never existed to read) is read once, turned into one act, and its key is left
// exactly as it was.
//
// buildStore() is pure and Node-importable; loadStore() is the browser wrapper that fetches.

// The one account map: the hledger journal's name for the bank account ≡ the spine's name for it.
// The treasury annotation and the node-side bridge (scripts/books-bridge.mjs) read this one home.
export const ACCOUNT_MAP = {
  'Assets:Relay': 'Assets:Cash',
};

export function mapAccount(account) {
  return ACCOUNT_MAP[account] ?? account;
}

// What a new desk starts with. An empty company name is what puts the setup page on screen.
export const DEFAULT_SETTINGS = {
  company: '',
  paper: 'cream',
  line: 'copper',
  logo: '',
  taxRate: 0,     // sales tax inside the price, as a fraction: 0.06 is six percent
  carriers: [],   // the carrier chips this desk has used, first use first
  banks: [],      // the bank chips this desk has used
  laborClasses: [], // kinds of worker and what an hour of each costs: [{ id, name, rate }]
};

// type -> the station that shows it (the tab a chip opens)
const STATION_FOR = {
  ledger: 'books', jar: 'books', rule: 'books',
  item: 'inventory', move: 'inventory',
  vendor: 'inventory', po: 'inventory',
  recipe: 'inventory', batch: 'inventory', reservation: 'inventory',
  product: 'shelf', order: 'orders',
  person: 'people', timesheet: 'people', payrun: 'people',
  event: 'calendar',
};

// A record its station keeps but draws inside another line, and the line a link to it lands on
// (index.html, route): a purchase that arrived, a stock move and a source sit under their material
// (a source under the first material it sells), a batch past the latest three and a plan already
// made under their recipe, hours and pay runs under their person. [the type of the line, its id from
// the record]; no id function means a plain anchor (data-ref="name"). scripts/bos-linker.cjs reads
// this table and fails a home the station does not draw.
const HOME_OF = {
  po: ['item', (r) => r.lines?.[0]?.itemId],
  move: ['item', (r) => r.itemId],
  vendor: ['item', (r) => r.offers?.[0]?.itemId],
  batch: ['recipe', (r) => r.recipeId],
  reservation: ['recipe', (r) => r.recipeId],
  timesheet: ['person', (r) => r.personId],
  payrun: ['person', (r) => r.personId],
};

// [file, collection, type, id field] — the whole registry of who owns what.
const COLLECTIONS = [
  ['ledger', 'entries', 'ledger', 'id'],
  ['inventory', 'items', 'item', 'id'],
  ['inventory', 'batches', 'batch', 'code'],
  ['inventory', 'moves', 'move', 'id'],
  ['sourcing', 'vendors', 'vendor', 'id'],
  ['sourcing', 'pos', 'po', 'id'],
  ['crew', 'people', 'person', 'id'],
  ['crew', 'timesheets', 'timesheet', 'id'],
  ['crew', 'payruns', 'payrun', 'id'],
  ['calendar', 'events', 'event', 'id'],
  ['recipes', 'recipes', 'recipe', 'id'],
  ['reservations', 'reservations', 'reservation', 'id'],
  ['orders', 'orders', 'order', 'id'],
  ['products', 'products', 'product', 'id'],
  ['jars', 'jars', 'jar', 'id'],
  ['rules', 'rules', 'rule', 'id'],
];
const TYPE = Object.fromEntries(COLLECTIONS.map(([file, coll, type, idField]) => [type, { file, coll, idField }]));
export const DATA_FILES = [...new Set(COLLECTIONS.map((c) => c[0]))];

const OPS_KEY = 'os.ops';
const LEGACY_KEY = 'os.drafts';
const ROSTER_KEY = 'wc.roster';
const ACTIVE_KEY = 'wc.active';

const box = () => (typeof localStorage !== 'undefined' ? localStorage : null);

export function newCompanyId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return 'c' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function readRoster() {
  try {
    const rows = JSON.parse(box()?.getItem(ROSTER_KEY) || '[]');
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r.id === 'string' && r.name) : [];
  } catch { return []; }
}

function writeRoster(rows) {
  try { box()?.setItem(ROSTER_KEY, JSON.stringify(rows)); } catch {}
}

// One id per company. The first time, a desk that already had a log keeps that log.
export function activeCompanyId() {
  const ls = box();
  if (!ls) return '';
  let id = ls.getItem(ACTIVE_KEY) || '';
  if (/^c[0-9a-f]{16}$/.test(id)) return id;
  const cloud = ls.getItem('wc.cloud.id') || '';
  id = /^c[0-9a-f]{16}$/.test(cloud) ? cloud : newCompanyId();
  ls.setItem(ACTIVE_KEY, id);
  ls.setItem('wc.cloud.id', id);
  const named = OPS_KEY + '.' + id;
  if (!ls.getItem(named) && ls.getItem(OPS_KEY)) ls.setItem(named, ls.getItem(OPS_KEY));
  return id;
}

function opsKey() {
  const id = activeCompanyId();
  return id ? OPS_KEY + '.' + id : OPS_KEY;
}

export function noteCompany(settings, where) {
  const id = activeCompanyId();
  if (!id || !settings?.company) return;
  const rows = readRoster().filter((r) => r.id !== id);
  rows.unshift({
    id,
    name: settings.company,
    paper: settings.paper || 'cream',
    line: settings.line || 'copper',
    entity: settings.entity || '',
    where: where === 'cloud' ? 'cloud' : 'computer',
  });
  writeRoster(rows);
  try {
    const prev = JSON.parse(box()?.getItem('wc.shell') || '{}');
    box()?.setItem('wc.shell', JSON.stringify({ ...prev, company: settings.company, paper: settings.paper, line: settings.line }));
  } catch {}
}

export function plugCompany(id) {
  const row = readRoster().find((r) => r.id === id);
  if (!row) return false;
  const ls = box();
  ls?.setItem(ACTIVE_KEY, id);
  ls?.setItem('wc.cloud.id', id);
  ls?.setItem('wc.where', row.where === 'cloud' ? 'cloud' : 'computer');
  try {
    const prev = JSON.parse(ls?.getItem('wc.shell') || '{}');
    ls?.setItem('wc.shell', JSON.stringify({ ...prev, company: row.name, paper: row.paper, line: row.line }));
  } catch {}
  return true;
}

export function blankCompany() {
  const id = newCompanyId();
  const ls = box();
  ls?.setItem(OPS_KEY + '.' + id, '[]');
  ls?.setItem(ACTIVE_KEY, id);
  ls?.setItem('wc.cloud.id', id);
  ls?.setItem('wc.where', 'computer');
  try {
    const prev = JSON.parse(ls?.getItem('wc.shell') || '{}');
    ls?.setItem('wc.shell', JSON.stringify({ ...prev, company: '' }));
  } catch {}
  return id;
}

// The account is asked before the desk is shown, so a cloud company does not
// paint the empty files and then swap. The copy on the phone is what opens;
// the cloud holds the locked one.
export async function touchCloud() {
  if (box()?.getItem('wc.where') !== 'cloud') return;
  const g = window.BOS_GATE;
  if (!g?.url || !window.supabase?.createClient) return;
  try {
    if (!g.sb) g.sb = window.supabase.createClient(g.url, g.key);
    const session = (await g.sb.auth.getSession()).data.session;
    if (!session) return;
    const id = activeCompanyId();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    await fetch(g.url + '/rest/v1/warchief_tables?company=eq.' + id + '&select=name,version', {
      headers: { apikey: g.key, authorization: 'Bearer ' + session.access_token },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch { /* the phone's copy opens either way */ }
}

// --- the door every record passes through ------------------------------------------------
// A record that cannot do its job is refused here, before it can poison arithmetic downstream:
// a move whose qty was the STRING '12' once made a stock count read "101712" for 1017 g on hand.
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isStr = (s) => typeof s === 'string' && s.trim().length > 0;
const usd = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SHAPE = {
  ledger: (r) => {
    if (!Array.isArray(r.postings) || r.postings.length < 2) return 'a ledger entry needs at least two postings';
    if (!r.postings.every((p) => p && isStr(p.account) && isNum(p.amount))) return 'every posting needs an account and a number';
    const off = r.postings.reduce((s, p) => s + p.amount, 0);
    return Math.abs(off) < 0.005 ? '' : `this entry does not balance (off by ${usd(off)}), so nothing was saved`;
  },
  move: (r) => (isStr(r.itemId) && isNum(r.qty) ? '' : 'a stock move needs a material and a number'),
  item: (r) => (isStr(r.name) ? '' : 'a material needs a name'),
  product: (r) => (isStr(r.name) ? '' : 'a product needs a name'),
  recipe: (r) => (Array.isArray(r.lines) ? '' : 'a recipe needs its list of materials'),
  vendor: (r) => (isStr(r.name) ? '' : 'a source needs a name'),
  person: (r) => (isStr(r.name) ? '' : 'a person needs a name'),
  event: (r) => (isStr(r.title) && isStr(r.date) ? '' : 'a date needs a title and a day'),
  timesheet: (r) => (isNum(r.hours) ? '' : 'hours must be a number'),
  order: (r) => (Array.isArray(r.lines) ? '' : 'an order needs its lines'),
  po: (r) => (Array.isArray(r.lines) ? '' : 'a purchase needs its lines'),
  jar: (r) => (isStr(r.name) ? '' : 'a jar needs a name'),
  rule: (r) => (isStr(r.account) ? '' : 'a rule needs an account'),
};

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
// what is written to disk: never the index's own markers (_type, _id)
const bare = (rec) => {
  const o = {};
  for (const [k, v] of Object.entries(rec ?? {})) if (!k.startsWith('_')) o[k] = v;
  return o;
};

class Missing extends Error {}
class Duplicate extends Error {}

// The old draft bag, turned into one act. Every kind it ever held has a home here, and the
// amendments (category taps on committed entries) become plain edits of those entries.
function legacyAct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ops = [];
  const add = (kind, type) => {
    for (const r of Array.isArray(raw[kind]) ? raw[kind] : []) {
      if (r && typeof r === 'object' && !Array.isArray(r)) {
        const rec = { ...r };
        delete rec._draft;
        ops.push({ op: 'add', type, rec });
      }
    }
  };
  add('ledger', 'ledger'); add('jars', 'jar'); add('rules', 'rule'); add('orders', 'order');
  add('moves', 'move'); add('reservations', 'reservation'); add('timesheets', 'timesheet');
  for (const t of Array.isArray(raw.orderTransitions) ? raw.orderTransitions : []) {
    if (t && isStr(t.orderId) && isStr(t.to)) {
      ops.push({ op: 'set', ref: 'order:' + t.orderId, patch: { status: t.to }, push: { history: { at: t.at, from: t.from ?? null, to: t.to } } });
    }
  }
  for (const a of Array.isArray(raw.amendments) ? raw.amendments : []) {
    if (a && isStr(a.target) && a.set && typeof a.set === 'object') ops.push({ op: 'set', ref: a.target, patch: a.set });
  }
  return ops.length ? { label: 'brought over from this browser’s drafts', at: new Date().toISOString(), ops } : null;
}

export function buildStore(files = {}, opts = {}) {
  // A missing file is empty collections, never a throw; a file that parses but holds the wrong
  // shape gets the same mercy, and the drop is said out loud in store.dataWarnings.
  const dataWarnings = [];
  const raw = {};
  const data = {};
  for (const [file, coll] of COLLECTIONS) {
    const obj = files[file];
    raw[file] = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    data[file] = data[file] ?? {};
    const list = raw[file][coll];
    if (list == null) { data[file][coll] = []; continue; }
    if (!Array.isArray(list)) {
      dataWarnings.push(`${file}.json: "${coll}" is not a list, so that part of the file is being ignored.`);
      data[file][coll] = [];
      continue;
    }
    const clean = list.filter((rec) => rec && typeof rec === 'object' && !Array.isArray(rec));
    if (clean.length < list.length) {
      dataWarnings.push(`${file}.json: ${list.length - clean.length} of ${list.length} "${coll}" record(s) could not be read and are being ignored.`);
    }
    data[file][coll] = clean;
  }
  const fileSettings = files.settings && typeof files.settings === 'object' && !Array.isArray(files.settings) ? files.settings : {};
  let settings = { ...clone(DEFAULT_SETTINGS), ...clone(fileSettings) };

  // --- the indexes: 'type:id' -> record, and target ref -> who points at it -------------
  let byRef = new Map();
  let backRefs = new Map();
  const reindex = () => {
    byRef = new Map();
    backRefs = new Map();
    for (const [file, coll, type, idField] of COLLECTIONS) {
      for (const rec of data[file][coll]) {
        rec._type = type;
        rec._id = String(rec[idField]);
        byRef.set(type + ':' + rec._id, rec);
      }
    }
    const point = (target, pointer, via) => {
      if (!target) return;
      if (!backRefs.has(target)) backRefs.set(target, []);
      backRefs.get(target).push({ ref: pointer, via });
    };
    for (const e of data.ledger.entries) for (const t of e.links ?? []) point(t, 'ledger:' + e.id, 'links');
    for (const ev of data.calendar.events) for (const t of ev.refs ?? []) point(t, 'event:' + ev.id, 'refs');
    for (const m of data.inventory.moves) {
      for (const t of m.refs ?? []) point(t, 'move:' + m.id, 'refs');
      point('item:' + m.itemId, 'move:' + m.id, 'itemId');
    }
    for (const b of data.inventory.batches) point('item:' + b.product, 'batch:' + b.code, 'product');
    for (const v of data.sourcing.vendors) for (const o of v.offers ?? []) point('item:' + o.itemId, 'vendor:' + v.id, 'offers');
    for (const p of data.sourcing.pos) {
      point('vendor:' + p.vendorId, 'po:' + p.id, 'vendorId');
      for (const ln of p.lines ?? []) point('item:' + ln.itemId, 'po:' + p.id, 'lines');
    }
    for (const t of data.crew.timesheets) point('person:' + t.personId, 'timesheet:' + t.id, 'personId');
    for (const r of data.crew.payruns) {
      point('person:' + r.personId, 'payrun:' + r.id, 'personId');
      for (const ts of r.timesheetIds ?? []) point('timesheet:' + ts, 'payrun:' + r.id, 'timesheetIds');
    }
    for (const r of data.recipes.recipes) {
      for (const ln of r.lines ?? []) point('item:' + ln.itemId, 'recipe:' + r.id, 'lines');
      for (const p of r.perUnitPackaging ?? []) point('item:' + p.itemId, 'recipe:' + r.id, 'perUnitPackaging');
      if (r.product) point('item:' + r.product, 'recipe:' + r.id, 'product');
    }
    for (const rv of data.reservations.reservations) point('recipe:' + rv.recipeId, 'reservation:' + rv.id, 'recipeId');
    for (const o of data.orders.orders) {
      for (const ln of o.lines ?? []) point('product:' + ln.productId, 'order:' + o.id, 'lines');
      for (const t of o.links ?? []) point(t, 'order:' + o.id, 'links');
      if (o.customerId) point('person:' + o.customerId, 'order:' + o.id, 'customerId');
    }
    for (const p of data.products.products) {
      if (p.itemId) point('item:' + p.itemId, 'product:' + p.id, 'itemId');
      if (p.recipeId) point('recipe:' + p.recipeId, 'product:' + p.id, 'recipeId');
    }
  };
  reindex();

  // --- applying one op, and its exact inverse ----------------------------------------------
  let seq = 0;
  const newId = (type) => type.slice(0, 3) + '-' + Date.now().toString(36) + (seq++).toString(36);
  const refuse = (type, rec) => {
    const why = (SHAPE[type] ?? (() => ''))(rec);
    if (why) throw new Error(why);
  };
  const editFields = (target, op) => {
    const before = {};
    const unset = [];
    const next = { ...target };
    const remember = (k) => {
      if (k in before || unset.includes(k)) return;
      if (k in target) before[k] = clone(target[k]); else unset.push(k);
    };
    for (const [k, v] of Object.entries(op.patch ?? {})) { remember(k); next[k] = clone(v); }
    for (const k of op.unset ?? []) { remember(k); delete next[k]; }
    for (const [k, v] of Object.entries(op.push ?? {})) {
      remember(k);
      // a field that already holds one value (the owner's vendors and recipes carry their notes as
      // a single sentence) keeps it as the first entry; appending never throws away what was there
      const had = next[k];
      next[k] = [...(Array.isArray(had) ? had : had == null || had === '' ? [] : [had]), clone(v)];
    }
    return { next, inverse: { patch: before, unset } };
  };
  const applyOp = (op) => {
    if (!op || typeof op !== 'object') throw new Error('an empty change was refused');
    if (op.op === 'add') {
      const t = TYPE[op.type];
      if (!t) throw new Error('unknown record type: ' + op.type);
      const rec = bare(clone(op.rec ?? {}));
      if (rec[t.idField] == null || rec[t.idField] === '') rec[t.idField] = newId(op.type);
      const ref = op.type + ':' + rec[t.idField];
      if (byRef.has(ref)) throw new Duplicate(ref + ' already exists');
      refuse(op.type, rec);
      const list = data[t.file][t.coll];
      const at = Number.isInteger(op.at) && op.at >= 0 && op.at <= list.length ? op.at : list.length;
      list.splice(at, 0, rec);
      rec._type = op.type;
      rec._id = String(rec[t.idField]);
      byRef.set(ref, rec);
      return { file: t.file, logged: { op: 'add', type: op.type, rec: bare(clone(rec)) }, inverse: { op: 'del', ref }, ref };
    }
    if (op.op === 'set') {
      const rec = byRef.get(op.ref);
      if (!rec) throw new Missing(op.ref + ' is not on the books');
      const t = TYPE[rec._type];
      const { next, inverse } = editFields(rec, op);
      if (String(next[t.idField]) !== rec._id) throw new Error('a record’s id cannot be changed in place');
      refuse(rec._type, bare(next));
      for (const k of Object.keys(rec)) if (!(k in next)) delete rec[k];
      Object.assign(rec, next);
      return { file: t.file, logged: clone(op), inverse: { op: 'set', ref: op.ref, ...inverse }, ref: op.ref };
    }
    if (op.op === 'del') {
      const rec = byRef.get(op.ref);
      if (!rec) throw new Missing(op.ref + ' is not on the books');
      const t = TYPE[rec._type];
      const list = data[t.file][t.coll];
      const at = list.indexOf(rec);
      list.splice(at, 1);
      byRef.delete(op.ref);
      return { file: t.file, logged: clone(op), inverse: { op: 'add', type: rec._type, rec: bare(clone(rec)), at }, ref: op.ref };
    }
    if (op.op === 'conf') {
      const { next, inverse } = editFields(settings, op);
      if (typeof next.company !== 'string' || next.company.length > 120) throw new Error('the company name must be text, 120 characters at most');
      if (!isNum(next.taxRate) || next.taxRate < 0 || next.taxRate > 0.5) throw new Error('the sales tax must be a number between 0 and 50 percent');
      if (next.search != null && !['duck', 'google', 'bing'].includes(next.search)) throw new Error('pick DuckDuckGo, Google, or Bing');
      if (next.state != null && next.state !== '' && !/^[A-Z]{2}$/.test(next.state)) throw new Error('pick a state');
      if (next.entity != null && next.entity !== '' && !['sole', 'llc', 'partnership', 's', 'c', 'nonprofit'].includes(next.entity)) throw new Error('pick the kind of company');
      if (next.formed != null && next.formed !== '' && !/^(0[1-9]|1[0-2])$/.test(next.formed)) throw new Error('pick the month the company was formed');
      settings = next;
      if (next.search) { try { storage()?.setItem('wc.search', next.search); } catch {} }
      return { file: 'settings', logged: clone(op), inverse: { op: 'conf', ...inverse }, ref: null };
    }
    throw new Error('unknown change: ' + op.op);
  };
  const applyAll = (ops) => {
    const done = [];
    try {
      for (const op of ops) done.push(applyOp(op));
    } catch (e) {
      for (const d of done.reverse()) applyOp(d.inverse);
      reindex();
      throw e;
    }
    reindex();
    return done;
  };

  // --- where the writes land -------------------------------------------------------------
  const inBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
  const mode = opts.mode ?? (typeof location !== 'undefined' && location.protocol === 'app:'
    ? 'program' : inBrowser ? 'browser' : 'memory');
  const storage = () => (typeof window !== 'undefined' ? window.localStorage : null);

  // The browser's log of acts, replayed over the server's files. An add whose id the files
  // already hold was applied upstream and is passed over; an edit of a record that is gone is
  // counted and said, never silently dropped.
  let acts = Array.isArray(opts.acts) ? opts.acts : [];
  if (mode === 'browser' && !opts.acts) {
    try {
      const ls = storage();
      const text = ls.getItem(opsKey());
      try {
        acts = JSON.parse(text ?? '[]');
        if (!Array.isArray(acts)) throw new Error('not a list');
      } catch {
        acts = [];
        ls.setItem(OPS_KEY + '.unreadable-' + new Date().toISOString().slice(0, 10), String(text));
        dataWarnings.push('The changes saved in this browser could not be read. They were set aside, untouched, and the desk opened without them.');
      }
      if (!ls.getItem(LEGACY_KEY + '.migrated')) {
        const old = legacyAct(JSON.parse(ls.getItem(LEGACY_KEY) ?? 'null'));
        if (old) {
          acts = [old, ...acts];
          ls.setItem(opsKey(), JSON.stringify(acts));
        }
        ls.setItem(LEGACY_KEY + '.migrated', new Date().toISOString());
      }
    } catch {
      dataWarnings.push('This browser is not keeping changes (its storage is blocked), so anything done here lasts until the page closes.');
    }
  }
  let skipped = 0;
  for (const act of acts) {
    for (const op of Array.isArray(act?.ops) ? act.ops : []) {
      try {
        applyOp(op);
      } catch (e) {
        if (!(e instanceof Duplicate)) skipped++;
      }
    }
  }
  if (acts.length) reindex();
  if (skipped) {
    dataWarnings.push(`${skipped} saved change${skipped === 1 ? '' : 's'} in this browser no longer match the records and ${skipped === 1 ? 'was' : 'were'} left out.`);
  }

  const fileJson = (file) => {
    if (file === 'settings') return clone(settings);
    const out = { ...raw[file] };
    for (const [f, coll] of COLLECTIONS) if (f === file) out[coll] = data[f][coll].map(bare);
    return out;
  };

  let saving = Promise.resolve();
  // Where this company is kept. The phone holds it either way. In the cloud, the same tables
  // also go to Iron Roots under the signed-in account (the program's warchief_tables).
  let where = 'computer';
  try { if (storage()?.getItem('wc.where') === 'cloud') where = 'cloud'; } catch {}
  const versions = new Map();
  try {
    const kept = JSON.parse(storage()?.getItem('wc.cloud.ver') || '{}');
    for (const [k, n] of Object.entries(kept)) if (typeof n === 'number') versions.set(k, n);
  } catch {}
  const rememberVer = () => { try { storage()?.setItem('wc.cloud.ver', JSON.stringify(Object.fromEntries(versions))); } catch {} };
  const cloudClient = () => {
    const g = window.BOS_GATE;
    if (!g) throw new Error('The cloud sign-in is not on this page.');
    if (!g.sb) {
      if (!window.supabase?.createClient) throw new Error('The sign-in library did not load. Check the connection and try again.');
      g.sb = window.supabase.createClient(g.url, g.key);
    }
    return g.sb;
  };
  const cloudCall = async (method, path, text, prefer) => {
    const g = window.BOS_GATE;
    const sb = cloudClient();
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) { const err = new Error('signin'); err.code = 'signin'; throw err; }
    const headers = { apikey: g.key, authorization: 'Bearer ' + token };
    if (text !== undefined) headers['content-type'] = 'application/json';
    if (prefer) headers.prefer = prefer;
    const r = await fetch((g.url || '') + path, { method, headers, body: text });
    const raw = await r.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch {}
    if (!r.ok) {
      const why = (body && (body.message || body.msg || body.error || body.error_description)) || ('the cloud answered ' + r.status);
      const err = new Error(why);
      err.status = r.status;
      throw err;
    }
    return body;
  };
  const companyId = () => {
    const id = activeCompanyId();
    try { storage()?.setItem('wc.cloud.id', id); } catch {}
    return id;
  };
  const putTable = async (id, name, body) => {
    if (cloudLocked()) throw new Error('The cloud is locked. Type the passphrase under Your company.');
    const locked = await seal(body);
    const text = JSON.stringify(locked);
    if (text.length > 5 * 1024 * 1024) throw new Error(name + ' is too large for the cloud (5 MB).');
    const key = id + '/' + name;
    let v = versions.get(key);
    if (v === undefined) {
      const got = await cloudCall('GET', `/rest/v1/warchief_tables?company=eq.${id}&name=eq.${name}&select=version`);
      v = Array.isArray(got) && got[0] ? Number(got[0].version) : 0;
    }
    if (!v) {
      try {
        await cloudCall('POST', '/rest/v1/warchief_tables', JSON.stringify({ company: id, name, version: 1, body: locked }), 'return=minimal');
        versions.set(key, 1);
      } catch (e) {
        if (e.status !== 409) throw e;
        const got = await cloudCall('GET', `/rest/v1/warchief_tables?company=eq.${id}&name=eq.${name}&select=version`);
        v = Array.isArray(got) && got[0] ? Number(got[0].version) : 0;
        if (!v) throw e;
        await cloudCall('PATCH', `/rest/v1/warchief_tables?company=eq.${id}&name=eq.${name}&version=eq.${v}`, JSON.stringify({ version: v + 1, body: locked }), 'return=minimal');
        versions.set(key, v + 1);
      }
    } else {
      await cloudCall('PATCH', `/rest/v1/warchief_tables?company=eq.${id}&name=eq.${name}&version=eq.${v}`, JSON.stringify({ version: v + 1, body: locked }), 'return=minimal');
      versions.set(key, v + 1);
    }
    rememberVer();
  };
  const tableNames = () => [...DATA_FILES, 'settings', 'books', 'networth'];
  async function moveToCloud(creds) {
    const sb = cloudClient();
    const session = (await sb.auth.getSession()).data.session;
    // The books go to the Iron Roots account that already passed the door. A typed
    // email would be a second account, and that is not offered.
    if (!session) {
      const err = new Error('Sign in with your Iron Roots account first. The books go to that account and no other.');
      err.code = 'signin';
      throw err;
    }
    if (typeof window.BOS_IS_GOLD === 'function' && !(await window.BOS_IS_GOLD(session))) {
      throw new Error('War Chief opens for a Gold Iron Roots account. This sign-in is not Gold.');
    }
    if (!creds?.phrase) { const err = new Error('Type a passphrase. It locks the books before they are sent.'); err.code = 'phrase'; throw err; }
    await arm(creds.phrase);
    const id = companyId();
    for (const name of tableNames()) await putTable(id, name, fileJson(name));
    where = 'cloud';
    store.where = 'cloud';
    try { storage()?.setItem('wc.where', 'cloud'); } catch {}
    noteCompany(settings, 'cloud');
  }
  function keepLocal() {
    where = 'computer';
    store.where = 'computer';
    try { storage()?.setItem('wc.where', 'computer'); } catch {}
    noteCompany(settings, 'computer');
  }
  // A file whose save failed is tried again with every later save, and the note stands until each
  // one has landed: a later save of another file is no sign this one did (the website's notices are
  // marked taken only on a clear note, site.mjs settle).
  const unsaved = new Map(); // file → why its last save failed
  const persist = (files, act) => {
    if (mode === 'program') {
      for (const file of new Set([...files, ...unsaved.keys()])) {
        // One file at a time, each PUT carrying the state as it is when it runs, so the last
        // write to land (on this computer, or in the cloud for a company kept there) is the newest.
        saving = saving.then(async () => {
          try {
            const r = await fetch('data/' + file + '.json', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(fileJson(file), null, 1),
            });
            if (!r.ok) throw new Error((await r.text().catch(() => '')) || 'status ' + r.status);
            unsaved.delete(file);
          } catch (e) {
            unsaved.set(file, String(e?.message ?? e));
          }
          store.saveNote = unsaved.size ? 'NOT SAVED: ' + [...unsaved.values()].at(-1) + '. Keep the desk open and export a backup from Books.' : '';
          store.onSave?.();
        });
      }
      return;
    }
    if (mode === 'browser') {
      try {
        const ls = storage();
        const cur = JSON.parse(ls.getItem(opsKey()) ?? '[]');
        const list = Array.isArray(cur) ? cur : [];
        list.push(act);
        ls.setItem(opsKey(), JSON.stringify(list));
        store.saveNote = '';
        if (where === 'cloud') {
          if (cloudLocked()) store.saveNote = 'NOT SAVED to the cloud: it is locked. Type the passphrase under Your company.';
          else {
            const id = storage()?.getItem('wc.cloud.id');
            if (id) {
              for (const file of new Set(files)) {
                putTable(id, file, fileJson(file)).catch((e) => {
                  store.saveNote = 'NOT SAVED to the cloud: ' + (e?.message ?? e);
                  store.onSave?.();
                });
              }
            }
          }
        }
      } catch (e) {
        store.saveNote = 'NOT SAVED in this browser: ' + (e?.message ?? e) + '. Export a backup from Books before closing.';
      }
      store.onSave?.();
      return;
    }
    if (typeof opts.save === 'function') for (const file of new Set(files)) opts.save(file, fileJson(file));
  };

  const undoStack = [];
  const commit = (label, ops, { undoable = true } = {}) => {
    const done = applyAll(ops);
    const act = { label: String(label ?? ''), at: new Date().toISOString(), ops: done.map((d) => d.logged) };
    if (undoable) undoStack.push({ label: act.label, inverse: done.map((d) => d.inverse).reverse() });
    persist(done.map((d) => d.file), act);
    return { ...act, refs: done.map((d) => d.ref).filter(Boolean) };
  };

  // --- the store --------------------------------------------------------------------------
  const store = {
    mode,
    where,
    moveToCloud,
    keepLocal,
    demo: ['ledger', 'inventory', 'sourcing', 'crew', 'calendar'].some((k) => files[k]?.demo === true),
    books: files.books ?? null,
    networth: files.networth ?? null, // treasury projection, never a spine collection
    data,
    route: { module: null, ref: null }, // written ONLY by the router
    dataWarnings,
    saveNote: '',
    onSave: null,
    get settings() { return settings; },

    // the one write: every op lands or none does. Returns { label, at, ops, refs }. A record of
    // something already done outside the books (a letter Resend took) passes { undoable: false }, so
    // Undo, which cannot unsend it, never takes that act back. Keep such records in a field no
    // undoable act writes: Undo puts a field back as it stood before its own act, records and all.
    write(label, ops, opts) { return commit(label, ops, opts); },
    conf(patch, label = 'company settings') {
      const act = commit(label, [{ op: 'conf', patch }]);
      noteCompany(settings, where);
      return act;
    },
    canUndo() { return undoStack.length > 0; },
    lastLabel() { return undoStack.at(-1)?.label ?? null; },
    undo() {
      const last = undoStack.pop();
      if (!last) return null;
      try {
        commit('undo: ' + last.label, last.inverse, { undoable: false });
      } catch (e) {
        undoStack.push(last);
        throw e;
      }
      return last.label;
    },
    // resolves when every write so far has landed or failed (program mode), a file that failed before
    // tried once more first (the connection may be back); saveNote says which
    flush() { if (unsaved.size) persist([], null); return saving; },
    fileJson,

    // the whole desk as one file, for a backup or a move to another computer
    exportAll() {
      const out = { app: 'war-chief', version: 1, exported: new Date().toISOString(), files: {} };
      for (const file of DATA_FILES) out.files[file] = fileJson(file);
      out.files.settings = fileJson('settings');
      return out;
    },
    // a backup brought back: everything replaced in one act, so one Undo puts it all back
    importAll(backup) {
      const f = backup?.files;
      if (!f || typeof f !== 'object') throw new Error('that file is not a desk backup');
      const ops = [];
      for (const [file, coll, type, idField] of COLLECTIONS) {
        for (const rec of data[file][coll].slice()) ops.push({ op: 'del', ref: type + ':' + rec[idField] });
        const list = f[file]?.[coll];
        for (const rec of Array.isArray(list) ? list : []) {
          if (rec && typeof rec === 'object' && !Array.isArray(rec)) ops.push({ op: 'add', type, rec });
        }
      }
      if (f.settings && typeof f.settings === 'object') {
        ops.push({ op: 'conf', patch: f.settings, unset: Object.keys(settings).filter((k) => !(k in f.settings)) });
      }
      return commit('brought in a backup', ops);
    },

    resolve(ref) { return byRef.get(ref) ?? null; },
    refsTo(ref) { return backRefs.get(ref) ?? []; },
    ledgerFor(ref) { return data.ledger.entries.filter((e) => (e.links ?? []).includes(ref)); },

    // Number(x) || 0: even a non-numeric amount that slipped past the door stays out of a sum.
    sum(entries, accountPrefix) {
      let s = 0;
      for (const e of entries ?? []) {
        for (const p of e.postings ?? []) if (String(p.account).startsWith(accountPrefix)) s += Number(p.amount) || 0;
      }
      return s;
    },
    stockOf(itemId) {
      let s = 0;
      for (const m of data.inventory.moves) if (m.itemId === itemId) s += Number(m.qty) || 0;
      return s;
    },
    entriesByTag(k, v) { return data.ledger.entries.filter((e) => (e.tags ?? {})[k] === v); },

    allRefs() {
      const out = [];
      for (const [ref, rec] of byRef) out.push({ ref, label: defaultLabel(store, rec._type, rec) });
      return out;
    },
    labelFor(ref) {
      const rec = byRef.get(ref);
      return rec ? defaultLabel(store, rec._type, rec) : String(ref);
    },
    usd,
    esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    },
    moduleFor(type) { return STATION_FOR[type] ?? null; },
    homeOf(ref) {
      const rec = byRef.get(ref);
      const h = rec && HOME_OF[rec._type];
      if (!h) return null;
      if (!h[1]) return h[0];
      const id = h[1](rec);
      return id ? h[0] + ':' + id : null;
    },
    chip(ref, label) {
      const rec = store.resolve(ref);
      const type = String(ref).split(':')[0];
      const station = store.moduleFor(type);
      if (!rec || !station) {
        // a dangling ref renders visibly broken, never as a dead link
        return `<span class="chip gone" title="not on the books">${store.esc(label ?? ref)}</span>`;
      }
      return `<a class="chip" href="#${station}/${store.esc(ref)}">${store.esc(label ?? defaultLabel(store, type, rec))}</a>`;
    },
  };

  return store;
}

function defaultLabel(store, type, rec) {
  switch (type) {
    case 'ledger': {
      const paid = (rec.postings ?? []).reduce((s, p) => s + (p.amount > 0 ? p.amount : 0), 0);
      return `${rec.desc ?? 'entry'} · ${store.usd(paid)}`;
    }
    case 'batch': return `Batch ${rec.code}${store.resolve('item:' + rec.product)?.name ? ' · ' + store.resolve('item:' + rec.product).name : ''}`;
    case 'po': return `Bought from ${store.resolve('vendor:' + rec.vendorId)?.name ?? 'a source'}${rec.date ? ' · ' + rec.date : ''}`;
    case 'payrun': return `Paid ${store.resolve('person:' + rec.personId)?.name ?? 'someone'}${rec.date ? ' · ' + rec.date : ''}`;
    case 'event': return rec.title;
    case 'timesheet': return `${rec.date} · ${rec.hours} h`;
    case 'move': {
      const item = store.resolve('item:' + rec.itemId);
      return `${rec.qty > 0 ? '+' : ''}${Math.round(Number(rec.qty) * 1000) / 1000} ${item?.unit ?? ''} ${item?.name ?? rec.itemId}`;
    }
    case 'reservation': return `${rec.date} · ${store.resolve('recipe:' + rec.recipeId)?.name ?? rec.recipeId} ×${rec.batches}`;
    case 'order': return `${Number(rec.no) > 0 ? '#' + rec.no : String(rec.id).toUpperCase()}${rec.customer ? ' · ' + rec.customer : ''}`;
    case 'rule': return `${rec.match?.payee ?? '?'} → ${rec.account}`;
    default: return rec.name ?? `${type}:${rec._id}`;
  }
}

export async function loadStore() {
  // On the public site everything under /bos/ sits behind the server's owner lock
  // (functions/_middleware.js); the page puts the signed-in owner's token on window.BOS_TOKEN
  // and it is presented here. In the program and on localhost there is no token and no lock.
  const get = async (url) => {
    try {
      const token = (typeof window !== 'undefined' && window.BOS_TOKEN) || null;
      const init = { cache: 'no-store' };
      if (token) init.headers = { authorization: 'Bearer ' + token };
      const r = await fetch(url, init);
      // a 401 is the server refusing, a different problem from a missing file: say which
      if (r.status === 401 && typeof window !== 'undefined') window.BOS_DATA_401 = true;
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };
  const names = [...DATA_FILES, 'settings', 'books', 'networth'];
  const got = await Promise.all(names.map((n) => get('data/' + n + '.json')));
  return buildStore(Object.fromEntries(names.map((n, i) => [n, got[i]])));
}
