// MARKETING — where people find the business: its website's admin and its social pages, and posts
// written from what is on the shelf. Matt, 2026-10-04 01:53Z: "if you go to marketing your social
// media accounts". In the program the pages are chips at the foot of its left bar, each opening
// beside the desk as one of this station's web tabs, and the starred one opens whenever you come
// back (Matt, 2026-10-05 22:26Z, for every station's sites); in a browser each opens in a new tab.
// The desk never signs in anywhere for you: every page keeps its own sign-in.
import * as V from './verbs.mjs';
import { copyText, outLink, cell, todayIso } from './ui.mjs';

// Each answered on 2026-10-04, at the address it settled on. Shopify and Etsy answered a script
// with 403, their wall against robots; what they show a person's browser was not seen from here.
export const SITES = [
  { name: 'Cloudflare', url: 'https://dash.cloudflare.com' },
  { name: 'GitHub', url: 'https://github.com' },
  { name: 'Supabase', url: 'https://supabase.com/dashboard' },
  { name: 'Shopify', url: 'https://admin.shopify.com' },
  { name: 'Wix', url: 'https://manage.wix.com' },
  { name: 'Squarespace', url: 'https://account.squarespace.com' },
  { name: 'WordPress', url: 'https://wordpress.com/sites' },
  { name: 'Etsy', url: 'https://www.etsy.com/your/shops/me/dashboard' },
  { name: 'Google Business', url: 'https://business.google.com' },
];
// moved here from Mail, where they were checked on 2026-10-04
export const SOCIAL = [
  { name: 'Facebook', url: 'https://www.facebook.com' }, { name: 'Instagram', url: 'https://www.instagram.com' },
  { name: 'TikTok', url: 'https://www.tiktok.com' }, { name: 'YouTube', url: 'https://www.youtube.com' },
  { name: 'X', url: 'https://x.com' }, { name: 'Pinterest', url: 'https://www.pinterest.com' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com' }, { name: 'Threads', url: 'https://www.threads.com' },
  { name: 'Reddit', url: 'https://www.reddit.com' },
];

// A post starts from one of these, filled in from the company and the product picked. Plain words
// on purpose: a post says what is so (what it is, what it costs, where you will be) and the person
// adds the rest. A word still in brackets is said out loud before anything is copied.
export const POSTS = [
  { id: 'new', name: 'New', body: '[PRODUCT] is new at [COMPANY]. [PRICE].' },
  { id: 'back', name: 'Back in stock', body: '[PRODUCT] is back in stock at [COMPANY]. [PRICE].' },
  { id: 'price', name: 'Price', body: '[PRODUCT] is [PRICE] at [COMPANY] until [WHEN].' },
  { id: 'how', name: 'How it is made', body: 'How [COMPANY] makes [PRODUCT]: ' },
  { id: 'where', name: 'Where we will be', body: '[COMPANY] will be at [WHERE] on [WHEN].' },
  { id: 'thanks', name: 'Thank you', body: 'Thank you to everyone who bought from [COMPANY].' },
];

export function fillPost(store, body, product) {
  const f = { '[COMPANY]': store.settings.company || 'the company' };
  if (product) {
    f['[PRODUCT]'] = product.name;
    if (Number(product.price) > 0) f['[PRICE]'] = store.usd(Number(product.price));
  }
  let out = String(body);
  for (const [k, v] of Object.entries(f)) out = out.split(k).join(v);
  return out;
}

// view state
let postId = 'new';
let productId = '';
let text = null;   // null = follow the post picked; a string = what the person typed
let planOn = '';
let adding = '';   // 'sites' or 'socials' while its little form is open

export const website = {
  id: 'website',
  title: 'Website',
  commands: () => [{ label: 'Open your website', hint: 'Website', hash: '#website' }],
  web: { presets: SITES, keys: ['sites'] },
  render(el, desk) {
    const store = desk.store;
    const esc = store.esc;
    const mine = (store.settings.sites ?? []).filter((x) => x && x.name && x.url);
    const chips = [...SITES, ...mine].map((x) => outLink(x.url, x.name, esc, 'chip sm')).join('');
    el.innerHTML = `
      <h1 class="title">Website</h1>
      <div class="chips">${chips}
        <button type="button" class="chip sm" data-do="add" data-v="sites">+ Custom</button></div>
      ${adding === 'sites' ? `<div class="row">
        ${cell('Its name', '<input class="f" id="mk-name" autocomplete="off" placeholder="My shop" />')}
        ${cell('Its address', '<input class="f" id="mk-url" inputmode="url" placeholder="https://…" />')}
        <button type="button" class="btn inline" data-do="save" data-v="sites">Add</button>
      </div>` : ''}
      <p class="note">The shop and the accounts that hold the site. Each one opens in the browser and signs you in itself.</p>`;
    el.onclick = (e) => {
      const b = e.target.closest('[data-do]');
      if (!b) return;
      if (b.dataset.do === 'add') { adding = adding === 'sites' ? '' : 'sites'; desk.rerender(); el.querySelector('#mk-name')?.focus(); return; }
      if (b.dataset.do === 'save') {
        const name = el.querySelector('#mk-name').value.trim();
        const url = el.querySelector('#mk-url').value.trim();
        if (!name) { desk.toast('Name it', { error: true }); return; }
        if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(url)) { desk.toast('An address starts with https:// and names a site', { error: true }); return; }
        const r = desk.act(() => ({ act: store.conf({ sites: [...(store.settings.sites ?? []), { name, url }] }, 'added ' + name) }));
        if (r) { adding = ''; desk.rerender(); }
      }
    };
  },
};

