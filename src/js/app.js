// MiIPTV Portable — app principal (v1).

import { isTauri, httpGet, readLocalFile, parseM3U, Xtream, xtreamToChannel } from './sources.js';
import { parseXMLTV, programsFor, nowPlaying } from './epg.js';

// ---------------------------------------------------------------- estado
const state = {
  profiles: [],        // [{id, type:'xtream'|'m3u', name, host,user,pass | url, localName}]
  activeProfile: null, // perfil cargado
  groups: [],          // grupos del perfil activo
  channels: [],        // canales normalizados {id,name,logo,group,url|xtId,epgId}
  epg: null,           // {channels:Map, programs:[]}
  favorites: new Set(),
  groupFilter: null,
  search: '',
  lastProfileId: null,
  previewId: null, previewUrl: null, // canal en vista previa
  playingCh: null, // canal sonando en el reproductor (para el OSD)
  settings: { timeshiftMinutes: 30 }, // timeshift en RAM (0 = desactivado)
  vod: [], vodLoaded: false, vodSearch: '', vodCats: [], vodCat: null,
  series: [], seriesLoaded: false, seriesSearch: '', seriesCats: [], seriesCat: null,
  openSeries: null, // {info} serie abierta
  openMovie: null, // {item, info, data} película abierta
};

// ------------------------------------------------------------- almacenamiento
function tauriInvoke(cmd, args) { return window.__TAURI__.core.invoke(cmd, args); }
const store = {
  async get(name, fb = null) {
    if (isTauri) {
      try { return JSON.parse(await tauriInvoke('read_data_file', { name })); }
      catch { return fb; }
    }
    const raw = localStorage.getItem('miiptv_' + name);
    return raw ? JSON.parse(raw) : fb;
  },
  async set(name, value) {
    const text = JSON.stringify(value, null, 2);
    if (isTauri) await tauriInvoke('write_data_file', { name, content: text });
    else localStorage.setItem('miiptv_' + name, text);
  }
};

// ------------------------------------------------------------------ helpers
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

// --------------------------------------------------------------- navegación
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    $('view-' + btn.dataset.view).classList.add('active');
    if (btn.dataset.view === 'epg') renderGuide();
    if (btn.dataset.view === 'favs') renderFavs();
    if (btn.dataset.view === 'movies') renderMovies();
    if (btn.dataset.view === 'series') renderSeriesList();
    if (btn.dataset.view === 'multi' && !mvSlots.length) mvBuild();
    if (btn.dataset.view !== 'multi') mvStopAll();
  });
});

// ------------------------------------------------------------- películas VOD
async function renderMovies() {
  if (state.openMovie) return renderMovieDetail();
  const p = state.activeProfile;
  if (p?.type !== 'xtream' || !p._xt) {
    $('vod-cats').innerHTML = '';
    $('movies-list').innerHTML = '<p class="hint">Carga un perfil Xtream en Ajustes.</p>';
    return;
  }
  if (!state.vodCats.length) {
    try { state.vodCats = await p._xt.vodCategories(); }
    catch (e) { console.warn('cats VOD:', e.message); }
  }
  if (!state.vodLoaded) {
    toast('Cargando películas…');
    try {
      state.vod = await p._xt.vodStreams(state.vodCat || '');
      state.vodLoaded = true;
    } catch (e) { toast('Error VOD: ' + e.message); }
  }
  renderVodCats();
  renderMoviesGrid();
}

function renderVodCats() {
  const box = $('vod-cats');
  if (!state.vodCats.length) { box.innerHTML = ''; return; }
  const cur = String(state.vodCat ?? '');
  const mk = (id, name) =>
    `<button class="grp ${cur === String(id ?? '') ? 'active' : ''}" data-vc="${id ?? ''}">${esc(name)}</button>`;
  box.innerHTML = mk(null, 'Todas') + state.vodCats.map(c => mk(c.category_id, c.category_name)).join('');
  box.querySelectorAll('[data-vc]').forEach(b => b.onclick = () => {
    state.vodCat = b.dataset.vc || null;
    state.vodLoaded = false;
    renderMovies();
  });
}

function renderMoviesGrid() {
  const q = state.vodSearch.toLowerCase();
  const list = state.vod.filter(v => !q || v.name.toLowerCase().includes(q)).slice(0, 300);
  $('movies-list').innerHTML = list.map(v => `
    <div class="ch vod" data-vod="${v.stream_id}">
      ${v.stream_icon ? `<img src="${esc(v.stream_icon)}" loading="lazy" onerror="this.remove()">` : '<div class="no-logo">🎬</div>'}
      <div class="ch-info"><b>${esc(v.name)}</b><small>${esc(v.container_extension || '')} ${v.rating ? '★' + v.rating : ''}</small></div>
    </div>`).join('') || '<p class="hint">Sin películas en este grupo.</p>';
  $('movies-list').querySelectorAll('[data-vod]').forEach(el => el.onclick = () => {
    const v = state.vod.find(x => String(x.stream_id) === el.dataset.vod);
    if (v) showMovieDetail(v);
  });
}

// ------------------------------------------------------------------ series
async function renderSeriesList() {
  if (state.openSeries) return renderSeriesDetail();
  const p = state.activeProfile;
  if (p?.type !== 'xtream' || !p._xt) {
    $('series-cats').innerHTML = '';
    $('series-list').innerHTML = '<p class="hint">Carga un perfil Xtream en Ajustes.</p>';
    return;
  }
  if (!state.seriesCats.length) {
    try { state.seriesCats = await p._xt.seriesCategories(); }
    catch (e) { console.warn('cats series:', e.message); }
  }
  if (!state.seriesLoaded) {
    toast('Cargando series…');
    try {
      state.series = await p._xt.series(state.seriesCat || '');
      state.seriesLoaded = true;
    } catch (e) { toast('Error series: ' + e.message); }
  }
  renderSeriesCats();
  renderSeriesGrid();
}

