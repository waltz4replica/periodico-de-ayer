"use strict";

/* ============================================================
   Mi Periódico — lector de noticias diario
   Lee las ediciones que genera scripts/fetch_news.py en data/

   Páginas (en la dirección, para que funcione el botón «atrás»):
     #/                portada por bloques
     #/s/<categoría>   una sección
     #/guardadas       noticias guardadas
     #/medios          lista de medios y su orientación
     #/medio/<id>      noticias de un medio
     #/etiquetas       cómo leer la orientación y las etiquetas
     #/ajustes         ajustes
   ============================================================ */

const PAGE = 24;
const TZ = "Europe/Madrid";

const $ = (sel) => document.querySelector(sel);
const els = {
  page: $("#page"),
  sentinel: $("#sentinel"),
  appbarTitle: $("#appbar-title"),
  tabbar: $("#tabbar"),
  btnMenu: $("#btn-menu"),
  drawer: $("#drawer"),
  drawerBody: $("#drawer-body"),
  drawerDate: $("#drawer-date"),
  sheet: $("#sheet"),
  sheetTitle: $("#sheet-title"),
  sheetBody: $("#sheet-body"),
  sheetFoot: $("#sheet-foot"),
  search: $("#search"),
  searchInput: $("#search-input"),
  searchClose: $("#search-close"),
  btnSearch: $("#btn-search"),
  toast: $("#toast"),
  toastText: $("#toast-text"),
  toastAction: $("#toast-action"),
  install: $("#install"),
  installText: $("#install-text"),
  installBtn: $("#install-btn"),
  installClose: $("#install-close"),
};

/* ---------- almacenamiento local (con tolerancia a fallos) ---------- */

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin espacio o modo privado */ }
  },
};

const DEFAULT_SETTINGS = { zoom: 1, english: true, hideAds: true };

const state = {
  index: null,
  day: null,            // "AAAA-MM-DD"
  edition: null,        // { date, updated, items }
  route: { name: "home" },
  filters: { source: "all", lean: "all", kind: "all" },
  query: "",
  list: [],
  shown: 0,
  lead: true,
  lastCheck: 0,
  settings: { ...DEFAULT_SETTINGS, ...store.get("settings", {}) },
};

let saved = store.get("saved", {});        // id -> noticia

/* Lo que la persona ha pedido no ver («No me interesa») */
let muted = { dismissed: {}, terms: [], sources: [], allow: [], labels: {}, ...store.get("muted", {}) };
const termLabel = (t) => muted.labels?.[t] || t;
function saveMuted() {
  store.set("muted", muted);
  reasonCache = { edition: null, map: new Map() };
}
let read = new Set(store.get("read", []));  // ids leídas

function markRead(id) {
  if (read.has(id)) return;
  read.add(id);
  store.set("read", [...read].slice(-1500));
}

/* ---------- formato de fechas ---------- */

