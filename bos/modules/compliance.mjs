// The dates a company has to meet to stay in good standing, and nothing else.
// Annual renewal by state and kind of company, the federal return, and the state tax
// return. A tax-exempt company keeps the renewal and drops the state tax days.
// Dates are the published deadline for a calendar-year company, moved to the next
// Monday when they fall on a weekend. They are not legal advice.

export const ENTITIES = [
  ['sole', 'Sole prop'],
  ['llc', 'LLC'],
  ['partnership', 'Partnership'],
  ['s', 'S corp'],
  ['c', 'C corp'],
  ['nonprofit', 'Nonprofit'],
];

const ENTITY_WORD = Object.fromEntries(ENTITIES);

// Renewal rule. A string 'MM-DD' is a fixed day. 'MM-DD*' is that day, every other year.
// 'MM-DD/odd' or '/even' is that day only in those years. 'end' 'before' 'first' 'qend'
// follow the formation month. An object { md, tax: true } is a tax, not a renewal.
// llc: null means that kind files no renewal. corp used for S and C. partnership uses llc.
const RULES = {
  AL: { name: 'Alabama', tax: true, llc: null, corp: null },
  AK: { name: 'Alaska', tax: false, llc: '01-02*', corp: '01-02*' },
  AZ: { name: 'Arizona', tax: true, llc: null, corp: 'end' },
  AR: { name: 'Arkansas', tax: true, llc: '05-01', corp: '05-01' },
  CA: { name: 'California', tax: true, llc: 'end*', corp: 'end', llcTax: '04-15' },
  CO: { name: 'Colorado', tax: true, llc: 'end', corp: 'end' },
  CT: { name: 'Connecticut', tax: true, llc: '03-31', corp: 'end' },
  DE: { name: 'Delaware', tax: true, llc: { md: '06-01', tax: true, name: 'Annual tax' }, corp: '03-01' },
  DC: { name: 'District of Columbia', tax: true, llc: '04-01*', corp: '04-01*' },
  FL: { name: 'Florida', tax: false, llc: '05-01', corp: '05-01' },
  GA: { name: 'Georgia', tax: true, llc: '04-01', corp: '04-01' },
  HI: { name: 'Hawaii', tax: true, llc: 'qend', corp: 'qend' },
  ID: { name: 'Idaho', tax: true, llc: 'end', corp: 'end' },
  IL: { name: 'Illinois', tax: true, llc: 'before', corp: 'before' },
  IN: { name: 'Indiana', tax: true, llc: 'end*', corp: 'end*' },
  IA: { name: 'Iowa', tax: true, llc: '04-01/odd', corp: '04-01/even' },
  KS: { name: 'Kansas', tax: true, llc: '04-15*', corp: '04-15*' },
  KY: { name: 'Kentucky', tax: true, llc: '06-30', corp: '06-30' },
  LA: { name: 'Louisiana', tax: true, llc: 'end', corp: 'end' },
  ME: { name: 'Maine', tax: true, llc: '06-01', corp: '06-01' },
  MD: { name: 'Maryland', tax: true, llc: '04-15', corp: '04-15' },
  MA: { name: 'Massachusetts', tax: true, llc: 'end', corp: '03-15' },
  MI: { name: 'Michigan', tax: true, llc: '02-15', corp: '05-15', nonprofit: '10-01', sales: '02-28',
    salesName: 'Sales, use, and withholding annual return', salesUrl: 'https://mto.treasury.michigan.gov',
    url: 'https://mibusinessregistry.lara.state.mi.us' },
  MN: { name: 'Minnesota', tax: true, llc: '12-31', corp: '12-31' },
  MS: { name: 'Mississippi', tax: true, llc: '04-15', corp: '04-15' },
  MO: { name: 'Missouri', tax: true, llc: null, corp: 'end' },
  MT: { name: 'Montana', tax: true, llc: '04-15', corp: '04-15' },
  NE: { name: 'Nebraska', tax: true, llc: '04-01/odd', corp: '03-01/even' },
  NV: { name: 'Nevada', tax: false, llc: 'end', corp: 'end' },
  NH: { name: 'New Hampshire', tax: false, llc: '04-01', corp: '04-01' },
  NJ: { name: 'New Jersey', tax: true, llc: 'end', corp: 'end' },
  NM: { name: 'New Mexico', tax: true, llc: null, corp: '03-15*' },
  NY: { name: 'New York', tax: true, llc: 'end*', corp: 'end*' },
  NC: { name: 'North Carolina', tax: true, llc: '04-15', corp: '04-15' },
  ND: { name: 'North Dakota', tax: true, llc: '11-15', corp: '08-01', nonprofit: '02-01' },
  OH: { name: 'Ohio', tax: true, llc: null, corp: null },
  OK: { name: 'Oklahoma', tax: true, llc: 'end', corp: 'end' },
  OR: { name: 'Oregon', tax: true, llc: 'end', corp: 'end' },
  PA: { name: 'Pennsylvania', tax: true, llc: '09-30', corp: '06-30' },
  RI: { name: 'Rhode Island', tax: true, llc: '05-01', corp: '05-01' },
  SC: { name: 'South Carolina', tax: true, llc: null, corp: '04-15' },
  SD: { name: 'South Dakota', tax: false, llc: 'first', corp: 'first' },
  TN: { name: 'Tennessee', tax: true, llc: '04-01', corp: '04-01' },
  TX: { name: 'Texas', tax: false, llc: '05-15', corp: '05-15', url: 'https://comptroller.texas.gov/taxes/franchise/' },
  UT: { name: 'Utah', tax: true, llc: 'end', corp: 'end' },
  VT: { name: 'Vermont', tax: true, llc: '03-31', corp: '03-15' },
  VA: { name: 'Virginia', tax: true, llc: 'end', corp: 'end' },
  WA: { name: 'Washington', tax: false, llc: 'end', corp: 'end' },
  WV: { name: 'West Virginia', tax: true, llc: '06-30', corp: '06-30' },
  WI: { name: 'Wisconsin', tax: true, llc: 'qend', corp: 'qend' },
  WY: { name: 'Wyoming', tax: false, llc: 'first', corp: 'first' },
};

