/* Phone bridge for the War Chief desk. The frame outside this page draws the station
   bar. This page keeps every station's own buttons, and hands web links up to the frame
   so they open as that station's tabs. On its own (no frame) it draws the web sheet here. */
const embedded = window.parent !== window;
const PRESETS = {
  ship: [
    { name: "USPS", url: "https://cns.usps.com/" },
    { name: "UPS", url: "https://www.ups.com" },
    { name: "FedEx", url: "https://www.fedex.com" },
    { name: "DHL", url: "https://mydhl.express.dhl/us/en/home.html" },
    { name: "Amazon", url: "https://sellercentral.amazon.com" },
    { name: "Pirate Ship", url: "https://ship.pirateship.com" },
    { name: "Shippo", url: "https://apps.goshippo.com" },
  ],
  mail: [
    { name: "Gmail", url: "https://mail.google.com/mail/" },
    { name: "Outlook", url: "https://outlook.office.com/mail/" },
    { name: "Yahoo", url: "https://mail.yahoo.com" },
    { name: "iCloud", url: "https://www.icloud.com/mail" },
    { name: "AOL", url: "https://mail.aol.com" },
    { name: "Proton", url: "https://mail.proton.me" },
    { name: "Zoho", url: "https://accounts.zoho.com/signin?servicename=VirtualOffice&serviceurl=https%3A%2F%2Fmail.zoho.com%2Fzm%2F" },
    { name: "Resend", url: "https://resend.com/login" },
  ],
  books: [
    { name: "PayPal", url: "https://www.paypal.com/signin" },
    { name: "Square", url: "https://app.squareup.com/dashboard" },
    { name: "Stripe", url: "https://dashboard.stripe.com" },
    { name: "Venmo", url: "https://account.venmo.com/" },
    { name: "Cash App", url: "https://cash.app/account" },
    { name: "Clover", url: "https://www.clover.com/dashboard" },
  ],
  website: [
    { name: "Cloudflare", url: "https://dash.cloudflare.com" },
    { name: "GitHub", url: "https://github.com" },
    { name: "Supabase", url: "https://supabase.com/dashboard" },
    { name: "Shopify", url: "https://admin.shopify.com" },
    { name: "Wix", url: "https://manage.wix.com" },
    { name: "Squarespace", url: "https://account.squarespace.com" },
    { name: "WordPress", url: "https://wordpress.com/sites" },
    { name: "Etsy", url: "https://www.etsy.com/your/shops/me/dashboard" },
    { name: "Google Business", url: "https://business.google.com" },
  ],
  marketing: [
    { name: "Facebook", url: "https://www.facebook.com" },
    { name: "Instagram", url: "https://www.instagram.com" },
    { name: "TikTok", url: "https://www.tiktok.com" },
    { name: "YouTube", url: "https://www.youtube.com" },
    { name: "X", url: "https://x.com" },
    { name: "Pinterest", url: "https://www.pinterest.com" },
    { name: "LinkedIn", url: "https://www.linkedin.com" },
    { name: "Threads", url: "https://www.threads.com" },
    { name: "Reddit", url: "https://www.reddit.com" },
  ],
};