function renderSeriesCats() {
  const box = $('series-cats');
  if (!state.seriesCats.length) { box.innerHTML = ''; return; }
  const cur = String(state.seriesCat ?? '');
  const mk = (id, name) =>
    `<button class="grp ${cur === String(id ?? '') ? 'active' : ''}" data-sc="${id ?? ''}">${esc(name)}</button>`;
  box.innerHTML = mk(null, 'Todas') + state.seriesCats.map(c => mk(c.category_id, c.category_name)).join('');
  box.querySelectorAll('[data-sc]').forEach(b => b.onclick = () => {
    state.seriesCat = b.dataset.sc || null;
    state.seriesLoaded = false;
    state.openSeries = null;
    renderSeriesList();
  });
}

function renderSeriesGrid() {
  const q = state.seriesSearch.toLowerCase();
  const list = state.series.filter(s => !q || s.name.toLowerCase().includes(q)).slice(0, 300);
  $('series-list').innerHTML = list.map(s => `
    <div class="ch vod" data-ser="${s.series_id}">
      ${s.cover ? `<img src="${esc(s.cover)}" loading="lazy" onerror="this.remove()">` : '<div class="no-logo">📺</div>'}
      <div class="ch-info"><b>${esc(s.name)}</b><small>${esc(s.genre || '')}</small></div>
    </div>`).join('') || '<p class="hint">Sin series en este grupo.</p>';
  $('series-list').querySelectorAll('[data-ser]').forEach(el => el.onclick = () => {
    const s = state.series.find(x => String(x.series_id) === el.dataset.ser);
    if (s) showSeriesDetail(s);
  });
}

/** Normaliza las temporadas de get_series_info a [[nombreTemporada, [episodios]]].
 *  OJO: `seasons` es metadato de temporadas (sin episodios); la lista real
 *  de episodios por temporada viene en `episodes`. Por eso `episodes` manda. */
function seasonsOf(info) {
  const raw = info.episodes || info.seasons || {};
  if (Array.isArray(raw)) {
    // Si es arreglo: ¿son episodios o metadato de temporadas?
    // Los episodios tienen episode_num o id de episodio; el metadato no.
    const looksEpisodes = raw.length && (raw[0].episode_num != null || raw[0].stream_id != null);
    if (looksEpisodes) return [['', raw]];
    return []; // metadato de temporadas sin `episodes`: nada que mostrar
  }
  return Object.entries(raw).map(([sn, eps]) => [
    sn,
    Array.isArray(eps) ? eps : (eps && typeof eps === 'object' ? [eps] : []),
  ]);
}

// ------------------------------------------------------- ficha de película
async function showMovieDetail(v) {
  const p = state.activeProfile;
  if (!p?._xt) return;
  toast('Cargando información…');
  try {
    const d = await p._xt.vodInfo(v.stream_id);
    state.openMovie = { item: v, info: d.info || {}, data: d.movie_data || {} };
    renderMovieDetail();
  } catch (e) { toast('Error: ' + e.message); }
}

function detailMeta(info) {
  return [info.genre, info.rating ? '★' + info.rating : null,
          info.releaseDate || info.releasedate || null]
    .filter(Boolean).join(' · ');
}

function renderMovieDetail() {
  const { item, info } = state.openMovie;
  const p = state.activeProfile;
  const poster = info.movie_image || item.stream_icon || '';
  const meta = detailMeta(info);
  $('movie-detail').innerHTML = `
    <button id="detail-back">← Volver</button>
    <div class="detail">
      ${poster ? `<img class="detail-poster" src="${esc(poster)}" onerror="this.remove()">` : ''}
      <div class="detail-info">
        <h2>${esc(info.name || info.o_name || item.name)}</h2>
        ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
        ${info.plot ? `<p class="plot">${esc(info.plot)}</p>` : ''}
        ${info.cast ? `<p class="cast"><b>Reparto:</b> ${esc(info.cast)}</p>` : ''}
        ${info.director ? `<p class="cast"><b>Director:</b> ${esc(info.director)}</p>` : ''}
        <button id="detail-play" class="play-btn">▶ Reproducir</button>
      </div>
    </div>`;
  showMovieView(true);
  $('detail-back').onclick = () => { state.openMovie = null; showMovieView(false); renderMovies(); };
  $('detail-play').onclick = () => {
    const ext = info.container_extension || item.container_extension || 'mp4';
    playStream(p._xt.movieUrl(item.stream_id, ext), info.name || item.name);
  };
}

/** Alterna entre la cuadrícula y la ficha de película. */
function showMovieView(detail) {
  $('movies-list').classList.toggle('hidden', detail);
  $('vod-cats').classList.toggle('hidden', detail);
  $('movie-detail').classList.toggle('hidden', !detail);
}

// ---------------------------------------------------------- ficha de serie
async function showSeriesDetail(s) {
  const p = state.activeProfile;
  if (!p?._xt) return;
  toast('Cargando información…');
  try {
    state.openSeries = await p._xt.seriesInfo(s.series_id);
    renderSeriesDetail();
  } catch (e) { toast('Error: ' + e.message); }
}