const fmtLong = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const fmtDay = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
const fmtChip = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", timeZone: TZ });
const fmtTime = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const fmtShort = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });
const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // AAAA-MM-DD
const fromKey = (k) => new Date(`${k}T12:00:00Z`);
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const normalize = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function relTime(iso) {
  const date = new Date(iso);
  const mins = Math.round((Date.now() - date) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return rtf.format(-mins, "minute");
  if (mins < 60 * 12) return rtf.format(-Math.round(mins / 60), "hour");
  return fmtShort.format(date);
}

function dayLabel(key, long = false) {
  if (key === dayKey(new Date())) return "Hoy";
  if (key === dayKey(new Date(Date.now() - 864e5))) return "Ayer";
  return capitalize((long ? fmtDay : fmtChip).format(fromKey(key)).replace(".", ""));
}

/* ---------- utilidades de pintado ---------- */

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

function svg(path, cls) {
  const wrap = document.createElement("span");
  wrap.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ""}>${path}</svg>`;
  return wrap.firstChild;
}

const ICONS = {
  home: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M7 9h7M7 12.5h7M7 16h4"/>',
  politica: '<path d="M3 9.5 12 4l9 5.5M5.5 10.5v7M9.8 10.5v7M14.2 10.5v7M18.5 10.5v7M3.5 20h17"/>',
  tecnologia: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5"/>',
  videojuegos: '<path d="M7.5 8h9a4.5 4.5 0 0 1 4.3 5.8l-1 3.4a2 2 0 0 1-3.4.8L14.5 16h-5l-1.9 2a2 2 0 0 1-3.4-.8l-1-3.4A4.5 4.5 0 0 1 7.5 8z"/><path d="M8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01"/>',
  guardadas: '<path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/>',
  hemeroteca: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  medios: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  etiquetas: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  ajustes: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  filtro: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
  ocultas: '<path d="M3.5 3.5l17 17M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 8.4 4.2 9.4 6-.4.8-1.3 2-2.5 3.2M6.4 7.7C4.5 9 3.1 11 2.6 12c1 1.8 4.4 6 9.4 6 1.7 0 3.2-.5 4.5-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};

/* ---------- datos ---------- */

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const sourceById = (id) => state.index?.sources.find((s) => s.id === id) || { id, name: id };

const FALLBACK_CATS = {
  actualidad: "Actualidad", politica: "Política", tecnologia: "Tecnología", ia: "IA",
  ciberseguridad: "Ciberseguridad", brechas: "Data breaches", leaks: "Leaks", videojuegos: "Videojuegos",
  moviles: "Móviles y gadgets", internacional: "Internacional", economia: "Economía", deportes: "Deportes",
};
const catById = (id) => state.index?.categories?.find((c) => c.id === id) || { id, name: FALLBACK_CATS[id] || id };
const catName = (id) => (id === "all" ? "Todas las noticias" : catById(id).name);
const childrenOf = (id) => (state.index?.categories || []).filter((c) => c.parent === id);

/** Categorías de una noticia (las ediciones antiguas no las traen: usamos la de su fuente). */
function catsOf(it) {
  if (it.cats) return it.cats;
  const src = sourceById(it.source);
  return Array.isArray(src.category) ? src.category : src.category ? [src.category] : [];
}
const inCat = (it, cat) => cat === "all" || catsOf(it).includes(cat);

/* ---------- noticias ocultas ---------- */

const AD_KINDS = { patrocinado: "Publicidad", oferta: "Oferta o chollo", menor: "Poco relevante" };

let reasonCache = { edition: null, map: new Map() };

/** Motivo por el que una noticia se oculta, o "" si se muestra. */
function hiddenReason(it) {
  if (reasonCache.edition !== state.edition) reasonCache = { edition: state.edition, map: new Map() };
  const cache = reasonCache.map;
  if (cache.has(it.id)) return cache.get(it.id);
  let reason = "";
  if (muted.dismissed[it.id]) reason = "No te interesa";
  else if (muted.allow.includes(it.id)) reason = "";
  else if (state.settings.hideAds && AD_KINDS[it.kind]) reason = AD_KINDS[it.kind];
  else if (muted.sources.includes(it.source)) reason = `Medio silenciado: ${sourceById(it.source).name}`;
  else {
    const tok = tokens(it.title);
    const term = muted.terms.find((t) => tok.has(t));
    if (term) reason = `Tema silenciado: ${termLabel(term)}`;
    else {
      for (const d of Object.values(muted.dismissed)) {
        const dt = tokens(d.title);
        let shared = 0;
        for (const w of tok) if (dt.has(w)) shared++;
        if (shared >= 3 && shared / Math.min(tok.size, dt.size || 1) >= 0.5) { reason = "Parecida a una que ocultaste"; break; }
      }
    }
  }
  cache.set(it.id, reason);
  return reason;
}

const langOk = (i) => state.settings.english || (sourceById(i.source).lang || "es") === "es";

/** Noticias de la edición que se pueden mostrar según los ajustes y lo silenciado. */
function visibleItems() {
  return (state.edition?.items || []).filter((i) => langOk(i) && !hiddenReason(i));
}

const hiddenItems = () => (state.edition?.items || []).filter((i) => langOk(i) && hiddenReason(i));

/** Palabras del titular que se pueden silenciar, primero nombres propios: [normalizada, tal cual]. */
function suggestTerms(title) {
  const words = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const proper = words.slice(1).filter((w) => /^\p{Lu}/u.test(w));
  const rest = words.filter((w) => !proper.includes(w)).sort((a, b) => b.length - a.length);
  const out = [];
  for (const w of [...proper, ...rest]) {
    const n = normalize(w);
    if (n.length > 3 && !STOP.has(n) && !out.some(([x]) => x === n)) out.push([n, w]);
    if (out.length === 3) break;
  }
  return out;
}

function openDismissSheet(it, node) {
  const src = sourceById(it.source);
  const done = (msg, undo) => {
    saveMuted();
    els.sheet.close();
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    toast(msg, { label: "Deshacer", run: () => { undo(); saveMuted(); render(); window.scrollTo(0, y); } });
  };
  const option = (label, hint, run) => el("button", { class: "option", onclick: run },
    el("span", {}, label, hint ? el("small", {}, hint) : null));

  openSheet("No me interesa", [
    el("p", { class: "sheet-note" }, "Lo que ocultes queda guardado en «Ocultas», en el menú, por si quieres recuperarlo."),
    el("div", { class: "option-list" },
      option("Ocultar esta noticia", "También se ocultarán las que cuenten lo mismo", () => {
        muted.dismissed[it.id] = { id: it.id, title: it.title, source: it.source, link: it.link, date: it.date };
        const ids = Object.keys(muted.dismissed);
        if (ids.length > 400) delete muted.dismissed[ids[0]];
        done("Noticia ocultada", () => { delete muted.dismissed[it.id]; });
      }),
      ...suggestTerms(it.title).map(([term, label]) => option(`Menos sobre «${label}»`, "Oculta las noticias con esta palabra en el titular", () => {
        muted.terms.push(term);
        muted.labels = { ...muted.labels, [term]: label };
        done(`Ocultaremos noticias sobre «${label}»`, () => { muted.terms = muted.terms.filter((t) => t !== term); });
      })),
      option(`Menos de ${src.name}`, "Oculta todas las noticias de este medio", () => {
        muted.sources.push(it.source);
        done(`Ocultaremos ${src.name}`, () => { muted.sources = muted.sources.filter((s) => s !== it.source); });
      })),
  ]);
}

const countIn = (cat) => visibleItems().filter((i) => inCat(i, cat)).length;

async function loadIndex() {
  state.index = await getJSON("data/index.json");
  state.lastCheck = Date.now();
}

async function loadDay(key) {
  state.day = key;
  state.edition = null;
  renderSkeleton();
  try {
    state.edition = await getJSON(`data/${key}.json`);
  } catch {
    state.edition = { date: key, items: [] };
  }
  render();
}

/* ---------- orientación de los medios ---------- */

const LEANS = [
  { id: "izquierda", name: "Izquierda" },
  { id: "centroizquierda", name: "Centroizquierda" },
  { id: "centro", name: "Centro" },
  { id: "centroderecha", name: "Centroderecha" },
  { id: "derecha", name: "Derecha" },
];
const leanPos = (id) => LEANS.findIndex((l) => l.id === id);
const leanName = (id) => LEANS.find((l) => l.id === id)?.name || "";
const LEAN_CATS = new Set(["politica", "actualidad", "all"]);
const TYPE_TAGS = { propaganda: "Propaganda", publico: "Medio público", agencia: "Agencia" };
const KIND_TAGS = { opinion: "Opinión", patrocinado: "Patrocinado", oferta: "Oferta", menor: "Poco relevante" };

function leanBar(src, mini = false) {
  if (!src.lean) return null;
  const pos = leanPos(src.lean);
  const label = `${src.name}: ${leanName(src.lean).toLowerCase()}` +
    (src.lean_basis === "estimacion" ? " (estimación)" : " (según estudios de audiencia)");
  return el("span", { class: "lean-bar" + (mini ? " mini" : ""), role: "img", "aria-label": label, title: label },
    ...LEANS.map((_, i) => el("i", { class: i === pos ? "on" : null })));
}

const leanSwatch = (id) => el("span", { class: "lean-bar mini", "aria-hidden": "true" },
  ...LEANS.map((_, i) => el("i", { class: i === leanPos(id) ? "on" : null })));

/* Agrupa titulares parecidos de distintos medios («Cómo lo cuentan otros») */
const STOP = new Set(("para como tras sobre entre desde hasta este esta estos estas pero porque cuando donde " +
  "todo todos toda todas anos dice segun hace puede sera sido tiene tienen nuevo nueva ante contra solo " +
  "mas menos muy otra otro otros otras cada ahora hacer hecho ser estan esta fue han hay sus del las los una " +
  "unos unas que con por sin les nos asi aunque mientras como quien cual").split(" "));

const tokens = (title) =>
  new Set(normalize(title).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 3 && !STOP.has(w)));

let versionsCache = { edition: null, map: new Map() };
function versionsOf(it) {
  if (versionsCache.edition !== state.edition) {
    const pool = (state.edition?.items || [])
      .filter((i) => catsOf(i).includes("politica") && sourceById(i.source).lean && i.kind !== "patrocinado")
      .map((i) => ({ it: i, tok: tokens(i.title) }));
    const map = new Map();
    for (const a of pool) {
      const matches = [];
      for (const b of pool) {
        if (a === b || a.it.source === b.it.source) continue;
        let shared = 0;
        for (const w of a.tok) if (b.tok.has(w)) shared++;
        const score = shared / Math.min(a.tok.size, b.tok.size || 1);
        if (shared >= 3 && score >= 0.45) matches.push({ it: b.it, score });
      }
      // Una versión por medio, priorizando orientaciones distintas a la del original
      matches.sort((x, y) => y.score - x.score);
      const bySource = new Map();
      for (const m of matches) if (!bySource.has(m.it.source)) bySource.set(m.it.source, m.it);
      const own = leanPos(sourceById(a.it.source).lean);
      const dist = (x) => Math.abs(leanPos(sourceById(x.source).lean) - own);
      const list = [...bySource.values()].sort((x, y) => dist(y) - dist(x)).slice(0, 4);
      if (list.length) map.set(a.it.id, list);
    }
    versionsCache = { edition: state.edition, map };
  }
  return versionsCache.map.get(it.id) || [];
}

/* ---------- tarjeta de noticia ---------- */

function storyNode(it, { lead = false, compact = false, versions = true, hidden = false } = {}) {
  const src = sourceById(it.source);
  const isSaved = Boolean(saved[it.id]);
  const hasImg = Boolean(it.image);
  const tags = [
    src.type === "propaganda" ? el("span", { class: "tag propaganda" }, TYPE_TAGS.propaganda) : null,
    KIND_TAGS[it.kind] ? el("span", { class: "tag " + it.kind }, KIND_TAGS[it.kind]) : null,
  ].filter(Boolean);

  const img = hasImg
    ? el("img", {
        class: "thumb", src: it.image, alt: "", loading: lead ? "eager" : "lazy",
        decoding: "async", referrerpolicy: "no-referrer",
        onerror: (e) => { e.target.closest(".story")?.classList.add("no-img"); e.target.remove(); },
      })
    : null;

  const saveBtn = el("button", {
    class: "icon-btn small save",
    "aria-label": isSaved ? "Quitar de guardadas" : "Guardar noticia",
    "aria-pressed": String(isSaved),
    onclick: (e) => { e.preventDefault(); toggleSave(it, e.currentTarget); },
  }, svg(ICONS.guardadas));

  const dismissBtn = hidden ? null : el("button", {
    class: "icon-btn small dismiss", "aria-label": "No me interesa",
    onclick: (e) => { e.preventDefault(); openDismissSheet(it, e.currentTarget.closest(".story")); },
  }, svg(ICONS.ocultas));

  const reasonRow = hidden ? el("div", { class: "hidden-reason" },
    el("span", {}, hiddenReason(it)),
    el("button", {
      class: "btn ghost small", onclick: () => {
        if (muted.dismissed[it.id]) delete muted.dismissed[it.id];
        else muted.allow = [...muted.allow.slice(-300), it.id];
        saveMuted();
        render();
        toast("Volverá a aparecer en su sección");
      },
    }, "Volver a mostrar")) : null;

  const link = el("a", {
    href: it.link, target: "_blank", rel: "noopener noreferrer",
    onclick: () => { markRead(it.id); link.closest(".story")?.classList.add("read"); },
  },
    el("div", { class: "meta" },
      el("span", { class: "source", style: src.color ? `--c:${src.color}` : null }, src.name),
      src.lang && src.lang !== "es" ? el("span", { class: "lang", title: "Noticia en inglés" }, src.lang) : null,
      leanBar(src),
      el("span", {}, "·"),
      el("time", { datetime: it.date }, relTime(it.date))),
    tags.length ? el("div", { class: "tags" }, tags) : null,
    el("h2", {}, it.title),
    it.summary && it.summary.length >= 25 && !compact ? el("p", {}, it.summary) : null,
    img);

  const vers = versions && !compact ? versionsOf(it) : [];
  const others = vers.length
    ? el("div", { class: "versions" },
        el("span", { class: "versions-label" }, "Cómo lo cuentan otros:"),
        ...vers.map((v) => {
          const vs = sourceById(v.source);
          return el("a", {
            href: v.link, target: "_blank", rel: "noopener noreferrer", title: v.title,
            onclick: () => markRead(v.id),
          }, leanBar(vs), vs.name);
        }))
    : null;

  return el("article", {
    class: ["story", lead && "lead", compact && "compact", !hasImg && "no-img", read.has(it.id) && "read"]
      .filter(Boolean).join(" "),
  }, link, others, reasonRow, dismissBtn, saveBtn);
}

/** Alterna medios para que ninguno acapare la lista; la primera con foto va de destacada. */
function mixSources(items, withLead = true) {
  const buckets = new Map();
  for (const it of items) {
    if (!buckets.has(it.source)) buckets.set(it.source, []);
    buckets.get(it.source).push(it);
  }
  const queues = [...buckets.values()];
  const out = [];
  for (let round = 0; out.length < items.length; round++) {
    const batch = queues.map((q) => q[round]).filter(Boolean);
    batch.sort((a, b) => b.date.localeCompare(a.date));
    out.push(...batch);
  }
  if (withLead) {
    const leadIdx = out.findIndex((i) => i.image);
    if (leadIdx > 0) out.unshift(...out.splice(leadIdx, 1));
  }
  return out;
}

/* ---------- navegación ---------- */

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  switch (parts[0]) {
    case "s": return { name: "section", cat: parts[1] || "all" };
    case "guardadas": return { name: "saved" };
    case "medios": return { name: "sources" };
    case "medio": return { name: "source", source: parts[1] };
    case "etiquetas": return { name: "labels" };
    case "ajustes": return { name: "settings" };
    case "ocultas": return { name: "hidden" };
    default: return { name: "home" };
  }
}

const routeKey = (r) => [r.name, r.cat, r.source].filter(Boolean).join("/");
const go = (hash) => { if (location.hash !== hash) location.hash = hash; else render(); };

window.addEventListener("hashchange", () => {
  const next = parseRoute();
  if (routeKey(next) !== routeKey(state.route)) state.filters = { source: "all", lean: "all", kind: "all" };
  state.route = next;
  closeDialogs();
  render();
  window.scrollTo(0, 0);
});

const TABS = [
  { id: "home", label: "Portada", hash: "#/", icon: ICONS.home },
  { id: "politica", label: "Política", hash: "#/s/politica", icon: ICONS.politica },
  { id: "tecnologia", label: "Tecnología", hash: "#/s/tecnologia", icon: ICONS.tecnologia },
  { id: "videojuegos", label: "Juegos", hash: "#/s/videojuegos", icon: ICONS.videojuegos },
  { id: "saved", label: "Guardadas", hash: "#/guardadas", icon: ICONS.guardadas },
];

function activeTab() {
  const r = state.route;
  if (r.name === "home" || r.name === "saved") return r.name;
  if (r.name !== "section") return null;
  if (r.cat === "politica" || r.cat === "videojuegos") return r.cat;
  if (r.cat === "tecnologia" || catById(r.cat).parent === "tecnologia") return "tecnologia";
  return null;
}

function renderTabbar() {
  const active = activeTab();
  const n = Object.keys(saved).length;
  els.tabbar.replaceChildren(...TABS.map((t) =>
    el("a", { href: t.hash, class: "tab", "aria-current": t.id === active ? "page" : null },
      svg(t.icon),
      el("span", {}, t.label),
      t.id === "saved" && n ? el("span", { class: "badge" }, n > 99 ? "99+" : String(n)) : null)));
}

const NAV_GROUPS = [
  { title: "Noticias", items: ["home", "actualidad", "politica", "internacional", "economia", "deportes"] },
  { title: "Tecnología", items: ["tecnologia", "ia", "ciberseguridad", "brechas", "leaks", "moviles", "videojuegos"] },
];

function renderDrawer() {
  const r = state.route;
  const current = r.name === "section" ? r.cat : r.name;
  els.drawerDate.textContent = state.day ? capitalize(fmtLong.format(fromKey(state.day))) : "";
  const item = (id, label, hash, opts = {}) => el("a", {
    href: hash, class: "drawer-item" + (opts.sub ? " sub" : ""), "aria-current": id === current ? "page" : null,
  }, opts.icon ? svg(opts.icon) : null, el("span", {}, label),
    opts.count != null ? el("span", { class: "count" }, String(opts.count)) : null);

  const groups = NAV_GROUPS.map((g) => el("section", {},
    el("h3", {}, g.title),
    ...g.items.map((id) => id === "home"
      ? item("home", "Portada", "#/")
      : item(id, catName(id), `#/s/${id}`, { count: countIn(id), sub: catById(id).parent === "tecnologia" }))));

  const mine = el("section", {},
    el("h3", {}, "Tu periódico"),
    item("saved", "Guardadas", "#/guardadas", { icon: ICONS.guardadas, count: Object.keys(saved).length }),
    el("button", { class: "drawer-item", onclick: openDaySheet },
      svg(ICONS.hemeroteca), el("span", {}, "Hemeroteca"), el("span", { class: "count" }, dayLabel(state.day || dayKey(new Date())))),
    item("sources", "Medios y fuentes", "#/medios", { icon: ICONS.medios }),
    item("labels", "Cómo leer las etiquetas", "#/etiquetas", { icon: ICONS.etiquetas }),
    item("settings", "Ajustes", "#/ajustes", { icon: ICONS.ajustes }),
    item("hidden", "Ocultas", "#/ocultas", { icon: ICONS.ocultas, count: hiddenItems().length }));

  els.drawerBody.replaceChildren(...groups, mine);
}