const FEDERAL = {
  sole: ['04-15', 'Federal return'],
  llc: ['04-15', 'Federal return'],
  partnership: ['03-15', 'Federal partnership return'],
  s: ['03-15', 'Federal S corporation return'],
  c: ['04-15', 'Federal corporation return'],
  nonprofit: ['05-15', 'Federal Form 990'],
};

const NO_INCOME = new Set(['AK', 'FL', 'NV', 'NH', 'SD', 'TX', 'WA', 'WY']);

export const stateName = (code) => RULES[code]?.name || '';

// The state's own sales tax, as a fraction of the price, statewide only.
// California, Utah and Virginia include the local piece the state itself
// adds everywhere. Alaska, Delaware, Montana, New Hampshire and Oregon have none.
// A city or county can add more; this is the part that follows the state.
const SALES = {
  AL: 0.04, AK: 0, AZ: 0.056, AR: 0.065, CA: 0.0725, CO: 0.029, CT: 0.0635,
  DE: 0, DC: 0.06, FL: 0.06, GA: 0.04, HI: 0.04, ID: 0.06, IL: 0.0625,
  IN: 0.07, IA: 0.06, KS: 0.065, KY: 0.06, LA: 0.0445, ME: 0.055, MD: 0.06,
  MA: 0.0625, MI: 0.06, MN: 0.06875, MS: 0.07, MO: 0.04225, MT: 0, NE: 0.055,
  NV: 0.0685, NH: 0, NJ: 0.06625, NM: 0.04875, NY: 0.04, NC: 0.0475, ND: 0.05,
  OH: 0.0575, OK: 0.045, OR: 0, PA: 0.06, RI: 0.07, SC: 0.06, SD: 0.042,
  TN: 0.07, TX: 0.0625, UT: 0.061, VT: 0.06, VA: 0.053, WA: 0.065, WV: 0.06,
  WI: 0.05, WY: 0.04,
};

export function salesTaxOf(state) {
  return Object.prototype.hasOwnProperty.call(SALES, state) ? SALES[state] : 0;
}

export function salesTaxPct(state) {
  const rate = salesTaxOf(state);
  if (!rate) return '';
  return String(Math.round(rate * 10000) / 100);
}

export function salesTaxWords(state, exempt) {
  if (exempt) return 'Tax exempt. No sales tax is taken out.';
  if (!state) return 'Pick a state and its sales tax is filled in.';
  const name = stateName(state) || state;
  const pct = salesTaxPct(state);
  if (!pct) return name + ' has no statewide sales tax.';
  return name + ' sales tax is ' + pct + '%. A city can add its own on top.';
}

