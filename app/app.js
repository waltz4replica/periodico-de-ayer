"use strict";

/* ============================================================
   Mi Periódico — lector de noticias diario
   Lee las ediciones que genera scripts/fetch_news.py en data/
   ============================================================ */

const PAGE = 24;
const TZ = "Europe/Madrid";

const $ = (sel) => document.querySelector(sel);
const els = {
  feed: $("#feed"),
  days: $("#days"),
  cats: $("#cats"),
  leans: $("#leans"),
  about: $("#about"),
  leanList: $("#lean-list"),
  sources: $("#sources"),
  dateline: $("#dateline"),
  footer: $("#footer"),
  sentinel: $("#sentinel"),
  search: $("#search"),
  searchInput: $("#search-input"),
  btnSearch: $("#btn-search"),
  btnSaved: $("#btn-saved"),
  savedCount: $("#saved-count"),
  filters: $("#filters"),
  toast: $("#toast"),
  toastText: $("#toast-text"),
  toastAction: $("#toast-action"),
  install: $("#install"),
  installText: $("#install-text"),
  installBtn: $("#install-btn"),
  installClose: $("#install-close"),
};

const state = {
  index: null,
  day: null,           // "AAAA-MM-DD"
  edition: null,       // { date, updated, items }
  source: "all",
  cat: "all",         // categoría preferida (se recuerda)
  activeCat: "all",   // la que se muestra (si la preferida no existe en esa edición, «Todo»)
  lean: "all",        // filtro por orientación del medio
  query: "",
  view: "news",        // "news" | "saved"
  shown: 0,
  list: [],
  lastCheck: 0,
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

let saved = store.get("saved", {});        // id -> noticia
let read = new Set(store.get("read", []));  // ids leídas
state.cat = store.get("cat", "all");        // última categoría elegida

function markRead(id) {
  if (read.has(id)) return;
  read.add(id);
  store.set("read", [...read].slice(-1500));
}

/* ---------- formato de fechas ---------- */

const fmtLong = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const fmtChip = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", timeZone: TZ });
const fmtTime = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const fmtShort = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });
const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // AAAA-MM-DD
const fromKey = (k) => new Date(`${k}T12:00:00Z`);

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function relTime(iso) {
  const date = new Date(iso);
  const mins = Math.round((Date.now() - date) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return rtf.format(-mins, "minute");
  if (mins < 60 * 12) return rtf.format(-Math.round(mins / 60), "hour");
  return fmtShort.format(date);
}

function dayLabel(key) {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 864e5));
  if (key === today) return "Hoy";
  if (key === yesterday) return "Ayer";
  return capitalize(fmtChip.format(fromKey(key)).replace(".", ""));
}

/* ---------- datos ---------- */

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const sourceById = (id) => state.index?.sources.find((s) => s.id === id) || { id, name: id };

/** Categorías de una noticia (las ediciones antiguas no las traen: usamos la de su fuente). */
function catsOf(it) {
  if (it.cats) return it.cats;
  const src = sourceById(it.source);
  return Array.isArray(src.category) ? src.category : src.category ? [src.category] : [];
}

const inCat = (it, cat) => cat === "all" || catsOf(it).includes(cat);

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
const LEAN_CATS = new Set(["politica", "actualidad"]);
const TYPE_TAGS = { propaganda: "Propaganda", publico: "Medio público" };
const KIND_TAGS = { opinion: "Opinión", patrocinado: "Patrocinado" };

function leanBar(src) {
  if (!src.lean) return null;
  const pos = leanPos(src.lean);
  const label = `${src.name}: ${leanName(src.lean).toLowerCase()}` +
    (src.lean_basis === "estimacion" ? " (estimación)" : " (según estudios de audiencia)");
  const bar = el("span", { class: "lean-bar", role: "img", "aria-label": label, title: label },
    ...LEANS.map((_, i) => el("i", { class: i === pos ? "on" : null })));
  return bar;
}

function openAbout() {
  const sources = (state.index?.sources || []).filter((s) => s.lean || TYPE_TAGS[s.type]);
  sources.sort((a, b) => (leanPos(a.lean) - leanPos(b.lean)) || a.name.localeCompare(b.name));
  els.leanList.replaceChildren(...sources.map((s) =>
    el("li", {},
      el("span", { class: "lean-name" }, s.name,
        el("small", { class: "lean-label" },
          s.lean ? leanName(s.lean) + (s.lean_basis === "estimacion" ? " · estimación" : " · según estudios") : "")),
      s.lean ? leanBar(s) : el("span", { class: "tag " + s.type }, TYPE_TAGS[s.type]))));
  els.about.showModal?.();
}