export const station = {
  id: 'marketing',
  title: 'Marketing',
  commands: () => [{ label: 'Write a post', hint: 'Marketing', hash: '#marketing' }],
  web: { presets: SOCIAL, keys: ['socials'] },
  render(el, desk) {
    const store = desk.store;
    const esc = store.esc;
    const ref = store.route.ref ?? '';
    if (desk.fresh && ref.startsWith('product:') && store.resolve(ref)) { productId = ref.slice('product:'.length); text = null; }
    const products = store.data.products.products;
    const product = productId ? store.resolve('product:' + productId) : null;
    const post = POSTS.find((p) => p.id === postId) ?? POSTS[0];
    const body = text ?? fillPost(store, post.body, product);
    const holes = [...new Set(body.match(/\[[A-Z]+\]/g) ?? [])];
    const mine = (key) => (store.settings[key] ?? []).filter((x) => x && x.name && x.url);
    const chips = (list) => list.map((x) => outLink(x.url, x.name, esc, 'chip sm')).join('');
    const addForm = (key) => (adding === key ? `<div class="row">
        ${cell(key === 'sites' ? 'Its name' : 'The name on the chip', `<input class="f" id="mk-name" autocomplete="off" placeholder="${key === 'sites' ? 'My shop' : 'Our Instagram'}" />`)}
        ${cell('Its address', '<input class="f" id="mk-url" inputmode="url" placeholder="https://…" />')}
        <button type="button" class="btn inline" data-do="save" data-v="${key}">Add</button>
      </div>` : '');

    el.innerHTML = `
      <h1 class="title">Marketing</h1>
      ${desk.program ? '' : `
      <h2 class="sect">Social pages</h2>
      <div class="chips">${chips([...SOCIAL, ...mine('socials')])}
        <button type="button" class="chip sm" data-do="add" data-v="socials">+ Custom</button></div>
      ${addForm('socials')}`}

      <h2 class="sect">A post</h2>
      <div class="chips">${POSTS.map((p) => `<button type="button" class="chip sm${p.id === post.id ? ' on' : ''}" data-do="post" data-v="${p.id}" aria-pressed="${p.id === post.id}">${esc(p.name)}</button>`).join('')}</div>
      ${cell('About', `<select class="f" id="mk-product">
        <option value="">No product</option>
        ${products.map((p) => `<option value="${esc(p.id)}"${p.id === productId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>`)}
      ${cell('The post', `<textarea class="f" id="mk-post">${esc(body)}</textarea>`)}
      ${holes.length ? `<p class="truth">⚠ Still in brackets: ${holes.map(esc).join(', ')}. ${holes.includes('[PRODUCT]') || holes.includes('[PRICE]') ? 'Pick a product with a price to fill those in, or type them.' : 'Type them in before it goes out.'}</p>` : ''}
      <div class="btns"><button type="button" class="btn fill" data-do="copy">Copy the post</button></div>
      <p class="note">Copy it, open your page ${desk.program ? 'from the left bar' : 'above'}, and paste it into a new post there.</p>
      <div class="row">
        ${cell('Plan it for', `<input class="f" id="mk-when" type="date" value="${esc(planOn || todayIso())}" />`, 'm')}
        <button type="button" class="btn inline" data-do="plan">Put it on the calendar</button>
      </div>`;

    el.oninput = (e) => {
      if (e.target.id === 'mk-post') text = e.target.value;
      else if (e.target.id === 'mk-when') planOn = e.target.value;
    };
    el.onchange = (e) => {
      if (e.target.id !== 'mk-product') return;
      productId = e.target.value;
      text = null;
      desk.rerender();
    };
    el.onclick = async (e) => {
      const b = e.target.closest('[data-do]');
      if (!b) return;
      switch (b.dataset.do) {
        case 'post': postId = b.dataset.v; text = null; desk.rerender(); return;
        case 'copy': {
          const ok = await copyText(body);
          desk.toast(ok ? 'Copied the post' : 'Could not copy; select it and copy by hand', { error: !ok });
          return;
        }
        case 'plan': {
          const words = body.replace(/\s+/g, ' ').trim();
          const r = desk.act(() => V.addEvent(store, { title: 'Post: ' + (words.length > 60 ? words.slice(0, 59) + '…' : words || post.name),
            date: el.querySelector('#mk-when').value, kind: 'post', refs: product ? ['product:' + product.id] : [] }),
          { next: { label: 'See the calendar', hash: '#calendar' } });
          if (r) planOn = '';
          return;
        }
        case 'add': adding = adding === b.dataset.v ? '' : b.dataset.v; desk.rerender(); el.querySelector('#mk-name')?.focus(); return;
        case 'save': {
          const key = b.dataset.v;
          const name = el.querySelector('#mk-name').value.trim();
          const url = el.querySelector('#mk-url').value.trim();
          if (!name) { desk.toast('Name it', { error: true }); return; }
          if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(url)) { desk.toast('An address starts with https:// and names a site', { error: true }); return; }
          const r = desk.act(() => ({ act: store.conf({ [key]: [...(store.settings[key] ?? []), { name, url }] }, 'added ' + name) }));
          if (r) { adding = ''; desk.rerender(); }
        }
      }
    };
  },
};