function renderSeriesDetail() {
  const info = state.openSeries;
  const det = info.info || {};
  const p = state.activeProfile;
  const seasons = seasonsOf(info);
  const allEps = seasons.flatMap(([, eps]) => eps);
  const meta = detailMeta(det);
  let html = `
    <button id="detail-back">← Volver</button>
    <div class="detail">
      ${det.cover ? `<img class="detail-poster" src="${esc(det.cover)}" onerror="this.remove()">` : ''}
      <div class="detail-info">
        <h2>${esc(det.name || '')}</h2>
        ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
        ${det.plot ? `<p class="plot">${esc(det.plot)}</p>` : ''}
        ${det.cast ? `<p class="cast"><b>Reparto:</b> ${esc(det.cast)}</p>` : ''}
      </div>
    </div>`;
  for (const [sn, eps] of seasons) {
    html += `<h3>${sn ? 'Temporada ' + esc(sn) + ` (${eps.length})` : `Episodios (${eps.length})`}</h3><div class="ep-grid">` + eps.map(ep => `
      <button class="ep" data-ep="${ep.id}">${esc(ep.episode_num ? 'E' + ep.episode_num + ' — ' : '')}${esc(ep.title || ('Episodio ' + (ep.episode_num || '')))}</button>`
    ).join('') + `</div>`;
  }
  if (!allEps.length) html += '<p class="hint">Esta serie no trae episodios en el proveedor.</p>';
  $('series-detail').innerHTML = html;
  showSeriesView(true);
  $('detail-back').onclick = () => { state.openSeries = null; showSeriesView(false); renderSeriesList(); };
  $('series-detail').querySelectorAll('[data-ep]').forEach(b => b.onclick = () => {
    const ep = allEps.find(x => String(x.id) === b.dataset.ep);
    if (!ep) return toast('Episodio no disponible');
    playStream(p._xt.episodeUrl(ep.id, ep.container_extension || 'mp4'),
      `${det.name || ''} E${ep.episode_num || ''}`);
  });
}

/** Alterna entre la cuadrícula y la ficha de serie. */
function showSeriesView(detail) {
  $('series-list').classList.toggle('hidden', detail);
  $('series-cats').classList.toggle('hidden', detail);
  $('series-detail').classList.toggle('hidden', !detail);
}

// -------------------------------------------------------- perfiles (ajustes)
function profileForm(type) {
  return type === 'xtream' ? `
    <input id="pf-name" placeholder="Nombre (ej: Mi proveedor)">
    <input id="pf-host" placeholder="Host (http://proveedor.tv:8080)">
    <input id="pf-user" placeholder="Usuario">
    <input id="pf-pass" type="password" placeholder="Contraseña">
    <button id="pf-save">Guardar perfil Xtream</button>`
  : `
    <input id="pf-name" placeholder="Nombre (ej: Lista deportes)">
    <input id="pf-url" placeholder="URL de la lista m3u (opcional si subes archivo)">
    <label class="file">o subir archivo .m3u <input type="file" id="pf-file" accept=".m3u,.m3u8"></label>
    <button id="pf-save">Guardar perfil m3u</button>`;
}

async function saveProfiles() {
  // No guardar la contraseña en claro en el JSON si hay backend: fase 2 la cifra con DPAPI.
  await store.set('config.json', {
    profiles: state.profiles,
    lastProfile: state.lastProfileId || null,
    settings: state.settings,
  });
}

function renderProfiles() {
  const box = $('profiles');
  box.innerHTML = state.profiles.map(p => `
    <div class="profile">
      <div><b>${esc(p.name)}</b><br><small>${p.type === 'xtream' ? esc(p.host) : esc(p.url || p.localName || 'archivo local')}</small></div>
      <div class="row">
        <button data-load="${p.id}">Cargar</button>
        <button data-del="${p.id}" class="danger">✕</button>
      </div>
    </div>`).join('') || '<p class="hint">Sin perfiles. Agrega tu fuente Xtream o tu lista m3u.</p>';
  box.querySelectorAll('[data-load]').forEach(b => b.onclick = () => loadProfile(b.dataset.load));
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const delId = b.dataset.del;
    state.profiles = state.profiles.filter(p => p.id !== delId);
    if (state.lastProfileId === delId) state.lastProfileId = null;
    if (state.activeProfile?.id === delId) {
      state.activeProfile = null;
      state.channels = []; state.groups = []; state.epg = null;
      state.vod = []; state.vodLoaded = false; state.vodCats = []; state.vodCat = null;
      state.series = []; state.seriesLoaded = false; state.seriesCats = []; state.seriesCat = null;
      state.openSeries = null; state.openMovie = null;
      closePreview();
      renderGroups(); renderChannels();
      $('active-source').textContent = 'Sin fuente';
    }
    await saveProfiles(); renderProfiles();
  });
  $('pf-type').onchange = e => { $('pf-fields').innerHTML = profileForm(e.target.value); wireProfileSave(e.target.value); };
  $('pf-fields').innerHTML = profileForm($('pf-type').value);
  wireProfileSave($('pf-type').value);
}

function wireProfileSave(type) {
  $('pf-save').onclick = async () => {
    const name = $('pf-name').value.trim();
    if (!name) return toast('Ponle un nombre al perfil');
    const p = { id: 'p' + Date.now(), type, name };
    if (type === 'xtream') {
      p.host = $('pf-host').value.trim().replace(/\/+$/, '');
      p.user = $('pf-user').value.trim();
      p.pass = $('pf-pass').value;
      if (!p.host || !p.user) return toast('Faltan host o usuario');
    } else {
      p.url = $('pf-url').value.trim();
      const f = $('pf-file').files[0];
      if (f) { p.localName = f.name; p.localText = await readLocalFile(f); }
      if (!p.url && !p.localText) return toast('Pega una URL o sube un archivo');
    }
    state.profiles.push(p);
    await saveProfiles(); renderProfiles();
    toast('Perfil guardado');
  };
}

// ------------------------------------------------------------- cargar fuente
async function loadProfile(id) {
  const p = state.profiles.find(x => x.id === id);
  if (!p) return;
  toast('Cargando ' + p.name + '…');
  try {
    if (p.type === 'm3u') await loadM3U(p);
    else await loadXtream(p);
    state.activeProfile = p;
    state.lastProfileId = id;
    await saveProfiles();
    state.groupFilter = null; state.search = '';
    state.vod = []; state.vodLoaded = false; state.vodCats = []; state.vodCat = null;
    state.series = []; state.seriesLoaded = false; state.seriesCats = []; state.seriesCat = null;
    state.openSeries = null; state.openMovie = null;
    closePreview();
    mvSlots.forEach((_, i) => mvClear(i));
    $('active-source').textContent = 'Fuente: ' + p.name;
    renderGroups(); renderChannels();
    toast(`Listo: ${state.channels.length} canales`);
  } catch (e) {
    console.error(e);
    toast('Error: ' + e.message);
  }
}

