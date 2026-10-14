// MiIPTV Portable — fuentes IPTV: helper HTTP, parser m3u y cliente Xtream Codes.

export const isTauri = typeof window.__TAURI__ !== 'undefined';

function tauriInvoke(cmd, args) {
  return window.__TAURI__.core.invoke(cmd, args);
}

/** GET de texto sin CORS: en Tauri va por Rust; en navegador, fetch directo. */
export async function httpGet(url) {
  if (isTauri) return tauriInvoke('http_get', { url });
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

/** Lee un archivo local .m3u (input file) como texto. */
export function readLocalFile(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsText(file);
  });
}

// ---------------------------------------------------------------- parser m3u
function parseExtInf(line) {
  // #EXTINF:-1 tvg-id="x" tvg-logo="y" group-title="z",Nombre Canal
  const m = line.match(/^#EXTINF:(-?\d+)\s*(.*?),(.*)$/);
  if (!m) return null;
  const attrs = {};
  const attrRe = /([\w-]+)="([^"]*)"/g;
  let a;
  while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2];
  return { duration: parseInt(m[1], 10), name: m[3].trim(), attrs };
}

export function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let epgUrl = null;
  let pending = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) {
      const m = line.match(/url-tvg="([^"]*)"/);
      if (m) epgUrl = m[1];
      continue;
    }
    if (line.startsWith('#EXTINF')) {
      pending = parseExtInf(line);
      continue;
    }
    if (line.startsWith('#')) continue;
    if (pending) {
      channels.push({
        id: pending.attrs['tvg-id'] || pending.name,
        name: pending.attrs['tvg-name'] || pending.name,
        logo: pending.attrs['tvg-logo'] || '',
        group: pending.attrs['group-title'] || 'Sin grupo',
        url: line,
      });
      pending = null;
    }
  }
  // grupos en orden de aparición
  const groups = [];
  const seen = new Set();
  for (const c of channels) {
    if (!seen.has(c.group)) { seen.add(c.group); groups.push(c.group); }
  }
  return { channels, groups, epgUrl };
}

// ------------------------------------------------------------ cliente Xtream
export class Xtream {
  constructor(host, username, password) {
    this.host = host.replace(/\/+$/, '');
    this.u = username;
    this.p = password;
  }
  api(params = {}) {
    const q = new URLSearchParams({ username: this.u, password: this.p, ...params });
    return httpGet(`${this.host}/player_api.php?${q}`).then(JSON.parse);
  }
  async login() {
    const d = await this.api();
    if (d?.user_info?.auth !== 1 && d?.user_info?.auth !== '1')
      throw new Error('Login Xtream rechazado (revisa usuario/clave)');
    return d.user_info;
  }
  liveCategories()  { return this.api({ action: 'get_live_categories' }); }
  liveStreams(cat = '') { return this.api({ action: 'get_live_streams', ...(cat ? { category_id: cat } : {}) }); }
  vodCategories()   { return this.api({ action: 'get_vod_categories' }); }
  vodStreams(cat = '')  { return this.api({ action: 'get_vod_streams', ...(cat ? { category_id: cat } : {}) }); }
  seriesCategories(){ return this.api({ action: 'get_series_categories' }); }
  series(cat = '')       { return this.api({ action: 'get_series', ...(cat ? { category_id: cat } : {}) }); }
  seriesInfo(id)    { return this.api({ action: 'get_series_info', series_id: id }); }
  vodInfo(vodId)    { return this.api({ action: 'get_vod_info', vod_id: vodId }); }
  shortEpg(streamId, limit = 4) { return this.api({ action: 'get_short_epg', stream_id: streamId, limit }); }
  epgXml() { // puede ser pesado; con gzip lo maneja Rust
    const q = new URLSearchParams({ username: this.u, password: this.p });
    return httpGet(`${this.host}/xmltv.php?${q}`);
  }
  liveUrl(streamId, ext = 'm3u8') {
    return `${this.host}/live/${this.u}/${this.p}/${streamId}.${ext}`;
  }
  movieUrl(streamId, container = 'mp4') {
    return `${this.host}/movie/${this.u}/${this.p}/${streamId}.${container}`;
  }
  episodeUrl(streamId, container = 'mp4') {
    return `${this.host}/series/${this.u}/${this.p}/${streamId}.${container}`;
  }
}

/** Normaliza un stream Xtream a canal interno. */
export function xtreamToChannel(s) {
  return {
    id: 'xt_' + s.stream_id,
    xtId: s.stream_id,
    name: s.name,
    logo: s.stream_icon || '',
    group: s._catName || 'Sin grupo',
    url: null, // se resuelve al reproducir (liveUrl)
    epgId: s.epg_channel_id || null,
  };
}