/* Agrupa titulares parecidos de distintos medios («Cómo lo cuentan otros») */
const STOP = new Set(("para como tras sobre entre desde hasta este esta estos estas pero porque cuando donde " +
  "todo todos toda todas años dice según hace puede será sido tiene tienen nuevo nueva ante contra sólo solo " +
  "más menos muy otra otro otros otras cada ahora hacer hecho ser están está fue han hay sus del las los una " +
  "unos unas que con por sin les nos así aunque mientras tras cómo qué quién quien cuál").split(" "));

function tokens(title) {
  return new Set(normalize(title).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 3 && !STOP.has(w)));
}

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
      const list = [...bySource.values()]
        .sort((x, y) => Math.abs(leanPos(sourceById(y.source).lean) - own) - Math.abs(leanPos(sourceById(x.source).lean) - own))
        .slice(0, 4);
      if (list.length) map.set(a.it.id, list);
    }
    versionsCache = { edition: state.edition, map };
  }
  return versionsCache.map.get(it.id) || [];
}

async function loadIndex() {
  state.index = await getJSON("data/index.json");
  state.lastCheck = Date.now();
}

async function loadDay(key) {
  state.day = key;
  state.edition = null;
  renderDays();
  renderSkeleton();
  try {
    state.edition = await getJSON(`data/${key}.json`);
  } catch {
    state.edition = { date: key, items: [] };
  }
  render();
}

/* ---------- pintado ---------- */

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

const icon = (path) => {
  const wrap = document.createElement("span");
  wrap.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  return wrap.firstChild;
};
const BOOKMARK = '<path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/>';

function renderDays() {
  const days = state.index?.days || [];
  els.days.replaceChildren(
    ...days.map((d) =>
      el("button", {
        class: "chip",
        "aria-pressed": String(d.date === state.day),
        onclick: () => { if (d.date !== state.day) { loadDay(d.date); scrollTop(); } },
      }, dayLabel(d.date)))
  );
  const active = els.days.querySelector('[aria-pressed="true"]');
  active?.scrollIntoView({ block: "nearest", inline: "center" });
}

function renderCats() {
  const items = state.edition?.items || [];
  const counts = new Map();
  for (const it of items) for (const c of catsOf(it)) counts.set(c, (counts.get(c) || 0) + 1);
  const cats = (state.index?.categories || []).filter((c) => counts.has(c.id));
  els.cats.hidden = cats.length < 2;

  const chip = (id, label, sub) =>
    el("button", {
      class: "chip" + (sub ? " sub" : ""),
      "aria-pressed": String(state.activeCat === id),
      onclick: () => {
        state.cat = id;
        state.source = "all";
        store.set("cat", id);
        render();
        scrollTop();
      },
    }, label);

  els.cats.replaceChildren(chip("all", "Todo"), ...cats.map((c) => chip(c.id, c.name, c.parent)));
  els.cats.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "center" });
}

const leanFilterOn = () => state.lean !== "all" && LEAN_CATS.has(state.activeCat);

function renderLeans() {
  const show = state.view === "news" && LEAN_CATS.has(state.activeCat);
  els.leans.hidden = !show;
  if (!show) return;
  const items = (state.edition?.items || []).filter((i) => inCat(i, state.activeCat));
  const present = new Set(items.map((i) => sourceById(i.source).lean).filter(Boolean));
  const chip = (id, label) => el("button", {
    class: "chip",
    "aria-pressed": String(state.lean === id),
    onclick: () => { state.lean = id; state.source = "all"; render(); scrollTop(); },
  }, id !== "all" ? el("span", { class: "lean-bar mini" },
      ...LEANS.map((_, i) => el("i", { class: i === leanPos(id) ? "on" : null }))) : null, label);
  els.leans.replaceChildren(
    chip("all", "Todas las líneas"),
    ...LEANS.filter((l) => present.has(l.id)).map((l) => chip(l.id, l.name)),
    el("button", { class: "chip info", onclick: openAbout, "aria-label": "Qué significan las etiquetas" }, "ⓘ ¿Qué es esto?"),
  );
}

function renderSources() {
  const items = (state.edition?.items || []).filter((i) => inCat(i, state.activeCat) &&
    (!leanFilterOn() || sourceById(i.source).lean === state.lean));
  const counts = new Map();
  for (const it of items) counts.set(it.source, (counts.get(it.source) || 0) + 1);
  const sources = (state.index?.sources || []).filter((s) => counts.has(s.id));

  const chip = (id, label, color) =>
    el("button", {
      class: "chip",
      "aria-pressed": String(state.source === id),
      onclick: () => { state.source = id; render(); scrollTop(); },
    }, color ? el("span", { class: "dot", style: `--c:${color}` }) : null, label);

  els.sources.replaceChildren(
    chip("all", "Todos"),
    ...sources.map((s) => chip(s.id, s.name, s.color))
  );
}