async function loadM3U(p) {
  const text = p.localText || await httpGet(p.url);
  const { channels, groups, epgUrl } = parseM3U(text);
  state.channels = channels; state.groups = groups;
  state.epg = null;
  const url = epgUrl || p.epgUrl;
  if (url) loadEpgXml(url).catch(e => console.warn('EPG:', e.message));
}

async function loadXtream(p) {
  const x = new Xtream(p.host, p.user, p.pass);
  await x.login();
  p._xt = x;
  const [cats, streams] = await Promise.all([x.liveCategories(), x.liveStreams()]);
  const catName = new Map(cats.map(c => [String(c.category_id), c.category_name]));
  state.groups = cats.map(c => c.category_name);
  state.channels = streams.map(s => {
    const ch = xtreamToChannel(s);
    ch.group = catName.get(String(s.category_id)) || 'Sin grupo';
    return ch;
  });
  state.epg = null;
  x.epgXml().then(t => { state.epg = parseXMLTV(t); renderChannels(); })
    .catch(e => console.warn('EPG:', e.message));
}

async function loadEpgXml(url) {
  const xml = await httpGet(url);
  state.epg = parseXMLTV(xml);
  renderChannels();
}

// --------------------------------------------------------------- TV en vivo
function channelEpgId(ch) {
  // m3u: tvg-id; Xtream: epg_channel_id
  return ch.epgId || ch.id;
}

function renderGroups() {
  const box = $('groups');
  const mk = (g, n) => `<button class="grp ${state.groupFilter === g ? 'active' : ''}" data-g="${esc(g ?? '')}">${esc(g ?? 'Todos')} <span>${n}</span></button>`;
  let html = mk(null, state.channels.length);
  html += state.groups.map(g =>
    mk(g, state.channels.filter(c => c.group === g).length)).join('');
  box.innerHTML = html;
  box.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
    state.groupFilter = b.dataset.g || null;
    renderGroups(); renderChannels();
  });
}

function filteredChannels() {
  const q = state.search.toLowerCase();
  return state.channels.filter(c =>
    (!state.groupFilter || c.group === state.groupFilter) &&
    (!q || c.name.toLowerCase().includes(q)));
}

function renderChannels() {
  const list = filteredChannels();
  const now = Date.now();
  $('live-list').innerHTML = list.slice(0, 400).map((c, i) => {
    const prog = state.epg ? nowPlaying(state.epg.programs, channelEpgId(c), now) : null;
    const fav = state.favorites.has(c.id) ? '★' : '☆';
    return `<div class="ch ${state.previewId === c.id ? 'sel' : ''}" data-id="${esc(c.id)}">
      <span class="ch-num">${i + 1}</span>
      ${c.logo ? `<img src="${esc(c.logo)}" loading="lazy" onerror="this.remove()">` : '<div class="no-logo">📺</div>'}
      <div class="ch-info"><b>${esc(c.name)}</b><small>${esc(prog ? prog.title : c.group)}</small></div>
      <button class="fav" data-fav="${esc(c.id)}">${fav}</button>
    </div>`;
  }).join('') || '<p class="hint">Carga un perfil en Ajustes para ver canales.</p>';
  if (list.length > 400) $('live-list').insertAdjacentHTML('beforeend',
    `<p class="hint">Mostrando 400 de ${list.length}. Usa el buscador para filtrar.</p>`);
  $('live-list').querySelectorAll('.ch').forEach(el => {
    el.onclick = e => {
      if (e.target.dataset.fav) return;
      showPreview(el.dataset.id);
    };
  });
  $('live-list').querySelectorAll('[data-fav]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const id = b.dataset.fav;
    state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
    await store.set('favoritos.json', [...state.favorites]);
    renderChannels();
  });
}

$('live-search')?.addEventListener('input', e => {
  state.search = e.target.value;
  renderChannels();
});
$('movies-search')?.addEventListener('input', e => {
  state.vodSearch = e.target.value;
  renderMovies();
});
$('series-search')?.addEventListener('input', e => {
  state.seriesSearch = e.target.value;
  state.openSeries = null;
  renderSeriesList();
});

// ------------------------------------------------------------------ guía EPG
const EPG_PX_MIN = 6;   // 6px por minuto → 180px cada 30 min
const EPG_CH_W = 180;   // ancho de la columna de canal

