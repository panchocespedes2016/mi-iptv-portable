// MiIPTV Portable — parser XMLTV (EPG).

/** "20261014160000 +0000" -> ms epoch (aplica el offset). */
export function parseXmltvTime(s) {
  const m = s.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!m) return null;
  const [, Y, Mo, D, h, mi, se, off] = m;
  let ms = Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +se);
  if (off) {
    const sign = off[0] === '+' ? 1 : -1;
    const oh = +off.slice(1, 3), om = +off.slice(3, 5);
    ms -= sign * (oh * 60 + om) * 60000;
  }
  return ms;
}

function textOf(el, tag) {
  const n = el.getElementsByTagName(tag)[0];
  return n ? n.textContent.trim() : '';
}

/**
 * Parsea XMLTV -> { channels: Map(id -> {id, name, icon}), programs: [{channel, start, stop, title, desc}] }
 * OJO: getElementsByTagName sobre <programme> con miles de entradas puede ser
 * lento; para listas enormes se pagina por canal en la vista.
 */
export function parseXMLTV(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length)
    throw new Error('XMLTV inválido');
  const channels = new Map();
  for (const c of doc.getElementsByTagName('channel')) {
    const id = c.getAttribute('id');
    const icon = c.getElementsByTagName('icon')[0]?.getAttribute('src') || '';
    channels.set(id, { id, name: textOf(c, 'display-name') || id, icon });
  }
  const programs = [];
  for (const p of doc.getElementsByTagName('programme')) {
    const start = parseXmltvTime(p.getAttribute('start') || '');
    if (!start) continue;
    programs.push({
      channel: p.getAttribute('channel'),
      start,
      stop: parseXmltvTime(p.getAttribute('stop') || '') || start + 3600000,
      title: textOf(p, 'title'),
      desc: textOf(p, 'desc'),
    });
  }
  programs.sort((a, b) => a.start - b.start);
  return { channels, programs };
}

/** Programación de un canal entre dos tiempos. */
export function programsFor(programs, channelId, from, to) {
  return programs.filter(p => p.channel === channelId && p.stop > from && p.start < to);
}

/** Lo que está al aire ahora en un canal (o null). */
export function nowPlaying(programs, channelId, now = Date.now()) {
  return programs.find(p => p.channel === channelId && p.start <= now && p.stop > now) || null;
}
