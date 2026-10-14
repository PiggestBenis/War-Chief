// theme — the desk's colours: nine papers and seven line colours, so the desk can be dressed
// for any business. Every value below was read from Grok's desk (public/warchief.html, its own
// .sell-desk[data-bg] and [data-accent] rules) on 2026-10-03; nothing here was eyeballed.
//
// Two house laws ride on top (CLAUDE.md §8b): red means danger and nothing else, and it is ONE
// red, #b8220e; emphasis that is not a warning is gold, #8b6914. Grok's desk used its own danger
// and warn colours; here they are replaced by the house pair. Measured contrast decides where
// they may sit: on the six light papers the pair reads at 4.5:1 or better only on the field
// colour (surface), never on the paper itself, and on the three dark papers not at all
// (#b8220e on charcoal is 2.2:1). So red and gold are only ever drawn inside a badge whose
// ground is a light field colour, on every paper. scripts/warchief-line.mjs measures all 63
// pairs every run.
export const PAPERS = {
  cream:    { label: 'Cream',    bg: '#f3eee4', surface: '#fffcf6', elevated: '#e9e1d2', fg: '#1c1916', muted: '#5e574c', subtle: '#8a8174' },
  white:    { label: 'White',    bg: '#f6f6f4', surface: '#ffffff', elevated: '#ececea', fg: '#161616', muted: '#5c5c58', subtle: '#8a8a84' },
  grey:     { label: 'Grey',     bg: '#e4e2de', surface: '#f7f6f3', elevated: '#d4d1cb', fg: '#1a1a18', muted: '#5a5854', subtle: '#7e7c76' },
  sand:     { label: 'Sand',     bg: '#efe2cc', surface: '#fff8ee', elevated: '#e6d3b4', fg: '#1c1916', muted: '#5e574c', subtle: '#8a8174' },
  slate:    { label: 'Slate',    bg: '#d9dee6', surface: '#f7f9fb', elevated: '#c5ccd6', fg: '#16181c', muted: '#525860', subtle: '#7a8088' },
  moss:     { label: 'Moss',     bg: '#dce3d4', surface: '#f4f7f0', elevated: '#c5d0ba', fg: '#1a2218', muted: '#525a4c', subtle: '#7a8274' },
  charcoal: { label: 'Charcoal', bg: '#2c2b28', surface: '#38362f', elevated: '#454239', fg: '#f3f0e8', muted: '#b7b1a6', subtle: '#8c867c', dark: true },
  navy:     { label: 'Navy',     bg: '#1a2230', surface: '#242e40', elevated: '#314058', fg: '#f3f0e8', muted: '#b7c0cc', subtle: '#8b97a8', dark: true },
  black:    { label: 'Black',    bg: '#111110', surface: '#1c1b19', elevated: '#2a2825', fg: '#f4f1ea', muted: '#b7b1a6', subtle: '#8c867c', dark: true },
};

// [on a light paper, on a dark paper]
export const LINES = {
  copper: { label: 'Copper', light: '#8c4a2f', dark: '#e0a06a' },
  pine:   { label: 'Pine',   light: '#2f6a45', dark: '#8fbf9a' },
  ink:    { label: 'Ink',    light: '#1e3a5f', dark: '#9db4d4' },
  clay:   { label: 'Clay',   light: '#7a3b32', dark: '#e09a90' },
  gold:   { label: 'Gold',   light: '#8d6a12', dark: '#e3c36a' },
  sea:    { label: 'Sea',    light: '#1a6570', dark: '#7ec8cf' },
  plum:   { label: 'Plum',   light: '#6b3a62', dark: '#e0a8d4' },
};

export const RED = '#b8220e';
export const GOLD = '#8b6914';
const BADGE_ON_DARK = PAPERS.cream.surface;

// The CSS variables for one paper and one line. Unknown names fall back to cream and copper.
export function themeVars(paperId, lineId) {
  const p = PAPERS[paperId] ?? PAPERS.cream;
  const l = LINES[lineId] ?? LINES.copper;
  const line = p.dark ? l.dark : l.light;
  return {
    '--bg': p.bg, '--surface': p.surface, '--elevated': p.elevated,
    '--fg': p.fg, '--muted': p.muted, '--subtle': p.subtle,
    '--accent': line, '--on-accent': p.dark ? p.bg : p.surface,
    '--accent-light': l.light, // the line colour as drawn on a light paper (the mill's sheet uses it on a dark one)
    '--red': RED, '--gold': GOLD, '--badge': p.dark ? BADGE_ON_DARK : p.surface,
    '--scheme': p.dark ? 'dark' : 'light',
    // the names the owner's mill screen was drawn with, mapped onto the paper
    '--text': p.fg, '--dim': p.muted, '--line': p.elevated, '--fish': line,
    '--panel': p.surface, '--green': line,
  };
}

// WCAG 2 contrast ratio between two #rrggbb colours (1 to 21).
export function contrast(a, b) {
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
