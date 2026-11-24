#!/usr/bin/env python3
"""Descarga las noticias de los feeds RSS configurados y genera la edición del día.

Solo usa la biblioteca estándar de Python, así que no hace falta instalar nada.

Genera, dentro de app/data/:
  - AAAA-MM-DD.json  → la edición de ese día (hora de Madrid)
  - index.json       → la lista de ediciones disponibles, las categorías y el estado de cada fuente

Cada noticia recibe una o varias categorías: la de su fuente y las que encajen con las palabras
clave de feeds.json (así una noticia de El País sobre un ciberataque aparece también en
«Ciberseguridad»).
"""

from __future__ import annotations

import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
FEEDS_FILE = Path(os.environ.get("FEEDS_FILE", ROOT / "feeds.json"))
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "app" / "data"))

USER_AGENT = (
    "Mozilla/5.0 (compatible; MiPeriodico/1.0; lector RSS personal)"
)

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "media": "http://search.yahoo.com/mrss/",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc": "http://purl.org/dc/elements/1.1/",
}

# Tipo de pieza según la dirección o el titular: opinión y contenido patrocinado se marcan
# para no confundirlos con información.
KIND_RULES = [
    ("patrocinado", re.compile(
        r"/(branded|brand-?content|patrocinad[oa]s?|contenido-patrocinado|publirreportaje|"
        r"escaparate|promociones|sponsored|partner-content)(/|-|$)|^(patrocinado|publirreportaje|"
        r"contenido patrocinado|sponsored)\b", re.I)),
    ("opinion", re.compile(
        r"/(opinion|opiniones|tribuna|tribunas|editorial|editoriales|columnas?|firmas|"
        r"columnistas|blogs?|cartas-al-director|el-mirador|analisis-opinion)(/|-|$)|"
        r"^(opini[oó]n|editorial|tribuna|columna|an[aá]lisis)\s*[|:]", re.I)),
]


def kind_of(item: dict) -> str:
    path = item["link"].split("://", 1)[-1].split("/", 1)[-1].lower()
    for kind, pattern in KIND_RULES:
        if pattern.search("/" + path) or pattern.search(item["title"]):
            return kind
    return ""


IMG_RE = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"']", re.I)
TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")


# ---------------------------------------------------------------- utilidades


def load_config() -> dict:
    with FEEDS_FILE.open(encoding="utf-8") as fh:
        return json.load(fh)


def fetch(url: str, timeout: int = 25, retries: int = 2) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
                },
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            last_error = exc
            if 400 <= exc.code < 500:
                break  # la dirección no existe o no nos deja: reintentar no sirve
            time.sleep(2 * (attempt + 1))
        except Exception as exc:  # noqa: BLE001 — cualquier otro fallo de red se reintenta
            last_error = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"no se pudo descargar: {last_error}")


FILLER_RE = re.compile(r"^(leer( m[aá]s)?|seguir leyendo|sigue leyendo|read more|continue reading)\W*$", re.I)


def clean_summary(text: str) -> str:
    """Descarta resúmenes vacíos o de relleno («Leer», «Seguir leyendo…», restos cortados)."""
    return "" if len(text) < 25 or FILLER_RE.match(text) else text


def clean_text(raw: str | None, limit: int = 300) -> str:
    if not raw:
        return ""
    # Algunos feeds escapan el HTML dos veces (p. ej. «&amp;nbsp;»), así que desescapamos antes y después
    text = TAG_RE.sub(" ", html.unescape(raw))
    text = html.unescape(text)
    text = SPACE_RE.sub(" ", text).strip()
    if len(text) > limit:
        cut = text[:limit].rsplit(" ", 1)[0]
        text = cut.rstrip(",.;:") + "…"
    return text


def safe_url(url: str | None) -> str:
    if not url:
        return ""
    url = html.unescape(url.strip())
    if url.startswith("//"):
        url = "https:" + url
    if url.startswith("http://"):
        url = "https://" + url[len("http://"):]
    return url if url.startswith("https://") else ""


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        dt = None
    if dt is None:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def text_of(el: ET.Element | None) -> str:
    if el is None:
        return ""
    return "".join(el.itertext()).strip()


def find_image(item: ET.Element, *html_blobs: str) -> str:
    # 1) media:content / media:thumbnail (también dentro de media:group)
    best, best_w = "", -1
    for tag in ("media:content", "media:group/media:content", "media:thumbnail",
                "media:group/media:thumbnail"):
        for el in item.findall(tag, NS):
            url = el.get("url")
            medium = (el.get("medium") or "").lower()
            mime = (el.get("type") or "").lower()
            if not url or (medium and medium != "image") or (mime and not mime.startswith("image")):
                continue
            try:
                width = int(el.get("width") or 0)
            except ValueError:
                width = 0
            if width > best_w:
                best, best_w = url, width
    if best:
        return safe_url(best)
    # 2) enclosure de tipo imagen
    for el in item.findall("enclosure"):
        if (el.get("type") or "").lower().startswith("image") and el.get("url"):
            return safe_url(el.get("url"))
    for el in item.findall("atom:link", NS):
        if el.get("rel") == "enclosure" and (el.get("type") or "").startswith("image"):
            return safe_url(el.get("href"))
    # 3) primera <img> del HTML de la descripción
    for blob in html_blobs:
        match = IMG_RE.search(blob or "")
        if match:
            return safe_url(match.group(1))
    return ""