function openDrawer() {
  renderDrawer();
  els.drawer.showModal?.();
}

function closeDialogs() {
  for (const d of [els.drawer, els.sheet]) if (d.open) d.close();
}

for (const d of [els.drawer, els.sheet]) {
  d.addEventListener("click", (e) => {
    // Cerrar al tocar fuera del panel o en un botón de cierre
    if (e.target === d || e.target.closest("[data-close]")) d.close();
  });
}
els.drawerBody.addEventListener("click", (e) => { if (e.target.closest("a")) els.drawer.close(); });

/* ---------- hojas inferiores ---------- */

function openSheet(title, body, foot) {
  els.sheetTitle.textContent = title;
  els.sheetBody.replaceChildren(...body);
  els.sheetFoot.replaceChildren(...(foot || []));
  els.sheetFoot.hidden = !foot?.length;
  if (els.drawer.open) els.drawer.close();
  if (!els.sheet.open) els.sheet.showModal?.();
}

function openDaySheet() {
  const days = state.index?.days || [];
  openSheet("Hemeroteca", [
    el("p", { class: "sheet-note" }, `Se guardan las ediciones de los últimos ${days.length} días.`),
    el("div", { class: "day-list" }, ...days.map((d) =>
      el("button", {
        class: "day-item", "aria-pressed": String(d.date === state.day),
        onclick: () => { els.sheet.close(); if (d.date !== state.day) loadDay(d.date).then(() => window.scrollTo(0, 0)); },
      }, el("span", {}, dayLabel(d.date, true)), el("span", { class: "count" }, `${d.count} noticias`)))),
  ]);
}