function renderSkeleton() {
  els.feed.replaceChildren(...Array.from({ length: 6 }, () => el("div", { class: "skeleton" })));
}

function renderEmpty(title, text) {
  els.feed.replaceChildren(el("div", { class: "empty" }, el("h2", {}, title), el("p", {}, text)));
}

function storyNode(it, lead = false) {
  const src = sourceById(it.source);
  const isSaved = Boolean(saved[it.id]);
  const hasImg = Boolean(it.image);
  const tags = [
    TYPE_TAGS[src.type] && src.type === "propaganda" ? el("span", { class: "tag propaganda" }, TYPE_TAGS.propaganda) : null,
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
    "aria-label": isSaved ? "Quitar de guardados" : "Guardar noticia",
    "aria-pressed": String(isSaved),
    onclick: (e) => { e.preventDefault(); toggleSave(it, e.currentTarget); },
  }, icon(BOOKMARK));

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
    it.summary ? el("p", {}, it.summary) : null,
    img);

  const versions = state.view === "news" ? versionsOf(it) : [];
  const others = versions.length
    ? el("div", { class: "versions" },
        el("span", { class: "versions-label" }, "Cómo lo cuentan otros:"),
        ...versions.map((v) => {
          const vs = sourceById(v.source);
          return el("a", {
            href: v.link, target: "_blank", rel: "noopener noreferrer", title: v.title,
            onclick: () => markRead(v.id),
          }, leanBar(vs), vs.name);
        }))
    : null;

  return el("article", {
    class: ["story", lead && "lead", !hasImg && "no-img", read.has(it.id) && "read"].filter(Boolean).join(" "),
  }, link, others, saveBtn);
}

function filtered() {
  let items = state.view === "saved"
    ? Object.values(saved).sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""))
    : state.edition?.items || [];
  if (state.view === "news") {
    items = items.filter((i) => inCat(i, state.activeCat));
    if (state.source !== "all") items = items.filter((i) => i.source === state.source);
    if (leanFilterOn()) items = items.filter((i) => sourceById(i.source).lean === state.lean);
  }
  if (state.query) {
    const words = normalize(state.query).split(/\s+/).filter(Boolean);
    items = items.filter((i) => {
      const hay = normalize(`${i.title} ${i.summary} ${sourceById(i.source).name}`);
      return words.every((w) => hay.includes(w));
    });
  }
  return items;
}

const normalize = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** En «Todos» alternamos periódicos para que ninguno acapare la portada. */
function mixSources(items) {
  if (state.view !== "news" || state.source !== "all" || state.query) return items;
  const buckets = new Map();
  for (const it of items) {
    if (!buckets.has(it.source)) buckets.set(it.source, []);
    buckets.get(it.source).push(it);
  }
  const queues = [...buckets.values()];
  const out = [];
  // Ronda a ronda, dentro de cada ronda ordenadas por hora
  for (let round = 0; out.length < items.length; round++) {
    const batch = queues.map((q) => q[round]).filter(Boolean);
    batch.sort((a, b) => b.date.localeCompare(a.date));
    out.push(...batch);
  }
  // La destacada: la más reciente con foto
  const leadIdx = out.findIndex((i) => i.image);
  if (leadIdx > 0) out.unshift(...out.splice(leadIdx, 1));
  return out;
}

function render() {
  // Si la categoría o la fuente elegidas no existen en esta edición, volvemos a «Todo»
  // (la preferencia se conserva: al volver a una edición que la tenga, se recupera)
  const items = state.edition?.items || [];
  state.activeCat = state.cat !== "all" && items.some((i) => inCat(i, state.cat)) ? state.cat : "all";
  if (state.source !== "all" && !items.some((i) => i.source === state.source && inCat(i, state.activeCat))) {
    state.source = "all";
  }

  if (!LEAN_CATS.has(state.activeCat)) state.lean = "all";

  renderDays();
  renderCats();
  renderLeans();
  renderSources();
  renderDateline();
  renderFooter();

  els.filters.hidden = state.view === "saved";
  els.days.hidden = state.view === "saved";
  els.btnSaved.setAttribute("aria-pressed", String(state.view === "saved"));
  const n = Object.keys(saved).length;
  els.savedCount.hidden = n === 0;
  els.savedCount.textContent = n > 99 ? "99+" : String(n);

  state.list = mixSources(filtered());
  state.shown = 0;
  els.feed.replaceChildren();

  if (state.view === "saved") {
    if (!state.list.length) {
      els.feed.append(el("div", { class: "empty" },
        el("h2", {}, state.query ? "Sin resultados" : "Nada guardado todavía"),
        el("p", {}, state.query ? "Prueba con otras palabras." : "Pulsa el marcador de una noticia para leerla más tarde.")));
      return;
    }
  } else if (!state.list.length) {
    if (state.query) renderEmpty("Sin resultados", `No hay noticias con «${state.query}» en esta edición.`);
    else renderEmpty("Edición vacía", "No hay noticias para este día.");
    return;
  }
  more();
}