function renderGuide() {
  const box = $('epg-grid');
  if (!state.epg || !state.channels.length) {
    box.innerHTML = '<p class="hint">Carga un perfil con EPG para ver la guía.</p>';
    return;
  }
  const now = Date.now();
  const wStart = Math.floor((now - 30 * 60000) / 1800000) * 1800000;
  const wEnd = wStart + 4 * 3600000;
  const X = t => Math.round((t - wStart) / 60000 * EPG_PX_MIN);
  const trackW = X(wEnd);
  const nowX = X(now);

  let slots = '';
  for (let t = wStart; t < wEnd; t += 1800000) {
    slots += `<span class="epg-slot" style="left:${X(t)}px">${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
  }

  const chans = state.channels.filter(c => state.epg.channels.has(channelEpgId(c))).slice(0, 60);
  state.epgShown = [];
  const rows = chans.map(c => {
    const progs = programsFor(state.epg.programs, channelEpgId(c), wStart, wEnd);
    const blocks = progs.map(p => {
      const l = Math.max(0, X(p.start)), r = Math.min(trackW, X(p.stop));
      if (r - l < 10) return '';
      const i = state.epgShown.length;
      state.epgShown.push({ ...p, channelName: c.name });
      const live = p.start <= now && p.stop > now;
      const t1 = new Date(p.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const t2 = new Date(p.stop).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `<button class="epg-blk ${live ? 'live' : ''}" style="left:${l}px;width:${r - l}px" data-epg="${i}">
        <b>${esc(p.title)}</b><small>${t1} - ${t2}</small></button>`;
    }).join('');
    return `<div class="epg-tl-row">
      <div class="epg-tl-ch" style="width:${EPG_CH_W}px">${c.logo ? `<img src="${esc(c.logo)}" onerror="this.remove()">` : ''}<b>${esc(c.name)}</b></div>
      <div class="epg-tl-track" style="width:${trackW}px">${blocks || '<span class="hint">sin datos</span>'}</div>
    </div>`;
  }).join('');

  box.innerHTML = `
    <div id="epg-detail" class="epg-detail hidden"></div>
    <div class="epg-tl">
      <div class="epg-tl-head">
        <div class="epg-tl-corner" style="width:${EPG_CH_W}px"></div>
        <div class="epg-tl-slots" style="width:${trackW}px">${slots}<span class="epg-now-tag" style="left:${nowX}px">AHORA</span></div>
      </div>
      <div class="epg-tl-body">${rows}<div class="epg-now-line" style="left:calc(${EPG_CH_W}px + ${nowX}px)"></div></div>
    </div>`;

  box.querySelectorAll('[data-epg]').forEach(b =>
    b.onclick = () => showEpgDetail(state.epgShown[+b.dataset.epg], b));

  const tl = box.querySelector('.epg-tl');
  if (tl) tl.scrollLeft = Math.max(0, nowX - 200);
  const firstLive = box.querySelector('.epg-blk.live');
  if (firstLive) showEpgDetail(state.epgShown[+firstLive.dataset.epg], firstLive);
}

/** Ficha del programa seleccionado: título, canal, horario, progreso y descripción. */
function showEpgDetail(p, el) {
  if (!p) return;
  document.querySelectorAll('.epg-blk.sel').forEach(x => x.classList.remove('sel'));
  el?.classList.add('sel');
  const now = Date.now();
  const t1 = new Date(p.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const t2 = new Date(p.stop).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const left = Math.max(0, Math.round((p.stop - now) / 60000));
  const pct = Math.min(100, Math.max(0, (now - p.start) / Math.max(1, p.stop - p.start) * 100));
  const d = $('epg-detail');
  d.classList.remove('hidden');
  d.innerHTML = `
    <div class="epg-d-top"><h3>${esc(p.title || 'Sin título')}</h3><span class="meta">${esc(p.channelName || '')}</span></div>
    <div class="meta">${t1} - ${t2} · ${left} min restantes</div>
    <div class="epg-d-progress"><div style="width:${pct}%"></div></div>
    <p>${esc(p.desc || 'Sin descripción.')}</p>`;
}

// Refresca la guía cada minuto si está visible (línea AHORA y progreso al día)
setInterval(() => {
  const v = $('view-guide');
  if (!v || !v.classList.contains('active') || !state.epg) return;
  const tl = v.querySelector('.epg-tl');
  const sl = tl ? tl.scrollLeft : 0;
  const sel = document.querySelector('.epg-blk.sel');
  const selIdx = sel ? sel.dataset.epg : null;
  renderGuide();
  const tl2 = v.querySelector('.epg-tl');
  if (tl2) tl2.scrollLeft = sl;
  if (selIdx != null) {
    const b = v.querySelector(`[data-epg="${selIdx}"]`);
    if (b) showEpgDetail(state.epgShown[+selIdx], b);
  }
}, 60000);

// ---------------------------------------------------------------- favoritos
function renderFavs() {
  const list = state.channels.filter(c => state.favorites.has(c.id));
  $('favs-list').innerHTML = list.map(c => `
    <div class="ch" data-id="${esc(c.id)}">
      ${c.logo ? `<img src="${esc(c.logo)}" loading="lazy" onerror="this.remove()">` : '<div class="no-logo">📺</div>'}
      <div class="ch-info"><b>${esc(c.name)}</b><small>${esc(c.group)}</small></div>
    </div>`).join('') || '<p class="hint">Marca canales con ☆ para verlos aquí.</p>';
  $('favs-list').querySelectorAll('.ch').forEach(el => el.onclick = () => playChannel(el.dataset.id));
}

// --------------------------------------------------------------- reproductor
const video = $('video'), modal = $('player-modal');
let hls = null, tsPlayer = null;

function stopPlayer() {
  if (hls) { hls.destroy(); hls = null; }
  if (tsPlayer) { tsPlayer.destroy(); tsPlayer = null; }
  video.pause(); video.removeAttribute('src'); video.load();
}

function streamUrlFor(ch) {
  if (ch.url) return ch.url; // m3u
  const p = state.activeProfile;
  if (p?.type === 'xtream' && p._xt) return p._xt.liveUrl(ch.xtId, 'm3u8');
  return null;
}

function playChannel(id) {
  const ch = state.channels.find(c => c.id === id);
  if (!ch) return;
  const url = streamUrlFor(ch);
  if (!url) return toast('Sin URL de stream');
  playStream(url, ch.name);
  state.playingCh = ch;
  updatePlayerFavBtn();
}

/** Estrella de favorito del canal actual (solo TV en vivo). */
function updatePlayerFavBtn() {
  const b = $('btn-fav');
  const ch = state.playingCh;
  b.style.display = ch ? '' : 'none';
  b.textContent = (ch && state.favorites.has(ch.id)) ? '★' : '☆';
}

$('btn-fav').onclick = async () => {
  const ch = state.playingCh;
  if (!ch) return;
  state.favorites.has(ch.id) ? state.favorites.delete(ch.id) : state.favorites.add(ch.id);
  await store.set('favoritos.json', [...state.favorites]);
  updatePlayerFavBtn();
  renderChannels();
};

/** Lista rápida de canales sin salir del reproductor. */
function renderPlayerChList(q = '') {
  const box = $('ch-list-items');
  const query = q.toLowerCase();
  const now = Date.now();
  const list = state.channels.filter(c => !query || c.name.toLowerCase().includes(query)).slice(0, 200);
  box.innerHTML = list.map(c => {
    const prog = state.epg ? nowPlaying(state.epg.programs, channelEpgId(c), now) : null;
    return `<button class="ch-row ${state.playingCh?.id === c.id ? 'cur' : ''}" data-id="${esc(c.id)}">
      ${c.logo ? `<img src="${esc(c.logo)}" loading="lazy" onerror="this.remove()">` : '<div class="no-logo">📺</div>'}
      <div class="ch-info"><b>${esc(c.name)}</b><small>${esc(prog ? prog.title : c.group)}</small></div>
    </button>`;
  }).join('') || '<p class="hint">Sin canales.</p>';
  box.querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
    $('ch-list').classList.add('hidden');
    playChannel(b.dataset.id);
  });
}

$('btn-chlist').onclick = () => {
  const p = $('ch-list');
  if (p.classList.contains('hidden')) {
    renderPlayerChList($('ch-list-search').value || '');
    p.classList.remove('hidden');
  } else p.classList.add('hidden');
};
$('ch-list-search').addEventListener('input', e => renderPlayerChList(e.target.value));

function fmtDelay(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

/** Config de hls.js con timeshift en RAM según Ajustes. */
function hlsConfig() {
  const s = (state.settings.timeshiftMinutes || 0) * 60;
  const cfg = { maxBufferLength: 30 };
  if (s > 0) {
    cfg.backBufferLength = s;                       // ventana de timeshift (lo ya visto)
    cfg.maxMaxBufferLength = Math.max(600, s);       // techo del buffer
    cfg.maxBufferSize = Math.max(60 * 1024 * 1024, s * 2 * 1024 * 1024); // ~16 Mbps
  }
  return cfg;
}

/** Insignia "-MM:SS del en vivo" + botón ● EN VIVO (solo HLS en vivo). */
function updateTsUi() {
  const badge = $('ts-delay'), btn = $('btn-live');
  let delay = 0;
  if (hls && hls.liveSyncPosition != null && isFinite(hls.liveSyncPosition)) {
    delay = hls.liveSyncPosition - video.currentTime;
  }
  if (delay > 8) {
    badge.textContent = `-${fmtDelay(delay)} del en vivo`;
    badge.classList.remove('hidden');
    btn.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
    btn.classList.add('hidden');
  }
}

function playStream(url, title = '') {
  stopPlayer();
  stopPreview();
  hideOsd();
  mvStopAll();
  $('ch-list').classList.add('hidden');
  state.playingCh = null;
  updatePlayerFavBtn();
  $('now-playing').textContent = title;
  modal.dataset.url = url;
  modal.classList.remove('hidden');
  updateTsUi();
  if (/\.m3u8($|\?)/.test(url) && window.Hls?.isSupported()) {
    hls = new window.Hls(hlsConfig());
    hls.loadSource(url); hls.attachMedia(video);
    hls.on(window.Hls.Events.MANIFEST_PARSED, updateTsUi);
  } else if (window.mpegts?.isSupported()) {
    tsPlayer = window.mpegts.createPlayer({ type: 'mse', isLive: true, url });
    tsPlayer.attachMediaElement(video); tsPlayer.load();
  } else {
    video.src = url;
  }
  video.play().catch(() => {});
}

video.addEventListener('timeupdate', updateTsUi);
$('btn-live').onclick = () => {
  if (hls && hls.liveSyncPosition != null && isFinite(hls.liveSyncPosition)) {
    video.currentTime = hls.liveSyncPosition;
  }
};

// ------------------------------------------------------- OSD pantalla completa
let osdTimer = null;

function hideOsd() {
  clearTimeout(osdTimer);
  $('osd').classList.add('hidden');
}

/** Llena el OSD: canal, programa al aire con progreso, resolución, desc y siguiente. */
function fillOsd() {
  const nowD = new Date(), t = nowD.getTime();
  $('osd-clock').textContent =
    nowD.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' +
    nowD.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const ch = state.playingCh;
  $('osd-title').textContent = ch ? ch.name : ($('now-playing').textContent || '');
  const res = video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : '';
  const prog = (ch && state.epg) ? nowPlaying(state.epg.programs, channelEpgId(ch), t) : null;
  if (prog) {
    const left = Math.max(0, Math.round((prog.stop - t) / 60000));
    $('osd-prog').textContent =
      `${prog.title} · ${hhmm(prog.start)} - ${hhmm(prog.stop)} · ${left} min restantes${res ? ' · ' + res : ''}`;
    $('osd-bar').style.width = Math.min(100, Math.max(0,
      (t - prog.start) / Math.max(1, prog.stop - prog.start) * 100)) + '%';
    $('osd-desc').textContent = prog.desc || '';
    const next = programsFor(state.epg.programs, channelEpgId(ch), t, t + 3 * 3600000)
      .filter(p => p.start >= t).slice(0, 1)[0];
    $('osd-next').textContent = next ? `Siguiente ${hhmm(next.start)}: ${next.title}` : '';
  } else {
    $('osd-prog').textContent = res;
    $('osd-bar').style.width = '0%';
    $('osd-desc').textContent = '';
    $('osd-next').textContent = '';
  }
}

/** Tocar el video muestra/oculta la info; se oculta sola a los 6 segundos. */
video.addEventListener('click', () => {
  const osd = $('osd');
  if (osd.classList.contains('hidden')) {
    fillOsd();
    osd.classList.remove('hidden');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(hideOsd, 6000);
  } else hideOsd();
});

$('btn-close').onclick = () => {
  stopPlayer();
  hideOsd();
  modal.classList.add('hidden');
  if (state.previewId) showPreview(state.previewId); // retoma la vista previa
};

/** Abre una URL en VLC (o app predeterminada). La usan el reproductor y la vista previa. */
async function openExternal(url) {
  if (!url) return;
  if (isTauri) {
    try {
      const how = await tauriInvoke('open_external', { url });
      if (how === 'default') toast('VLC no encontrado; se abrió con la app predeterminada');
    } catch (e) { toast('No se pudo abrir: ' + (e?.message || e)); }
    return;
  }
  window.open(url, '_blank');
}
$('btn-vlc').onclick = () => openExternal(modal.dataset.url);

// ------------------------------------------------- vista previa (TV en vivo)
const pvVideo = $('pv-video');
let pvHls = null, pvTs = null;

function stopPreview() {
  if (pvHls) { pvHls.destroy(); pvHls = null; }
  if (pvTs) { pvTs.destroy(); pvTs = null; }
  if (pvVideo) { pvVideo.pause(); pvVideo.removeAttribute('src'); pvVideo.load(); }
}

const hhmm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Tocar un canal: lo reproduce en pequeño + ficha con lo que está al aire. */
function showPreview(id) {
  const ch = state.channels.find(c => c.id === id);
  if (!ch) return;
  const url = streamUrlFor(ch);
  if (!url) return toast('Sin URL de stream');
  state.previewId = id;
  state.previewUrl = url;
  stopPreview();
  $('live-preview').classList.remove('hidden');
  $('pv-name').textContent = ch.name;

  const now = Date.now();
  const prog = state.epg ? nowPlaying(state.epg.programs, channelEpgId(ch), now) : null;
  if (prog) {
    $('pv-meta').textContent = `${prog.title} · ${hhmm(prog.start)} - ${hhmm(prog.stop)}`;
    $('pv-bar').style.width = Math.min(100, Math.max(0,
      (now - prog.start) / Math.max(1, prog.stop - prog.start) * 100)) + '%';
    $('pv-desc').textContent = prog.desc || '';
    const next = programsFor(state.epg.programs, channelEpgId(ch), now, now + 3 * 3600000)
      .filter(p => p.start >= now).slice(0, 4);
    $('pv-next').innerHTML = next.map(p =>
      `<div class="pv-next-row"><span>${hhmm(p.start)}</span><b>${esc(p.title)}</b></div>`).join('');
  } else {
    $('pv-meta').textContent = ch.group || '';
    $('pv-bar').style.width = '0%';
    $('pv-desc').textContent = '';
    $('pv-next').innerHTML = '';
  }

  if (/\.m3u8($|\?)/.test(url) && window.Hls?.isSupported()) {
    pvHls = new window.Hls({ maxBufferLength: 30 });
    pvHls.loadSource(url); pvHls.attachMedia(pvVideo);
  } else if (window.mpegts?.isSupported()) {
    pvTs = window.mpegts.createPlayer({ type: 'mse', isLive: true, url });
    pvTs.attachMediaElement(pvVideo); pvTs.load();
  } else {
    pvVideo.src = url;
  }
  pvVideo.play().catch(() => {});
  document.querySelectorAll('#live-list .ch').forEach(el =>
    el.classList.toggle('sel', el.dataset.id === id));
}

function closePreview() {
  stopPreview();
  state.previewId = null;
  state.previewUrl = null;
  $('live-preview').classList.add('hidden');
  document.querySelectorAll('#live-list .ch.sel').forEach(el => el.classList.remove('sel'));
}

pvVideo.addEventListener('click', () => { if (state.previewId) playChannel(state.previewId); });
$('pv-expand').onclick = () => { if (state.previewId) playChannel(state.previewId); };
$('pv-vlc').onclick = () => openExternal(state.previewUrl);
$('pv-close').onclick = closePreview;

// ------------------------------------------------------------- multivista 2x2
const MV_SLOTS = 4;
const mvSlots = []; // [{id, url, hls, ts, playing, video, tile, addBtn, bar, label}]
let mvFocus = -1;
let mvPickSlot = -1;

/** Construye las 4 pantallas (una vez). */
function mvBuild() {
  const grid = $('multi-grid');
  for (let i = 0; i < MV_SLOTS; i++) {
    const tile = document.createElement('div');
    tile.className = 'mv-tile';
    tile.dataset.slot = i;
    tile.innerHTML = `
      <video muted playsinline></video>
      <button class="mv-add" title="Elegir canal">+</button>
      <div class="mv-bar hidden"><span class="mv-label"></span><button class="mv-x" title="Quitar">✕</button></div>`;
    const s = {
      id: null, url: null, hls: null, ts: null, playing: false,
      video: tile.querySelector('video'), tile,
      addBtn: tile.querySelector('.mv-add'),
      bar: tile.querySelector('.mv-bar'), label: tile.querySelector('.mv-label'),
    };
    s.addBtn.onclick = e => { e.stopPropagation(); mvPick(i); };
    tile.querySelector('.mv-x').onclick = e => { e.stopPropagation(); mvClear(i); };
    tile.onclick = () => {
      if (!s.id) mvPick(i);
      else if (!s.playing) mvPlay(i);
      else mvFocusSlot(i);
    };
    tile.ondblclick = () => { if (s.id && s.playing) playChannel(s.id); };
    mvSlots.push(s);
    grid.appendChild(tile);
  }
}

function mvUpdate(i) {
  const s = mvSlots[i];
  if (!s) return;
  const ch = s.id ? state.channels.find(c => c.id === s.id) : null;
  s.addBtn.classList.toggle('hidden', !!s.id);
  s.bar.classList.toggle('hidden', !s.id);
  s.label.textContent = ch ? ch.name : '';
  s.tile.classList.toggle('focused', mvFocus === i && s.playing);
}

function mvStopStream(i) {
  const s = mvSlots[i];
  if (!s) return;
  if (s.hls) { s.hls.destroy(); s.hls = null; }
  if (s.ts) { s.ts.destroy(); s.ts = null; }
  s.video.pause(); s.video.removeAttribute('src'); s.video.load();
  s.playing = false;
}

/** Detiene las pantallas pero conserva qué canal tiene cada una. */
function mvStopAll() {
  mvSlots.forEach((s, i) => { mvStopStream(i); mvUpdate(i); });
  mvFocus = -1;
}

function mvFocusSlot(i) {
  mvFocus = i;
  mvSlots.forEach((s, j) => { s.video.muted = j !== i; });
  mvSlots.forEach((_, j) => mvUpdate(j));
}

function mvPlay(i) {
  const s = mvSlots[i];
  const ch = s.id ? state.channels.find(c => c.id === s.id) : null;
  if (!ch) return;
  const url = streamUrlFor(ch);
  if (!url) return toast('Sin URL de stream');
  mvStopStream(i);
  s.url = url;
  if (/\.m3u8($|\?)/.test(url) && window.Hls?.isSupported()) {
    s.hls = new window.Hls({ maxBufferLength: 30 });
    s.hls.loadSource(url); s.hls.attachMedia(s.video);
  } else if (window.mpegts?.isSupported()) {
    s.ts = window.mpegts.createPlayer({ type: 'mse', isLive: true, url });
    s.ts.attachMediaElement(s.video); s.ts.load();
  } else s.video.src = url;
  s.playing = true;
  s.video.muted = true;
  s.video.play().catch(() => {});
  if (mvFocus < 0 || !mvSlots[mvFocus]?.playing) mvFocusSlot(i);
  else mvUpdate(i);
}

function mvClear(i) {
  const s = mvSlots[i];
  if (!s) return;
  mvStopStream(i);
  s.id = null; s.url = null;
  if (mvFocus === i) {
    mvFocus = -1;
    const next = mvSlots.findIndex(x => x.playing);
    if (next >= 0) { mvFocusSlot(next); return; }
  }
  mvUpdate(i);
}

/** Selector de canal para una pantalla. */
function mvPick(i) {
  mvPickSlot = i;
  $('mv-picker-search').value = '';
  mvRenderPicker('');
  $('mv-picker').classList.remove('hidden');
  $('mv-picker-search').focus();
}

function mvRenderPicker(q) {
  const query = q.toLowerCase();
  const list = state.channels.filter(c => !query || c.name.toLowerCase().includes(query)).slice(0, 200);
  const box = $('mv-picker-items');
  box.innerHTML = list.map(c => `
    <button class="ch-row" data-id="${esc(c.id)}">
      ${c.logo ? `<img src="${esc(c.logo)}" loading="lazy" onerror="this.remove()">` : '<div class="no-logo">📺</div>'}
      <div class="ch-info"><b>${esc(c.name)}</b><small>${esc(c.group)}</small></div>
    </button>`).join('') || '<p class="hint">Sin canales. Carga un perfil en Ajustes.</p>';
  box.querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
    const i = mvPickSlot;
    $('mv-picker').classList.add('hidden');
    if (i >= 0 && mvSlots[i]) { mvSlots[i].id = b.dataset.id; mvPlay(i); }
  });
}
$('mv-picker-close').onclick = () => $('mv-picker').classList.add('hidden');
$('mv-picker-search').addEventListener('input', e => mvRenderPicker(e.target.value));
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('info-modal').classList.contains('hidden')) $('info-modal').classList.add('hidden');
  else if (!$('ch-list').classList.contains('hidden')) $('ch-list').classList.add('hidden');
  else if (!modal.classList.contains('hidden')) $('btn-close').click();
});
$('info-close').onclick = () => $('info-modal').classList.add('hidden');
$('info-modal').addEventListener('click', e => {
  if (e.target.id === 'info-modal') $('info-modal').classList.add('hidden');
});

// ----------------------------------------------------------------- arranque
(async () => {
  // versión real del exe (Tauri) en la barra lateral
  try {
    if (isTauri && window.__TAURI__.app?.getVersion) {
      const v = await window.__TAURI__.app.getVersion();
      const el = document.querySelector('.version');
      if (el && v) el.textContent = 'v' + v;
    }
  } catch {}
  const cfg = await store.get('config.json', { profiles: [] });
  state.profiles = cfg.profiles || [];
  state.lastProfileId = cfg.lastProfile || null;
  state.settings = { timeshiftMinutes: 30, ...(cfg.settings || {}) };
  const tsSel = $('ts-minutes');
  if (tsSel) {
    tsSel.value = String(state.settings.timeshiftMinutes);
    tsSel.onchange = async e => {
      state.settings.timeshiftMinutes = parseInt(e.target.value, 10) || 0;
      await saveProfiles();
      toast(state.settings.timeshiftMinutes
        ? `Timeshift: ${state.settings.timeshiftMinutes} min en RAM (aplica al próximo canal)`
        : 'Timeshift desactivado');
    };
  }
  // no restaurar localText enormes en memoria innecesariamente: ya vienen en el perfil
  state.favorites = new Set(await store.get('favoritos.json', []));
  renderProfiles(); renderChannels();
  if (state.lastProfileId && state.profiles.some(p => p.id === state.lastProfileId)) {
    loadProfile(state.lastProfileId).catch(e => console.warn('autocarga:', e.message));
  }
  if (isTauri) {
    try { $('datadir').textContent = 'Carpeta de datos: ' + await tauriInvoke('data_dir_path'); }
    catch {}
  }
})();
