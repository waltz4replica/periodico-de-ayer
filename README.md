# Mi Periódico 📰

Una app para el móvil con las noticias del día de los principales periódicos españoles, que se
actualiza sola cada día. Se instala desde el navegador como una app normal (PWA): sin tiendas de
aplicaciones y sin servidor propio.

- **Se actualiza sola**: GitHub Actions descarga las noticias a las ~7:00, ~14:00 y ~21:00 (hora de Madrid).
- **Varios periódicos juntos**: El País, El Mundo, ABC, La Vanguardia, 20minutos, elDiario.es, RTVE,
  Europa Press, BBC Mundo, Expansión, Marca, Público, infoLibre, El Confidencial, El Español y La Razón.
  Se pueden filtrar por periódico y por orientación.
- **Categorías**: Actualidad, Política, Tecnología, IA, Ciberseguridad, Data breaches, Leaks, Videojuegos,
  Móviles y gadgets, Internacional, Economía y Deportes. La app recuerda la última que elegiste.
- **Fuentes de tecnología**: Xataka, Genbeta, Hipertextual, El País Tecnología, Xataka Móvil, Una al día,
  WeLiveSecurity, BleepingComputer, The Hacker News, Krebs on Security, The Record, DataBreaches.net,
  Have I Been Pwned, Vandal, 3DJuegos, Eurogamer, Insider Gaming y VGC (las marcadas «EN» están en inglés).
- **Organizada como una app**: barra inferior (Portada, Política, Tecnología, Juegos, Guardadas), menú
  lateral con todas las secciones, portada por bloques y filtros en una hoja aparte.
- **Hemeroteca**: guarda las ediciones de los últimos 30 días.
- **Sin publicidad**: oculta contenido patrocinado, ofertas, chollos, guías de compra y loterías.
- **«No me interesa»**: el ojo tachado de cada noticia la oculta junto con las que cuenten lo mismo, o
  silencia un tema (una palabra del titular) o un medio. Todo lo oculto queda en **Ocultas**, en el menú,
  desde donde se puede recuperar. Se guarda solo en tu móvil.
- **Ajustes**: tamaño de letra, noticias en inglés y filtro de publicidad.
- **Buscador**, **noticias guardadas** para leer luego, noticias leídas en gris y **modo oscuro** automático.
- **Funciona sin conexión** con la última edición descargada.

## Ponerla en marcha (una sola vez)

1. **Activa GitHub Pages**: en el repositorio, ve a *Settings → Pages* y en *Build and deployment →
   Source* elige **GitHub Actions**.
2. **Lleva el código a la rama `main`** (fusiona la rama de trabajo). GitHub solo ejecuta las tareas
   programadas desde la rama principal.
3. **Lanza la primera edición**: *Actions → Actualizar noticias → Run workflow*. Tarda alrededor de un minuto.
4. Abre la web en el móvil: `https://<tu-usuario>.github.io/periodico-de-ayer/`

### Instalarla en el móvil

- **Android (Chrome)**: abre la web y pulsa **Instalar** en el aviso, o *menú ⋮ → Añadir a pantalla de inicio*.
- **iPhone (Safari)**: botón **Compartir** → **Añadir a pantalla de inicio**.

## Cambiar los periódicos

Edita [`feeds.json`](feeds.json). Cada periódico es una entrada con su feed RSS:

```json
{ "id": "elpais", "name": "El País", "section": "General", "color": "#1a1a1a",
  "url": "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada" }
```

- Para quitar uno sin borrarlo, añade `"enabled": false`.
- `fallbacks`: direcciones de reserva que se prueban si la principal falla o no trae noticias recientes.
- `keep_days`: cuántos días de hemeroteca se guardan (30 por defecto).
- `max_age_hours`: antigüedad máxima de una noticia para entrar en la edición del día (36 horas).
- `exclude_titles`: expresiones para descartar titulares basura (fichas de directorio, sorteos…).

Si una fuente falla, las demás siguen funcionando y la app indica al pie cuáles no respondieron.

## Categorías

Las categorías se definen en `feeds.json`, en `categories`. Cada noticia recibe:

1. La categoría de su fuente (`"category"` en cada feed).
2. Las categorías cuyas palabras clave (`keywords`, expresiones regulares) aparezcan en la noticia.
   Así, una noticia de El País sobre un ciberataque sale también en «Ciberseguridad».
   - En las fuentes generalistas solo se mira el **titular**; en las de tecnología y videojuegos
     (`summary_scope`), también el resumen.
   - `scope` limita una categoría a noticias de ciertas fuentes: «Leaks» solo se aplica a fuentes de
     tecnología y videojuegos, para que la filtración de unos audios políticos no acabe ahí.
   - `parent` hace que una subcategoría cuente también para la principal (IA → Tecnología).

En cada feed, `max_age_hours` permite aceptar noticias más antiguas en fuentes que publican poco
(Have I Been Pwned, Krebs…), y `site` añade como último recurso una búsqueda de ese sitio en Google News.

## Orientación de los medios, opinión y propaganda

- Cada medio generalista tiene en `feeds.json` una orientación aproximada (`lean`: izquierda,
  centroizquierda, centro, centroderecha o derecha) y su base (`lean_basis`): `estudio` si la respaldan
  estudios de audiencia (EsadeEcPol con datos del Digital News Report; Pew Research) o `estimacion` si se
  basa en la línea editorial conocida. En la app se ve como una barrita junto al nombre del medio.
- `type`: `diario`, `agencia`, `publico` (radiotelevisiones públicas, sin posición asignada),
  `propaganda` (medios controlados por un Estado sin prensa libre o por un partido) o `partidista`.
- Cada noticia se marca como **Opinión** o **Patrocinado** según su dirección web (`/opinion/`,
  `/tribuna/`, `/branded/`…), para no confundir comentario o publicidad con información.
- En **Política** y **Actualidad** se puede filtrar por orientación, y en las noticias políticas aparece
  «Cómo lo cuentan otros» con la misma noticia en otros medios, priorizando los de otra línea.

Es una orientación del medio en conjunto, no un juicio sobre cada noticia.

## Cambiar las horas de actualización

En [`.github/workflows/actualizar.yml`](.github/workflows/actualizar.yml), las líneas `cron`
(están en hora UTC, una o dos horas menos que en España).

## Cómo está hecha

```
app/                  la app (HTML, CSS y JavaScript, sin dependencias)
  data/               ediciones generadas: AAAA-MM-DD.json + index.json
scripts/fetch_news.py descarga los RSS y genera la edición (solo Python estándar)
feeds.json            lista de periódicos
.github/workflows/    actualización programada y publicación en GitHub Pages
```

Para probarla en tu ordenador:

```bash
python3 scripts/fetch_news.py      # descarga las noticias en app/data/
python3 -m http.server -d app 8000 # y abre http://localhost:8000
```
