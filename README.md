# MiIPTV Portable

Clon funcional de un reproductor IPTV estilo iMPlayer, como app **portable para
Windows**: un solo `.exe` sin instalador. Implementación original, sin código de
la app de referencia.

- Fuentes: **Xtream Codes API** y **listas m3u/m3u8** (URL o archivo)
- TV en vivo, guía EPG (XMLTV), películas, series, favoritos
- Reproductor interno (HLS / MPEG-TS / MP4) + botón "Abrir en VLC"
- Configuración en `data/` junto al `.exe` (portable de verdad)

## Desarrollo

```bash
npm install
npx tauri dev        # requiere Rust instalado
```

El frontend (`src/`) es una SPA vainilla: se puede abrir `src/index.html`
directo en el navegador para probar la UI (las llamadas a la API Tauri se
sustituyen por `localStorage` cuando no hay backend).

## Build portable (CI)

Push a `main` → GitHub Actions compila en `windows-latest` y sube
`MiIPTV-Portable-win64.zip` con el `.exe` listo para copiar a un USB.