function sectionBase() {
  const r = state.route;
  if (r.name === "source") return visibleItems().filter((i) => i.source === r.source);
  return visibleItems().filter((i) => inCat(i, r.cat || "all"));
}

function applyFilters(items) {
  const f = state.filters;
  if (f.source !== "all") items = items.filter((i) => i.source === f.source);
  if (f.lean !== "all") items = items.filter((i) => sourceById(i.source).lean === f.lean);
  if (f.kind === "info") items = items.filter((i) => !i.kind);
  if (f.kind === "opinion") items = items.filter((i) => i.kind === "opinion");
  return items;
}

const activeFilterCount = () => Object.values(state.filters).filter((v) => v !== "all").length;

function openFilterSheet() {
  const base = sectionBase();
  const f = { ...state.filters };
  const showLean = LEAN_CATS.has(state.route.cat) && base.some((i) => sourceById(i.source).lean);
  const hasOpinion = base.some((i) => i.kind === "opinion");

  const countFor = (draft) => {
    const keep = state.filters;
    state.filters = draft;
    const n = applyFilters(base).length;
    state.filters = keep;
    return n;
  };

  const group = (title, key, options) => el("fieldset", { class: "filter-group" },
    el("legend", {}, title),
    el("div", { class: "chips wrap" }, ...options.map(([id, label, extra]) =>
      el("button", {
        class: "chip", type: "button", "aria-pressed": String(f[key] === id),
        onclick: (e) => {
          f[key] = id;
          for (const b of e.currentTarget.parentElement.children) b.setAttribute("aria-pressed", String(b === e.currentTarget));
          apply.textContent = `Ver ${countFor(f)} noticias`;
        },
      }, extra || null, label))));

  const sourceCounts = new Map();
  for (const it of base) sourceCounts.set(it.source, (sourceCounts.get(it.source) || 0) + 1);
  const sources = (state.index?.sources || []).filter((s) => sourceCounts.has(s.id))
    .sort((a, b) => sourceCounts.get(b.id) - sourceCounts.get(a.id));
  const presentLeans = new Set(base.map((i) => sourceById(i.source).lean).filter(Boolean));

  const apply = el("button", {
    class: "btn wide", onclick: () => { state.filters = f; els.sheet.close(); render(); window.scrollTo(0, 0); },
  }, `Ver ${countFor(f)} noticias`);
  const reset = el("button", {
    class: "btn ghost", onclick: () => {
      state.filters = { source: "all", lean: "all", kind: "all" };
      els.sheet.close(); render();
    },
  }, "Quitar filtros");

  openSheet("Filtrar", [
    showLean ? group("Orientación del medio", "lean", [["all", "Todas"],
      ...LEANS.filter((l) => presentLeans.has(l.id)).map((l) => [l.id, l.name, leanSwatch(l.id)])]) : null,
    hasOpinion ? group("Tipo de contenido", "kind", [["all", "Todo"], ["info", "Solo información"], ["opinion", "Solo opinión"]]) : null,
    group("Medio", "source", [["all", "Todos"],
      ...sources.map((s) => [s.id, `${s.name} · ${sourceCounts.get(s.id)}`,
        el("span", { class: "dot", style: `--c:${s.color || "var(--ink-3)"}` })])]),
  ].filter(Boolean), [reset, apply]);
}

