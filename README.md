# Mi Periódico 📰

Una app para el móvil con las noticias del día de los principales periódicos españoles, que se
actualiza sola cada día. Se instala desde el navegador como una app normal (PWA): sin tiendas de
aplicaciones y sin servidor propio.

- **Se actualiza sola**: GitHub Actions descarga las noticias a las ~7:00, ~14:00 y ~21:00 (hora de Madrid).
- **Varios periódicos juntos**: El País, El Mundo, ABC, La Vanguardia, 20minutos, elDiario.es, RTVE,
  Europa Press, BBC Mundo, Expansión y Marca. Se pueden filtrar por periódico.
- **Hemeroteca**: guarda las ediciones de los últimos 30 días (Hoy, Ayer, …).
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

Si una fuente falla, las demás siguen funcionando y la app indica al pie cuáles no respondieron.

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
