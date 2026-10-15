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
 *  Algunos proveedores devuelven objetos en vez de arreglos por temporada. */
function seasonsOf(info) {
  const raw = info.seasons || info.episodes || {};
  if (Array.isArray(raw)) return [['', raw]];
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
    html += `<h3>${sn ? 'Temporada ' + esc(sn) : 'Episodios'}</h3><div class="ep-grid">` + eps.map(ep => `
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
  $('live-list').innerHTML = list.slice(0, 400).map(c => {
    const prog = state.epg ? nowPlaying(state.epg.programs, channelEpgId(c), now) : null;
    const fav = state.favorites.has(c.id) ? '★' : '☆';
    return `<div class="ch" data-id="${esc(c.id)}">
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
      playChannel(el.dataset.id);
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
function renderGuide() {
  const box = $('epg-grid');
  if (!state.epg || !state.channels.length) {
    box.innerHTML = '<p class="hint">Carga un perfil con EPG para ver la guía.</p>';
    return;
  }
  const now = Date.now(), from = now - 3600000, to = now + 3 * 3600000;
  const chans = state.channels.filter(c => state.epg.channels.has(channelEpgId(c))).slice(0, 60);
  state.epgShown = [];
  box.innerHTML = chans.map(c => {
    const progs = programsFor(state.epg.programs, channelEpgId(c), from, to);
    const items = progs.map(p => {
      const i = state.epgShown.length;
      state.epgShown.push({ ...p, channelName: c.name });
      const live = p.start <= now && p.stop > now;
      const t = new Date(p.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `<button class="epg-p ${live ? 'live' : ''}" data-epg="${i}">${t} ${esc(p.title)}</button>`;
    }).join('');
    return `<div class="epg-row">
      <div class="epg-ch">${c.logo ? `<img src="${esc(c.logo)}" onerror="this.remove()">` : ''}<b>${esc(c.name)}</b></div>
      <div class="epg-progs">${items || '<span class="hint">sin datos</span>'}</div>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-epg]').forEach(b => b.onclick = () => showProgramDetail(state.epgShown[+b.dataset.epg]));
}

/** Ficha del programa de la guía: título, canal, horario y descripción completa. */
function showProgramDetail(p) {
  if (!p) return;
  $('info-title').textContent = p.title || 'Sin título';
  const d = new Date(p.start).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const t1 = new Date(p.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const t2 = new Date(p.stop).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('info-meta').textContent = `${p.channelName} · ${d} · ${t1} – ${t2}`;
  $('info-desc').textContent = p.desc || 'Sin descripción.';
  $('info-modal').classList.remove('hidden');
}

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
}

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

$('btn-close').onclick = () => { stopPlayer(); modal.classList.add('hidden'); };
$('btn-vlc').onclick = async () => {
  const url = modal.dataset.url;
  if (!url) return;
  if (isTauri) {
    try {
      const how = await tauriInvoke('open_external', { url });
      if (how === 'default') toast('VLC no encontrado; se abrió con la app predeterminada');
    } catch (e) { toast('No se pudo abrir: ' + (e?.message || e)); }
    return;
  }
  window.open(url, '_blank');
};
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('info-modal').classList.contains('hidden')) $('info-modal').classList.add('hidden');
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