/* ---------- páginas ---------- */

function renderSkeleton() {
  els.page.replaceChildren(el("div", { class: "list" }, ...Array.from({ length: 6 }, () => el("div", { class: "skeleton" }))));
}

const emptyNode = (title, text) => el("div", { class: "empty" }, el("h2", {}, title), el("p", {}, text));

function editionBar() {
  const key = state.day || dayKey(new Date());
  const updated = state.index ? new Date(state.index.updated) : null;
  return el("div", { class: "edition-bar" },
    el("button", { class: "edition-date", onclick: openDaySheet, "aria-label": "Cambiar de día (hemeroteca)" },
      capitalize(fmtLong.format(fromKey(key))), svg(ICONS.down)),
    updated && key === dayKey(new Date())
      ? el("span", { class: "edition-updated" }, `Actualizado a las ${fmtTime.format(updated)}`)
      : null);
}

function pageHome() {
  const all = visibleItems();
  const used = new Set();
  const usedTokens = [];
  // Evita repetir en la portada la misma noticia contada por dos medios
  const similar = (tok) => usedTokens.some((u) => {
    let shared = 0;
    for (const w of tok) if (u.has(w)) shared++;
    return shared >= 3 && shared / Math.min(tok.size, u.size || 1) >= 0.5;
  });
  const take = (items, n) => {
    const out = [];
    for (const it of items) {
      if (out.length >= n) break;
      if (used.has(it.id)) continue;
      const tok = tokens(it.title);
      if (similar(tok)) continue;
      used.add(it.id);
      usedTokens.push(tok);
      out.push(it);
    }
    return out;
  };

  const general = mixSources(all.filter((i) => inCat(i, "actualidad") || inCat(i, "politica")));
  const lead = take(general.filter((i) => i.image && !i.kind), 1);
  const latest = take(general.filter((i) => !i.kind), 4);

  const BLOCKS = ["politica", "internacional", "economia", "tecnologia", "ciberseguridad", "videojuegos", "deportes"];
  const blocks = BLOCKS.map((cat) => {
    const items = all.filter((i) => inCat(i, cat));
    const picks = take(mixSources(items, false), 3);
    if (!picks.length) return null;
    return el("section", { class: "block" },
      el("a", { class: "block-head", href: `#/s/${cat}` },
        el("h2", {}, catName(cat)), svg(ICONS.chevron)),
      el("div", { class: "list" }, ...picks.map((it) => storyNode(it, { compact: true }))),
      el("a", { class: "block-more", href: `#/s/${cat}` }, `Ver las ${items.length} noticias de ${catName(cat)}`));
  }).filter(Boolean);

  const opinion = take(mixSources(all.filter((i) => i.kind === "opinion"), false), 3);

  if (!all.length) return [editionBar(), emptyNode("Edición vacía", "No hay noticias para este día.")];

  return [
    el("div", { class: "masthead" },
      el("p", { class: "masthead-title" }, "Mi Periódico"), editionBar()),
    el("div", { class: "list" },
      ...lead.map((it) => storyNode(it, { lead: true })),
      ...latest.map((it) => storyNode(it, { compact: true }))),
    ...blocks,
    opinion.length ? el("section", { class: "block" },
      el("div", { class: "block-head" }, el("h2", {}, "Opinión")),
      el("div", { class: "list" }, ...opinion.map((it) => storyNode(it, { compact: true })))) : null,
    el("a", { class: "block-more all", href: "#/s/all" }, `Ver todas las noticias (${all.length})`),
  ];
}

function filterPills() {
  const f = state.filters;
  const pill = (label, key) => el("button", {
    class: "pill", onclick: () => { state.filters[key] = "all"; render(); },
    "aria-label": `Quitar filtro ${label}`,
  }, label, svg(ICONS.close));
  const pills = [
    f.lean !== "all" ? pill(leanName(f.lean), "lean") : null,
    f.kind !== "all" ? pill(f.kind === "info" ? "Solo información" : "Solo opinión", "kind") : null,
    f.source !== "all" ? pill(sourceById(f.source).name, "source") : null,
  ].filter(Boolean);
  return pills.length ? el("div", { class: "pills" }, ...pills) : null;
}