export function entityWord(entity) {
  return ENTITY_WORD[entity] || '';
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function rollWeekend(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  if (day === 6) dt.setDate(dt.getDate() + 2);
  if (day === 0) dt.setDate(dt.getDate() + 1);
  return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

function lastOf(y, m) {
  return new Date(y, m, 0).getDate();
}

function fromFormed(mode, year, formed) {
  const m = Number(formed);
  if (!m || m < 1 || m > 12) return null;
  if (mode === 'end') return iso(year, m, lastOf(year, m));
  if (mode === 'first') return iso(year, m, 1);
  if (mode === 'before') {
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? year : year;
    return iso(py, pm, lastOf(py, pm));
  }
  if (mode === 'qend') {
    const q = Math.ceil(m / 3) * 3;
    return iso(year, q, lastOf(year, q));
  }
  return null;
}

function parseRule(rule) {
  if (!rule) return null;
  if (typeof rule === 'object') return { ...rule };
  const star = rule.endsWith('*');
  const raw = star ? rule.slice(0, -1) : rule;
  const [md, parity] = raw.split('/');
  return { md, parity: parity || '', biennial: star };
}

function bucket(entity) {
  if (entity === 's' || entity === 'c') return 'corp';
  if (entity === 'partnership') return 'llc';
  if (entity === 'nonprofit') return 'nonprofit';
  if (entity === 'sole') return 'sole';
  return 'llc';
}

function renewalWord(entity) {
  if (entity === 'llc') return 'Renew the LLC';
  if (entity === 'partnership') return 'Renew the partnership';
  if (entity === 's') return 'Renew the S corporation';
  if (entity === 'c') return 'Renew the corporation';
  if (entity === 'nonprofit') return 'Renew the nonprofit';
  return 'Renew the company';
}

export function deadlines(settings, year) {
  const code = String(settings?.state || '').toUpperCase();
  const spec = RULES[code];
  const entity = ENTITY_WORD[settings?.entity] ? settings.entity : '';
  if (!spec || !entity || !Number.isFinite(year)) return [];
  const out = [];
  const exempt = settings.taxExempt === true;
  const formed = settings.formed;

  const push = (date, title, note, extra = {}) => {
    if (!date) return;
    out.push({ date: rollWeekend(date), title, note, kind: 'filing', ...extra });
  };

  const slot = spec[bucket(entity)] ?? (bucket(entity) === 'nonprofit' ? spec.corp : null);
  const rule = parseRule(slot);
  if (rule && !(rule.tax && exempt)) {
    let date = null;
    if (rule.md && /^\d{2}-\d{2}$/.test(rule.md)) {
      const ok = !rule.parity || (rule.parity === 'odd' ? year % 2 === 1 : year % 2 === 0);
      if (ok) date = `${year}-${rule.md}`;
    } else if (rule.md === 'end' || rule.md === 'before' || rule.md === 'first' || rule.md === 'qend') {
      date = fromFormed(rule.md, year, formed);
    }
    if (date) {
      const every = rule.biennial ? ' Every other year: confirm this is your year.' : '';
      const needsMonth = !rule.md?.includes('-') && !formed;
      if (!needsMonth) {
        push(date, `${renewalWord(entity)} — ${spec.name}`, (rule.name || 'Annual renewal') + '.' + every, { url: spec.url || '' });
      }
    }
  }

  const fed = FEDERAL[entity];
  if (fed) push(`${year}-${fed[0]}`, fed[1], 'The federal day for this kind of company. An LLC that files as a partnership or an S corporation is March 15: pick that kind if it is you.');

  if (!exempt && spec.tax && !NO_INCOME.has(code)) {
    const md = (code === 'MI' && (entity === 'c' || entity === 's')) ? '04-30' : fed[0];
    push(`${year}-${md}`, `${spec.name} tax return`, 'The state return. It drops off if you mark tax exempt.');
  }
  if (!exempt && spec.llcTax && bucket(entity) === 'llc') {
    push(`${year}-${spec.llcTax}`, `${spec.name} LLC tax`, 'The yearly LLC tax. It drops off if you mark tax exempt.');
  }
  if (!exempt && spec.sales) {
    push(`${year}-${spec.sales}`, spec.salesName, 'Every filer sends this, whatever monthly schedule the treasury assigned.', { url: spec.salesUrl || '' });
  }
  return out;
}

export function needsFormedMonth(settings) {
  const spec = RULES[String(settings?.state || '').toUpperCase()];
  if (!spec || settings?.formed) return false;
  const entity = settings?.entity;
  if (!entity) return false;
  const slot = spec[bucket(entity)] ?? (bucket(entity) === 'nonprofit' ? spec.corp : null);
  const rule = parseRule(slot);
  return !!(rule && ['end', 'before', 'first', 'qend'].includes(rule.md));
}

export function stateChoices() {
  return Object.entries(RULES).map(([code, s]) => ({ code, name: s.name }));
}