# ---------------------------------------------------------------- parseo


def parse_feed(data: bytes, feed: dict) -> list[dict]:
    root = ET.fromstring(data)
    items: list[dict] = []

    if root.tag.endswith("feed"):  # Atom
        entries = root.findall("atom:entry", NS)
        for e in entries:
            link = ""
            for l in e.findall("atom:link", NS):
                if l.get("rel", "alternate") == "alternate":
                    link = l.get("href", "")
                    break
            summary_html = text_of(e.find("atom:summary", NS))
            content_html = text_of(e.find("atom:content", NS))
            items.append({
                "title": clean_text(text_of(e.find("atom:title", NS)), 220),
                "link": safe_url(link),
                "summary": clean_text(summary_html or content_html),
                "image": find_image(e, summary_html, content_html),
                "date": parse_date(text_of(e.find("atom:published", NS))
                                   or text_of(e.find("atom:updated", NS))),
            })
    else:  # RSS 2.0 / RDF
        entries = root.findall("./channel/item") or root.findall(".//item") \
            or root.findall(".//{http://purl.org/rss/1.0/}item")
        for it in entries:
            desc_html = text_of(it.find("description"))
            content_html = text_of(it.find("content:encoded", NS))
            title = text_of(it.find("title"))
            publisher = text_of(it.find("source"))  # Google News añade « - Medio» al titular
            if publisher and title.endswith(f" - {publisher}"):
                title = title[: -len(publisher) - 3]
                desc_html = content_html = ""  # su descripción solo repite el titular
            items.append({
                "title": clean_text(title, 220),
                "link": safe_url(text_of(it.find("link")) or text_of(it.find("guid"))),
                "summary": clean_text(desc_html or content_html),
                "image": find_image(it, desc_html, content_html),
                "date": parse_date(text_of(it.find("pubDate")) or text_of(it.find("dc:date", NS))),
            })

    result = []
    for it in items[: feed.get("max", 40)]:
        if not it["title"] or not it["link"]:
            continue
        # Si el resumen solo repite el titular, no lo mostramos
        if it["summary"].lower().startswith(it["title"].lower()[:60]):
            it["summary"] = it["summary"][len(it["title"]):].lstrip(" .-–—:")
        it["summary"] = clean_summary(it["summary"])
        if feed.get("strip_suffix") and it["title"].endswith(feed["strip_suffix"]):
            it["title"] = it["title"][: -len(feed["strip_suffix"])].strip()
            it["summary"] = ""  # en Google News el resumen solo repite el titular
        it["id"] = hashlib.sha1(it["link"].encode()).hexdigest()[:12]
        it["source"] = feed["id"]
        result.append(it)
    return result