function subnav(cat) {
  // Subsecciones: dentro de Tecnología (o de una de sus hijas) mostramos todas sus hermanas
  const parent = childrenOf(cat).length ? cat : catById(cat).parent;
  if (!parent) return null;
  const kids = childrenOf(parent).filter((c) => countIn(c.id));
  if (!kids.length) return null;
  const chip = (id, label) => el("a", {
    class: "chip", href: `#/s/${id}`, "aria-current": id === cat ? "page" : null,
  }, label);
  const nav = el("nav", { class: "chips subnav", "aria-label": `Apartados de ${catName(parent)}` },
    chip(parent, "Todo"), ...kids.map((c) => chip(c.id, c.name)));
  requestAnimationFrame(() => nav.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" }));
  return nav;
}

function listPage(title, base, { lead = true, intro = null, sub = null, filters = true } = {}) {
  const items = applyFilters(base);
  state.list = activeFilterCount() || !lead ? items : mixSources(items);
  state.lead = lead && !activeFilterCount();
  const n = activeFilterCount();
  const head = el("div", { class: "section-head" },
    el("div", { class: "section-title-row" },
      el("h2", { class: "section-title" }, title),
      filters && base.length ? el("button", {
        class: "filter-btn" + (n ? " on" : ""), onclick: openFilterSheet,
      }, svg(ICONS.filtro), n ? `Filtros · ${n}` : "Filtrar") : null),
    editionBar());
  return [head, sub, intro, filterPills(),
    el("div", { class: "list", id: "list" }),
    !items.length ? emptyNode("No hay noticias", n ? "Prueba a quitar algún filtro." : "No hay noticias de esta sección en este día.") : null];
}

function pageSection() {
  const cat = state.route.cat;
  return listPage(catName(cat), sectionBase(), { sub: subnav(cat) });
}

function pageSource() {
  const src = sourceById(state.route.source);
  const intro = el("p", { class: "section-intro row" },
    src.lean ? el("span", { class: "intro-lean" }, leanBar(src), leanName(src.lean) +
      (src.lean_basis === "estimacion" ? " (estimación)" : " (según estudios)")) : null,
    TYPE_TAGS[src.type] ? el("span", { class: "tag " + src.type }, TYPE_TAGS[src.type]) : null,
    src.lang && src.lang !== "es" ? el("span", { class: "lang" }, src.lang) : null);
  return listPage(src.name, sectionBase(), { intro });
}

function pageSaved() {
  const items = Object.values(saved).sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
  state.list = items;
  state.lead = false;
  return [
    el("div", { class: "section-head" }, el("h2", { class: "section-title" }, "Guardadas")),
    el("div", { class: "list", id: "list" }),
    !items.length ? emptyNode("Nada guardado todavía", "Pulsa el marcador de una noticia para leerla más tarde.") : null,
  ];
}

function pageSearch() {
  const words = normalize(state.query).split(/\s+/).filter(Boolean);
  const items = visibleItems().filter((i) => {
    const hay = normalize(`${i.title} ${i.summary} ${sourceById(i.source).name}`);
    return words.every((w) => hay.includes(w));
  });
  state.list = items;
  state.lead = false;
  return [
    el("div", { class: "section-head" },
      el("h2", { class: "section-title" }, "Buscar"),
      el("p", { class: "section-intro" }, items.length
        ? `${items.length} noticias con «${state.query}» en la edición de ${dayLabel(state.day).toLowerCase()}`
        : "")),
    el("div", { class: "list", id: "list" }),
    !items.length ? emptyNode("Sin resultados", `No hay noticias con «${state.query}» en esta edición.`) : null,
  ];
}

const SOURCE_GROUPS = [
  { title: "Periódicos y agencias", cats: ["actualidad", "politica", "internacional", "economia", "deportes"] },
  { title: "Tecnología", cats: ["tecnologia", "ia", "moviles"] },
  { title: "Ciberseguridad y data breaches", cats: ["ciberseguridad", "brechas", "leaks"] },
  { title: "Videojuegos", cats: ["videojuegos"] },
];

function pageSources() {
  const sources = state.index?.sources || [];
  const counts = new Map();
  for (const it of state.edition?.items || []) counts.set(it.source, (counts.get(it.source) || 0) + 1);
  const placed = new Set();
  const groups = SOURCE_GROUPS.map((g) => {
    const list = sources.filter((s) => !placed.has(s.id) && (s.category || []).some((c) => g.cats.includes(c)));
    list.forEach((s) => placed.add(s.id));
    list.sort((a, b) => ((leanPos(a.lean) + 1 || 9) - (leanPos(b.lean) + 1 || 9)) || a.name.localeCompare(b.name));
    if (!list.length) return null;
    return el("section", { class: "block" },
      el("div", { class: "block-head" }, el("h2", {}, g.title)),
      el("ul", { class: "source-list" }, ...list.map((s) => {
        const n = counts.get(s.id) || 0;
        return el("li", {}, el("a", { href: `#/medio/${encodeURIComponent(s.id)}` },
          el("span", { class: "dot", style: `--c:${s.color || "var(--ink-3)"}` }),
          el("span", { class: "source-name" }, s.name,
            el("small", {}, n ? `${n} noticias en esta edición` : "Sin noticias en esta edición",
              s.ok === false ? " · no respondió en la última actualización" : "")),
          s.lang && s.lang !== "es" ? el("span", { class: "lang" }, s.lang) : null,
          s.lean ? leanBar(s) : TYPE_TAGS[s.type] ? el("span", { class: "tag " + s.type }, TYPE_TAGS[s.type]) : null,
          svg(ICONS.chevron)));
      })));
  }).filter(Boolean);
  return [
    el("div", { class: "section-head" },
      el("h2", { class: "section-title" }, "Medios y fuentes"),
      el("p", { class: "section-intro" }, `${sources.length} fuentes. La barrita indica la orientación aproximada del medio. `,
        el("a", { href: "#/etiquetas" }, "Cómo se ha calculado"))),
    ...groups,
  ];
}

function pageLabels() {
  const sources = (state.index?.sources || []).filter((s) => s.lean || s.type === "publico" || s.type === "propaganda");
  sources.sort((a, b) => ((leanPos(a.lean) + 1 || 9) - (leanPos(b.lean) + 1 || 9)) || a.name.localeCompare(b.name));
  return [
    el("div", { class: "section-head" }, el("h2", { class: "section-title" }, "Cómo leer las etiquetas")),
    el("div", { class: "prose" },
      el("h3", {}, "Orientación del medio"),
      el("p", {}, "La barrita junto al nombre del medio indica su orientación política aproximada, de izquierda a derecha. ",
        "Es una orientación ", el("strong", {}, "del medio en conjunto"), ", no de cada noticia: un diario de cualquier línea ",
        "publica información rigurosa, y la línea editorial se nota sobre todo en qué temas destaca, cómo titula y en sus artículos de opinión."),
      el("p", {}, "Se basa en estudios sobre la ideología de la audiencia de cada medio (",
        el("a", { href: "https://www.esade.edu/ecpol/es/publicaciones/polarizacion-medios-espana/", target: "_blank", rel: "noopener" },
          "EsadeEcPol, con datos del Digital News Report"), " y ",
        el("a", { href: "https://www.pewresearch.org/global/fact-sheet/news-media-and-political-attitudes-in-spain/", target: "_blank", rel: "noopener" },
          "Pew Research"),
        "). Donde no hay datos de estudio se usa la línea editorial conocida, y se marca como ", el("em", {}, "estimación"), "."),
      el("ul", { class: "lean-list" }, ...sources.map((s) =>
        el("li", {},
          el("span", { class: "lean-name" }, s.name,
            el("small", { class: "lean-label" },
              s.lean ? leanName(s.lean) + (s.lean_basis === "estimacion" ? " · estimación" : " · según estudios") : "")),
          s.lean ? leanBar(s) : el("span", { class: "tag " + s.type }, TYPE_TAGS[s.type])))),

      el("h3", {}, "Tipo de contenido"),
      el("dl", { class: "kinds" },
        el("dt", {}, el("span", { class: "tag opinion" }, "Opinión")),
        el("dd", {}, "Columnas, editoriales y tribunas: expresan el punto de vista del autor o del periódico, no son información."),
        el("dt", {}, el("span", { class: "tag patrocinado" }, "Patrocinado")),
        el("dd", {}, "Contenido pagado por una empresa o institución, publicado con aspecto de noticia. Puedes ocultarlo en Ajustes."),
        el("dt", {}, el("span", { class: "tag propaganda" }, "Propaganda")),
        el("dd", {}, "Medios controlados por un Estado sin prensa libre o por un partido político. Ninguna de tus fuentes actuales lo es."),
        el("dt", {}, el("span", { class: "tag publico" }, "Medio público")),
        el("dd", {}, "Radiotelevisiones públicas (RTVE, BBC). Su dirección depende de las instituciones y la percepción de su línea ",
          "cambia según quién gobierne, así que no se les asigna una posición.")),

      el("h3", {}, "Cómo lo cuentan otros"),
      el("p", {}, "En las noticias políticas, la app busca la misma noticia en otros medios para que puedas comparar enfoques, ",
        "empezando por los de otra línea. Se emparejan por las palabras del titular, así que puede fallar alguna vez.")),
  ];
}

function pageSettings() {
  const s = state.settings;
  const setSetting = (key, value) => {
    state.settings = { ...state.settings, [key]: value };
    store.set("settings", state.settings);
    applySettings();
    render();
  };
  const toggle = (key, label, hint) => el("label", { class: "setting" },
    el("span", {}, label, hint ? el("small", {}, hint) : null),
    el("input", { type: "checkbox", class: "switch", checked: s[key], onchange: (e) => setSetting(key, e.target.checked) }));
  const sizes = [[0.92, "Pequeña"], [1, "Normal"], [1.12, "Grande"], [1.25, "Muy grande"]];
  const updated = state.index ? new Date(state.index.updated) : null;
  const failed = (state.index?.sources || []).filter((x) => x.ok === false).map((x) => x.name);

  return [
    el("div", { class: "section-head" }, el("h2", { class: "section-title" }, "Ajustes")),
    el("section", { class: "settings" },
      el("h3", {}, "Lectura"),
      el("div", { class: "setting column" },
        el("span", {}, "Tamaño de la letra"),
        el("div", { class: "segmented", role: "group", "aria-label": "Tamaño de la letra" }, ...sizes.map(([v, label]) =>
          el("button", { "aria-pressed": String(s.zoom === v), onclick: () => setSetting("zoom", v) }, label)))),
      toggle("english", "Mostrar noticias en inglés", "BleepingComputer, The Hacker News, VGC y otras fuentes en inglés"),
      toggle("hideAds", "Ocultar publicidad, ofertas y noticias poco relevantes",
        "Contenido patrocinado, chollos, guías de compra y loterías. Siguen disponibles en «Ocultas», en el menú."),

      el("h3", {}, "Actualización"),
      el("div", { class: "setting column" },
        el("span", {}, updated
          ? `Última actualización: ${dayLabel(dayKey(updated)).toLowerCase()} a las ${fmtTime.format(updated)}`
          : "Sin datos todavía",
          el("small", {}, "Las noticias se descargan solas tres veces al día (hacia las 7:00, 14:00 y 21:00)."),
          failed.length ? el("small", {}, `No respondieron en la última actualización: ${failed.join(", ")}.`) : null),
        el("button", { class: "btn", onclick: () => checkForUpdates(true) }, svg(ICONS.refresh), "Comprobar ahora")),

      el("h3", {}, "Sobre la app"),
      el("div", { class: "setting column" },
        el("span", {}, "Instalar en el móvil",
          el("small", {}, "Android: menú ⋮ → «Añadir a pantalla de inicio». iPhone: Compartir → «Añadir a pantalla de inicio»."))),
      el("a", { class: "setting link", href: "#/medios" }, el("span", {}, "Medios y fuentes"), svg(ICONS.chevron)),
      el("a", { class: "setting link", href: "#/etiquetas" }, el("span", {}, "Cómo leer las etiquetas"), svg(ICONS.chevron))),
  ];
}

function pageHidden() {
  const items = hiddenItems();
  state.list = [];
  const unmute = (label, run) => el("button", { class: "pill", onclick: () => { run(); saveMuted(); render(); },
    "aria-label": `Dejar de ocultar ${label}` }, label, svg(ICONS.close));
  const learned = muted.terms.length || muted.sources.length;
  const past = Object.values(muted.dismissed).filter((d) => !(state.edition?.items || []).some((i) => i.id === d.id));

  const byReason = new Map();
  for (const it of items) {
    const r = hiddenReason(it).replace(/:.*/, "");
    if (!byReason.has(r)) byReason.set(r, []);
    byReason.get(r).push(it);
  }

  return [
    el("div", { class: "section-head" },
      el("h2", { class: "section-title" }, "Ocultas"),
      el("p", { class: "section-intro" },
        "Lo que la app no te muestra: publicidad y ofertas (si lo tienes activado en ",
        el("a", { href: "#/ajustes" }, "Ajustes"), ") y lo que marcaste con «No me interesa». Puedes recuperar cualquier cosa.")),
    el("section", { class: "block" },
      el("div", { class: "block-head" }, el("h2", {}, "Lo que has silenciado")),
      learned ? el("div", { class: "pills" },
        ...muted.terms.map((t) => unmute(`Tema: ${termLabel(t)}`, () => { muted.terms = muted.terms.filter((x) => x !== t); })),
        ...muted.sources.map((s) => unmute(`Medio: ${sourceById(s).name}`, () => { muted.sources = muted.sources.filter((x) => x !== s); })))
        : el("p", { class: "section-intro" }, "Nada todavía. Pulsa el ojo tachado de una noticia para ver menos como ella."),
      past.length ? el("p", { class: "section-intro" }, `Además, ${past.length} noticias de días anteriores marcadas como «No me interesa» siguen ayudando a ocultar las parecidas.`) : null,
      learned || past.length ? el("button", {
        class: "btn ghost", style: "margin-top:12px",
        onclick: () => {
          if (!confirm("¿Olvidar todo lo que has ocultado y silenciado?")) return;
          muted = { dismissed: {}, terms: [], sources: [], allow: [], labels: {} };
          saveMuted(); render();
        },
      }, "Olvidar todo") : null),
    ...[...byReason.entries()].map(([reason, list]) => el("section", { class: "block" },
      el("div", { class: "block-head" }, el("h2", {}, `${reason} · ${list.length}`)),
      el("div", { class: "list" }, ...list.map((it) => storyNode(it, { compact: true, hidden: true }))))),
    !items.length ? emptyNode("No hay nada oculto", "En esta edición no se ha ocultado ninguna noticia.") : null,
  ];
}

const TITLES = { home: "Mi Periódico", saved: "Guardadas", sources: "Medios", labels: "Etiquetas", settings: "Ajustes", hidden: "Ocultas" };

function render() {
  const r = state.route;
  renderTabbar();
  if (els.drawer.open) renderDrawer();

  state.list = [];
  state.shown = 0;
  let nodes;
  if (state.query) nodes = pageSearch();
  else if (r.name === "section") nodes = pageSection();
  else if (r.name === "source") nodes = pageSource();
  else if (r.name === "saved") nodes = pageSaved();
  else if (r.name === "sources") nodes = pageSources();
  else if (r.name === "labels") nodes = pageLabels();
  else if (r.name === "settings") nodes = pageSettings();
  else if (r.name === "hidden") nodes = pageHidden();
  else nodes = pageHome();

  els.appbarTitle.textContent = state.query ? "Buscar"
    : r.name === "section" ? catName(r.cat)
    : r.name === "source" ? sourceById(r.source).name
    : TITLES[r.name];
  document.title = r.name === "home" && !state.query ? "Mi Periódico" : `${els.appbarTitle.textContent} · Mi Periódico`;

  els.page.className = `page-${state.query ? "search" : r.name}`;
  els.page.replaceChildren(...nodes.filter(Boolean));
  watchMasthead();
  more();
}

/* En la portada, el nombre de la barra superior solo aparece al dejar atrás la cabecera grande */
const mastheadObserver = new IntersectionObserver(([entry]) => {
  document.body.classList.toggle("masthead-visible", entry.isIntersecting);
}, { rootMargin: "-56px 0px 0px 0px" });

function watchMasthead() {
  mastheadObserver.disconnect();
  const title = els.page.querySelector(".masthead-title, .section-title");
  if (title) mastheadObserver.observe(title);
  else document.body.classList.remove("masthead-visible");
}

function more() {
  const list = document.getElementById("list");
  if (!list || state.shown >= state.list.length) return;
  const next = state.list.slice(state.shown, state.shown + PAGE);
  list.append(...next.map((it, i) => storyNode(it, {
    lead: state.lead && state.shown === 0 && i === 0 && Boolean(it.image),
  })));
  state.shown += next.length;
}

/* ---------- guardadas ---------- */

function toggleSave(it, btn) {
  if (saved[it.id]) {
    delete saved[it.id];
    toast("Quitada de guardadas");
  } else {
    saved[it.id] = { ...it, savedAt: new Date().toISOString() };
    toast("Guardada para leer luego");
  }
  store.set("saved", saved);
  const on = Boolean(saved[it.id]);
  btn.setAttribute("aria-pressed", String(on));
  btn.setAttribute("aria-label", on ? "Quitar de guardadas" : "Guardar noticia");
  renderTabbar();
  if (state.route.name === "saved" && !on) btn.closest(".story")?.remove();
}

/* ---------- avisos ---------- */

let toastTimer;
function toast(text, action) {
  clearTimeout(toastTimer);
  els.toastText.textContent = text;
  els.toastAction.hidden = !action;
  if (action) {
    els.toastAction.textContent = action.label;
    els.toastAction.onclick = () => { els.toast.hidden = true; action.run(); };
  }
  els.toast.hidden = false;
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, action ? 8000 : 2200);
}

