# MiIPTV Portable — Diseño de arquitectura (v1)

Clon funcional de iMPlayer como app **portable para Windows**: un solo `.exe`, sin
instalador, con toda la configuración guardada **junto al ejecutable**
(nada en el registro ni en AppData).

> Nota de marca: "iMPlayer" es marca de HzApps. El proyecto usa nombre propio
> (propuesto: **MiIPTV Portable**) e implementación 100% original: no se copia
> código ni recursos de la app original.

## Stack elegido: Tauri v2 (Rust + WebView2)

| Decisión | Por qué |
|---|---|
| Tauri v2 | `.exe` pequeño (~15 MB), usa el WebView2 que ya trae Windows 10/11, sin runtime extra |
| Frontend web (HTML/JS vainilla) | Mismo patrón que Music Cloud Player / Mi Deezer: lo desarrollo y pruebo en el navegador antes de empaquetar |
| Rust solo para lo que el navegador no puede | HTTP sin CORS, archivos junto al exe, abrir VLC externo |
| GitHub Actions (`windows-latest`) | Compila el `.exe`; el workflow sube un zip portable como artifact (mismo flujo que los APKs) |

Alternativas descartadas: Electron (100 MB+, portable a medias), Python+PyInstaller
(empaquetar VLC/libVLC lo vuelve pesado y frágil), emulador Android (no es portable).

## Fuentes IPTV (las dos que usa Lice)

- **Xtream Codes API**: `player_api.php?username=&password=` → `get_live_streams`,
  `get_vod_streams`, `get_series`, `get_live_categories`, etc. EPG vía
  `xmltv.php`.
- **Lista m3u/m3u8**: URL remota o archivo local; parser propio
  (`#EXTINF` con `tvg-id`, `tvg-logo`, `group-title`).

## Reproducción de video (interna)

- **HLS** (`.m3u8`): `hls.js` (vendored en `src/vendor/`, sin CDN → funciona offline).
- **MPEG-TS** sobre HTTP: `mpegts.js` (vendored).
- **MP4/MKV** (VOD): nativo del WebView2 (Chromium).
- **Fallback**: botón "Abrir en VLC" (detecta `vlc.exe` portable o instalado;
  si no hay, abre con el reproductor por defecto del sistema).

## Datos portables

- Carpeta `data/` junto al `.exe`, creada al primer arranque.
- `config.json`: perfiles de fuente (Xtream: host/usuario/clave — la clave se
  guarda cifrada con DPAPI de Windows vía Rust; m3u: URL o ruta local).
- `favoritos.json`, `historial.json`, `epg_cache/` (XMLTV cacheado con TTL).
- Comandos Tauri `read_data_file` / `write_data_file` con la ruta resuelta en Rust
  a `current_exe().parent()/data` → portable de verdad aunque se mueva la carpeta.

## Vistas (SPA, español, tema oscuro estilo iMPlayer)

1. **TV en vivo**: grupos a la izquierda, parrilla de canales con logo, clic → reproduce.
2. **Guía EPG**: rejilla temporal por canal (datos XMLTV).
3. **Películas / Series**: catálogo con carátulas, temporadas y episodios (Xtream);
   en m3u, grupos VOD si la lista los trae.
4. **Favoritos**: canales y VOD marcados con ★.
5. **Ajustes**: añadir/editar perfiles Xtream y m3u, actualizar EPG, abrir carpeta `data`.

## Build y distribución

- `npm ci` + `tauri build --no-bundle` en CI → `target/release/mi-iptv-portable.exe`.
- El workflow comprime el exe en `MiIPTV-Portable-win64.zip` y lo sube como artifact.
- Versionado `0.x.y`; tag → release de GitHub con el zip (fase 2).
- Requisito en el PC destino: Windows 10 1803+ / 11 (WebView2 ya incluido).

## Fases

- **Fase 1** (actual): diseño + esqueleto + CI que compila un exe "hola mundo".
- **Fase 2**: reproductor v1 (fuentes, EPG, favoritos, VOD) probado en navegador con
  lista de prueba pública antes de empaquetar.
- **Fase 3**: zip portable entregado a Lice; él mete sus credenciales en Ajustes.