function more() {
  const next = state.list.slice(state.shown, state.shown + PAGE);
  const leadAllowed = state.view === "news" && !state.query && state.shown === 0;
  els.feed.append(...next.map((it, i) => storyNode(it, leadAllowed && i === 0 && Boolean(it.image))));
  state.shown += next.length;
}

function renderDateline() {
  if (state.view === "saved") {
    els.dateline.textContent = "Tus noticias guardadas";
    return;
  }
  const key = state.day || dayKey(new Date());
  const items = state.edition?.items || [];
  const count = items.filter((i) => inCat(i, state.activeCat) &&
    (!leanFilterOn() || sourceById(i.source).lean === state.lean)).length;
  els.dateline.textContent = capitalize(fmtLong.format(fromKey(key))) + (count ? ` · ${count} noticias` : "");
}

function renderFooter() {
  const idx = state.index;
  if (!idx) { els.footer.replaceChildren(); return; }
  const updated = new Date(idx.updated);
  const failed = idx.sources.filter((s) => !s.ok).map((s) => s.name);
  els.footer.replaceChildren(
    el("p", {}, `Última actualización: ${dayKey(updated) === dayKey(new Date()) ? "hoy" : capitalize(fmtChip.format(updated))} a las ${fmtTime.format(updated)}`),
    failed.length ? el("p", {}, `Sin noticias nuevas de: ${failed.join(", ")}`) : null,
    el("p", {}, el("button", { onclick: openAbout }, "Cómo leer la orientación de los medios y las etiquetas")),
    el("p", {}, el("button", { onclick: () => checkForUpdates(true) }, "Comprobar si hay noticias nuevas")),
  );
}

function scrollTop() { window.scrollTo({ top: 0, behavior: "smooth" }); }

/* ---------- guardados ---------- */

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
  btn.setAttribute("aria-label", on ? "Quitar de guardados" : "Guardar noticia");
  const n = Object.keys(saved).length;
  els.savedCount.hidden = n === 0;
  els.savedCount.textContent = n > 99 ? "99+" : String(n);
  if (state.view === "saved" && !on) btn.closest(".story")?.remove();
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
    toast("Hay noticias nuevas", {
      label: "Ver",
      run: () => { state.view = "news"; loadDay(newest).then(scrollTop); },
    });
  } else if (manual) {
    toast("Ya estás al día");
  }
  renderFooter();
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

els.btnSearch.addEventListener("click", () => {
  const open = els.search.hidden;
  els.search.hidden = !open;
  els.btnSearch.setAttribute("aria-expanded", String(open));
  if (open) els.searchInput.focus();
  else if (state.query) { state.query = ""; els.searchInput.value = ""; render(); }
});

let searchTimer;
els.searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.query = els.searchInput.value.trim(); render(); }, 180);
});
els.search.addEventListener("submit", (e) => { e.preventDefault(); els.searchInput.blur(); });

els.btnSaved.addEventListener("click", () => {
  state.view = state.view === "saved" ? "news" : "saved";
  render();
  scrollTop();
});

$("#home-link").addEventListener("click", (e) => {
  e.preventDefault();
  state.view = "news";
  state.source = "all";
  const newest = state.index?.days[0]?.date;
  if (newest && newest !== state.day) loadDay(newest); else render();
  scrollTop();
});

new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && state.shown < state.list.length) more();
}, { rootMargin: "800px" }).observe(els.sentinel);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    checkForUpdates();
    // refresca los «hace X minutos»
    document.querySelectorAll(".story time").forEach((t) => { t.textContent = relTime(t.getAttribute("datetime")); });
  }
});

/* ---------- arranque ---------- */

async function start() {
  renderSkeleton();
  renderDateline();
  setupInstall();
  try {
    await loadIndex();
  } catch {
    renderEmpty("Aún no hay ninguna edición",
      "La primera edición se publicará en cuanto se ejecute la actualización diaria. Vuelve en unos minutos.");
    return;
  }
  const first = state.index.days[0]?.date;
  if (!first) {
    renderEmpty("Aún no hay ninguna edición", "Vuelve en unos minutos.");
    return;
  }
  await loadDay(first);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

start();