/* ---------- actualizaciones ---------- */

async function checkForUpdates(manual = false) {
  if (!manual && Date.now() - state.lastCheck < 10 * 60 * 1000) return;
  const before = state.index?.updated;
  try {
    await loadIndex();
  } catch {
    if (manual) toast("Sin conexión. Mostrando la última edición guardada.");
    return;
  }
  const newest = state.index.days[0]?.date;
  if (state.index.updated !== before && newest) {
    toast("Hay noticias nuevas", { label: "Ver", run: () => loadDay(newest).then(() => window.scrollTo(0, 0)) });
  } else if (manual) {
    toast("Ya estás al día");
  }
}

/* ---------- ajustes ---------- */

function applySettings() {
  document.documentElement.style.setProperty("--zoom", String(state.settings.zoom));
}

/* ---------- instalación como app ---------- */

let deferredPrompt = null;
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;

function setupInstall() {
  if (standalone || store.get("installDismissed", false)) return;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    els.installBtn.hidden = false;
    els.install.hidden = false;
  });

  if (isIOS) {
    els.installText.textContent = "Para tenerla como app: pulsa Compartir y luego «Añadir a pantalla de inicio».";
    els.install.hidden = false;
  }

  els.installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    els.install.hidden = true;
  });
  els.installClose.addEventListener("click", () => {
    els.install.hidden = true;
    store.set("installDismissed", true);
  });
  window.addEventListener("appinstalled", () => { els.install.hidden = true; });
}