def google_news_url(site: str, hours: float) -> str:
    days = max(1, -(-int(hours) // 24))
    query = urllib.parse.quote_plus(f"site:{site} when:{days}d")
    return f"https://news.google.com/rss/search?q={query}&hl=es&gl=ES&ceid=ES:es"


def read_feed(feed: dict, now: datetime, max_age: timedelta) -> tuple[dict, list[dict]]:
    """Prueba la URL principal y, si no trae noticias recientes, las de reserva.

    Si la fuente tiene «site», la última reserva es una búsqueda de ese sitio en Google News.
    """
    max_age = timedelta(hours=feed.get("max_age_hours", max_age.total_seconds() / 3600))
    urls = [feed["url"], *feed.get("fallbacks", [])]
    if feed.get("site"):
        urls.append(google_news_url(feed["site"], max_age.total_seconds() / 3600))
    problems = []
    for n, url in enumerate(urls):
        label = feed["name"] + (f" (reserva {n})" if n else "")
        try:
            items = parse_feed(fetch(url), feed)
        except Exception as exc:  # noqa: BLE001 — una fuente rota no debe parar las demás
            problems.append(str(exc)[:120])
            print(f"✘ {label}: {exc}", file=sys.stderr)
            continue
        dated = [it["date"] for it in items if it["date"]]
        newest = max(dated) if dated else None
        recent = [it for it in items if not it["date"] or now - it["date"] <= max_age]
        if recent:
            print(f"✔ {label}: {len(recent)} noticias recientes de {len(items)}")
            return {"ok": True, "count": len(recent)}, recent
        when = newest.isoformat(timespec="minutes") if newest else "sin fecha"
        problems.append(f"sin noticias recientes (la más nueva: {when})")
        print(f"✘ {label}: {len(items)} noticias, ninguna reciente (la más nueva: {when}) — {url}",
              file=sys.stderr)
    return {"ok": False, "error": "; ".join(problems)[:200]}, []


# ---------------------------------------------------------------- categorías


def as_list(value) -> list[str]:
    if not value:
        return []
    return [value] if isinstance(value, str) else list(value)


class Categorizer:
    """Asigna categorías a cada noticia según su fuente y las palabras clave."""

    def __init__(self, config: dict):
        self.cats = {c["id"]: c for c in config.get("categories", [])}
        self.feed_cats = {f["id"]: as_list(f.get("category")) for f in config["feeds"]}
        self.summary_scope = set(config.get("summary_scope", []))
        self.rules = []
        for c in self.cats.values():
            if c.get("keywords"):
                pattern = re.compile("|".join(f"(?:{k})" for k in c["keywords"]), re.I)
                self.rules.append((c["id"], pattern, set(c.get("scope", []))))

    def with_parents(self, ids: list[str]) -> list[str]:
        out: list[str] = []
        for cid in ids:
            while cid and cid not in out:
                out.append(cid)
                cid = self.cats.get(cid, {}).get("parent")
        return out

    def __call__(self, item: dict) -> list[str]:
        base = self.feed_cats.get(item["source"]) or as_list(item.get("cats"))[:1]
        found = list(base)
        own = set(self.with_parents(base))
        # En las fuentes generalistas solo miramos el titular: el resumen suele mencionar
        # temas de pasada («…y la IA está alterando…») y mete ruido.
        text = item["title"]
        if own & self.summary_scope:
            text += " " + item.get("summary", "")
        for cid, pattern, scope in self.rules:
            if cid in found or (scope and not scope & own):
                continue
            if pattern.search(text):
                found.append(cid)
        return [c for c in self.with_parents(found) if c in self.cats]


# ---------------------------------------------------------------- principal


def main() -> int:
    config = load_config()
    tz = ZoneInfo(config.get("timezone", "Europe/Madrid"))
    keep_days = int(config.get("keep_days", 30))
    max_age = timedelta(hours=int(config.get("max_age_hours", 36)))

    now = datetime.now(timezone.utc)
    today = now.astimezone(tz).date().isoformat()
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    feeds = [f for f in config["feeds"] if f.get("enabled", True) is not False]
    fresh: list[dict] = []
    status: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = pool.map(lambda f: read_feed(f, now, max_age), feeds)
        for feed, (st, recent) in zip(feeds, results):
            status[feed["id"]] = st
            fresh.extend(recent)

    # Mezclamos con lo que ya tuviera la edición de hoy (si se ejecuta varias veces al día)
    day_file = DATA_DIR / f"{today}.json"
    by_id: dict[str, dict] = {}
    if day_file.exists():
        for it in json.loads(day_file.read_text(encoding="utf-8")).get("items", []):
            by_id[it["id"]] = it

    for it in fresh:
        date = it["date"] or now
        it["date"] = min(date, now).isoformat(timespec="seconds").replace("+00:00", "Z")
        by_id.setdefault(it["id"], it)

    # Fuera titulares basura (fichas de directorio, sorteos…), también de las ya guardadas
    junk = [re.compile(p, re.I) for p in config.get("exclude_titles", [])]
    for key in [k for k, it in by_id.items() if any(p.search(it["title"]) for p in junk)]:
        del by_id[key]

    # (Re)calculamos las categorías de todas, también de las que ya estaban en la edición
    categorize = Categorizer(config)
    for it in by_id.values():
        it["summary"] = clean_summary(it.get("summary", ""))
        it.pop("section", None)
        it["cats"] = categorize(it)
        kind = kind_of(it)
        if kind:
            it["kind"] = kind
        else:
            it.pop("kind", None)

    items = sorted(by_id.values(), key=lambda x: x["date"], reverse=True)
    if items or not day_file.exists():
        day_file.write_text(
            json.dumps({"date": today, "updated": now.isoformat(timespec="seconds"),
                        "items": items}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )

    # Limpieza de ediciones antiguas e índice
    cutoff = (now.astimezone(tz).date() - timedelta(days=keep_days)).isoformat()
    days = []
    for f in sorted(DATA_DIR.glob("????-??-??.json"), reverse=True):
        if f.stem < cutoff:
            f.unlink()
            continue
        count = len(json.loads(f.read_text(encoding="utf-8")).get("items", []))
        if count:
            days.append({"date": f.stem, "count": count})

    index = {
        "title": config.get("title", "Mi Periódico"),
        "updated": now.isoformat(timespec="seconds"),
        "categories": [
            {"id": c["id"], "name": c["name"], **({"parent": c["parent"]} if c.get("parent") else {})}
            for c in config.get("categories", [])
        ],
        "sources": [
            {"id": f["id"], "name": f["name"], "category": as_list(f.get("category")),
             "color": f.get("color", ""), "lang": f.get("lang", "es"),
             **{k: f[k] for k in ("type", "lean", "lean_basis") if f.get(k)},
             **status.get(f["id"], {"ok": False})}
            for f in feeds
        ],
        "days": days,
    }
    (DATA_DIR / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    ok = sum(1 for s in status.values() if s["ok"])
    print(f"\nEdición {today}: {len(items)} noticias de {ok}/{len(status)} fuentes")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