let lastStation = "inventory";
const stationNow = () => {
  const id = (location.hash.replace(/^#/, "").split("/")[0] || "inventory").toLowerCase();
  const clean = /^[a-z-]{1,32}$/.test(id) ? id : "inventory";
  if (clean === "settings") return lastStation;
  lastStation = clean;
  return clean;
};

const post = (msg) => {
  if (!embedded) return;
  window.parent.postMessage({ source: "wc-desk", ...msg }, location.origin);
};

const accountEmail = () => String(window.BOS_GATE?.user?.email || "");

const report = () => {
  const gate = document.getElementById("bos-gate");
  const root = document.documentElement;
  const g = (k) => getComputedStyle(root).getPropertyValue(k).trim();
  const theme = {
    bg: g("--bg"),
    surface: g("--surface"),
    elevated: g("--elevated"),
    fg: g("--fg"),
    muted: g("--muted"),
    subtle: g("--subtle"),
    accent: g("--accent"),
    on: g("--on-accent"),
    scheme: root.dataset.scheme || "light",
  };
  const account = accountEmail();
  const needs = typeof window.wcNeeds === "function" ? window.wcNeeds() : [];
  if (gate && !gate.hidden) {
    post({ type: "state", ready: true, station: "inventory", company: "", saved: account ? "Signed in" : "", account, needs, canUndo: false, theme });
    return;
  }
  const setup = document.getElementById("setup");
  const setupOn = !!(setup && !setup.hidden);
  const head = location.hash.replace(/^#/, "").split("/")[0] || "";
  const sheet = head === "settings" || head === "company";
  const name = (document.getElementById("co-name")?.textContent || "").trim();
  if (!setupOn && !name && !sheet) return;
  const sub = document.getElementById("co-sub");
  const undo = document.getElementById("undo");
  post({
    type: "state",
    ready: true,
    station: stationNow(),
    company: setupOn ? "" : name,
    saved: setupOn ? (account ? "Signed in" : "") : (sub?.textContent || ""),
    account,
    needs,
    canUndo: !!undo && !undo.disabled,
    theme,
  });
};

const httpsUrl = (v) => {
  try {
    const u = new URL(String(v), location.href);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    if (u.origin === location.origin) return "";
    return u.href;
  } catch {
    return "";
  }
};

const handOff = (url) => {
  const href = httpsUrl(url);
  if (!href) return false;
  if (embedded) {
    post({ type: "open", url: href, station: stationNow() });
    return true;
  }
  window.dispatchEvent(new CustomEvent("wc-open", { detail: { url: href, station: stationNow() } }));
  return true;
};

document.addEventListener(
  "click",
  (e) => {
    const a = e.target.closest?.("a[href]");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    if (handOff(a.href)) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true,
);

const origOpen = window.open.bind(window);
window.open = (url, target, features) => {
  if (handOff(url)) return null;
  return origOpen(url, target, features);
};

window.addEventListener("message", (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data;
  if (!d || d.source !== "wc-shell") return;
  if (d.cmd === "go" && typeof d.id === "string") {
    const hash = "#" + d.id;
    if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = hash;
  } else if (d.cmd === "undo" || d.cmd === "find") {
    window.deskCmd?.(d.cmd);
  } else if (d.cmd === "settings") {
    const hash = "#settings";
    if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = hash;
  } else if (d.cmd === "report") report();
});

addEventListener("hashchange", report);
addEventListener("wc-ready", report);
const tick = () => {
  report();
  if (!document.getElementById("desk") && !document.getElementById("bos-gate")) return;
};
setInterval(tick, 700);
addEventListener("load", tick);

/* Standalone (the private copy opened by itself): the same web sheet the frame draws. */
if (!embedded) {
  const MAX = 8;
  const key = "wc.phone.tabs";
  const load = () => {
    try {
      const v = JSON.parse(localStorage.getItem(key) || "{}");
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  };
  const save = (all) => localStorage.setItem(key, JSON.stringify(all));
  let tabs = load();
  let shown = false;
  let active = "";

  const sheet = document.createElement("section");
  sheet.hidden = true;
  sheet.setAttribute("aria-label", "This station's web tabs");
  sheet.style.cssText =
    "position:fixed;inset:0;z-index:70;display:flex;flex-direction:column;background:#f3eee4;color:#1c1916;font:16px/1.4 system-ui,sans-serif";
  sheet.innerHTML = `
    <header style="display:flex;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid #e9e1d2">
      <button type="button" id="wc-back" style="min-height:44px;padding:0 12px;border:2px solid #8c4a2f;border-radius:10px;background:#fffcf6">Desk</button>
      <form id="wc-go" style="display:flex;flex:1;gap:6px;min-width:0">
        <input id="wc-url" aria-label="Address" placeholder="An address, or words to search" style="flex:1;min-width:0;min-height:44px;padding:0 10px;border:2px solid #8c4a2f;border-radius:10px;background:#fffcf6" />
        <button type="submit" style="min-height:44px;padding:0 12px;border:2px solid #8c4a2f;border-radius:10px;background:#8c4a2f;color:#fffcf6">Go</button>
      </form>
      <button type="button" id="wc-out" style="min-height:44px;padding:0 12px;border:2px solid #8c4a2f;border-radius:10px;background:#fffcf6">Open</button>
    </header>
    <div id="wc-tabs" style="display:flex;gap:6px;overflow-x:auto;padding:8px 10px"></div>
    <div id="wc-chips" style="display:flex;gap:6px;overflow-x:auto;padding:0 10px 8px"></div>
    <p style="margin:0 10px 8px;color:#5e574c;font-size:13px">If the page stays blank, it refused to sit inside War Chief. Open uses this phone's own browser, where the sign-in sticks.</p>
    <iframe id="wc-frame" title="Web" style="flex:1;width:100%;border:0;background:#fff"></iframe>`;
  document.body.appendChild(sheet);
  const frame = sheet.querySelector("#wc-frame");
  const urlInput = sheet.querySelector("#wc-url");

  const list = () => tabs[stationNow()] || (tabs[stationNow()] = []);
  const paint = () => {
    const st = stationNow();
    const row = list();
    const tabHost = sheet.querySelector("#wc-tabs");
    tabHost.replaceChildren();
    for (const t of row) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = (t.star ? "☆ " : "") + (t.title || t.url);
      b.style.cssText =
        "flex:0 0 auto;min-height:40px;max-width:180px;overflow:hidden;text-overflow:ellipsis;padding:0 10px;border-radius:10px;border:2px solid #8c4a2f;background:" +
        (t.id === active ? "#8c4a2f" : "#fffcf6") +
        ";color:" +
        (t.id === active ? "#fffcf6" : "#1c1916");
      b.onclick = () => {
        active = t.id;
        frame.src = t.url;
        urlInput.value = t.url;
        paint();
      };
      tabHost.appendChild(b);
    }
    const chips = sheet.querySelector("#wc-chips");
    chips.replaceChildren();
    const openHosts = new Set(row.map((t) => { try { return new URL(t.url).hostname.split(".").slice(-2).join("."); } catch { return ""; } }));
    for (const c of PRESETS[st] || []) {
      let host = "";
      try { host = new URL(c.url).hostname.split(".").slice(-2).join("."); } catch { /* skip */ }
      if (openHosts.has(host)) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = c.name;
      b.style.cssText = "flex:0 0 auto;min-height:40px;padding:0 10px;border-radius:999px;border:2px solid #8c4a2f;background:#fffcf6";
      b.onclick = () => openTab(c.url, c.name);
      chips.appendChild(b);
    }
  };
  const openTab = (url, title) => {
    const row = list();
    let t = row.find((x) => x.url === url);
    if (!t) {
      if (row.length >= MAX) return;
      t = { id: "t" + Date.now().toString(36), url, title: title || url, star: row.length === 0 };
      row.push(t);
    }
    active = t.id;
    shown = true;
    sheet.hidden = false;
    frame.src = url;
    urlInput.value = url;
    save(tabs);
    paint();
  };
  sheet.querySelector("#wc-back").onclick = () => { shown = false; sheet.hidden = true; };
  sheet.querySelector("#wc-out").onclick = () => { if (urlInput.value) origOpen(urlInput.value, "_blank", "noopener"); };
  sheet.querySelector("#wc-go").onsubmit = (e) => {
    e.preventDefault();
    let v = urlInput.value.trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v)) {
      v = v.includes(".") && !v.includes(" ") ? "https://" + v : (localStorage.getItem("wc.search") === "google"
        ? "https://www.google.com/search?q="
        : localStorage.getItem("wc.search") === "bing"
          ? "https://www.bing.com/search?q="
          : "https://duckduckgo.com/?q=") + encodeURIComponent(v);
    }
    openTab(v);
  };
  window.addEventListener("wc-open", (e) => openTab(e.detail.url));
  const mountWebButton = () => {
    if (document.getElementById("wc-web-btn")) return;
    const host = document.getElementById("palette-open");
    if (!host || !host.parentElement) return;
    const b = document.createElement("button");
    b.id = "wc-web-btn";
    b.type = "button";
    b.className = "hbtn";
    b.textContent = "Web";
    b.title = "This station's web tabs";
    b.addEventListener("click", () => window.wcPhoneWeb?.());
    host.parentElement.insertBefore(b, host);
  };
  setInterval(mountWebButton, 500);
  window.wcPhoneWeb = () => {
    const row = list();
    if (!row.length) {
      shown = true;
      sheet.hidden = false;
      paint();
      urlInput.focus();
      return;
    }
    shown = !shown;
    sheet.hidden = !shown;
    if (shown) {
      const t = row.find((x) => x.id === active) || row.find((x) => x.star) || row[0];
      active = t.id;
      frame.src = t.url;
      urlInput.value = t.url;
      paint();
    }
  };
}