/* ---------- eventos ---------- */

els.btnMenu.addEventListener("click", openDrawer);

function openSearch() {
  els.search.hidden = false;
  els.btnSearch.setAttribute("aria-expanded", "true");
  els.searchInput.focus();
}
function closeSearch() {
  els.search.hidden = true;
  els.btnSearch.setAttribute("aria-expanded", "false");
  if (state.query) { state.query = ""; els.searchInput.value = ""; render(); }
}
els.btnSearch.addEventListener("click", openSearch);
els.searchClose.addEventListener("click", closeSearch);

let searchTimer;
els.searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.query = els.searchInput.value.trim(); render(); window.scrollTo(0, 0); }, 200);
});
els.search.addEventListener("submit", (e) => { e.preventDefault(); els.searchInput.blur(); });
els.searchInput.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSearch(); });

new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) more();
}, { rootMargin: "800px" }).observe(els.sentinel);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    checkForUpdates();
    document.querySelectorAll(".story time").forEach((t) => { t.textContent = relTime(t.getAttribute("datetime")); });
  }
});

/* ---------- arranque ---------- */

async function start() {
  applySettings();
  state.route = parseRoute();
  renderTabbar();
  renderSkeleton();
  setupInstall();
  try {
    await loadIndex();
  } catch {
    els.page.replaceChildren(emptyNode("Aún no hay ninguna edición",
      "La primera edición se publicará en cuanto se ejecute la actualización diaria. Vuelve en unos minutos."));
    return;
  }
  const first = state.index.days[0]?.date;
  if (!first) {
    els.page.replaceChildren(emptyNode("Aún no hay ninguna edición", "Vuelve en unos minutos."));
    return;
  }
  await loadDay(first);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

start();
