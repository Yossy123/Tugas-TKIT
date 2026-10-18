// Turns a public article URL or YouTube video into plain study text.
// Every request (including redirects) is checked so the server cannot be used
// to reach localhost or private network addresses.
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_TEXT = 1000000;
const TIMEOUT_MS = 15000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 StudyGen';

class ExtractError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

const blockList = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blockList.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]]) {
  blockList.addSubnet(address, prefix, 'ipv6');
}

function isBlockedAddress(address) {
  let ip = String(address).replace(/^\[|\]$/g, '');
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1];
  if (net.isIPv4(ip)) return blockList.check(ip, 'ipv4');
  if (net.isIPv6(ip)) return blockList.check(ip, 'ipv6');
  return true;
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(new ExtractError('Domain tidak ditemukan. Periksa kembali alamat URL.'));
    if (!addresses.length || addresses.some((item) => isBlockedAddress(item.address))) {
      return callback(new ExtractError('Alamat URL tidak diizinkan.'));
    }
    if (options && options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function parsePublicUrl(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new ExtractError('URL tidak valid. Contoh: https://contoh.com/artikel'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ExtractError('Gunakan URL yang diawali http:// atau https://.');
  if (url.username || url.password) throw new ExtractError('URL tidak boleh berisi nama pengguna atau kata sandi.');
  if (url.port && !['80', '443'].includes(url.port)) throw new ExtractError('Alamat URL tidak diizinkan.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || /\.(localhost|local|internal|home|lan)$/.test(host)) throw new ExtractError('Alamat URL tidak diizinkan.');
  if (net.isIP(host) && isBlockedAddress(host)) throw new ExtractError('Alamat URL tidak diizinkan.');
  return url;
}

function charsetFrom(contentType) {
  const match = /charset=["']?([\w-]+)/i.exec(contentType || '');
  return match ? match[1].toLowerCase() : 'utf-8';
}

function request(url, { method = 'GET', headers = {}, body = null, redirects = 4 } = {}) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, {
      method,
      lookup: safeLookup,
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'id,en;q=0.8', 'Accept-Encoding': 'identity', ...headers },
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new ExtractError('Halaman terlalu lama merespons. Coba lagi nanti.', 504)));
    req.on('error', (error) => reject(error instanceof ExtractError ? error : new ExtractError('Halaman tidak dapat diambil. Periksa URL atau coba lagi nanti.', 502)));
    req.on('response', (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new ExtractError('Halaman terlalu banyak dialihkan.'));
        try {
          const next = parsePublicUrl(new URL(res.headers.location, url).href);
          const keepMethod = status === 307 || status === 308;
          return resolve(request(next, { method: keepMethod ? method : 'GET', headers, body: keepMethod ? body : null, redirects: redirects - 1 }));
        } catch (error) { return reject(error); }
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          req.destroy(new ExtractError('Halaman terlalu besar untuk dibaca (maksimal 3 MB).'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const contentType = String(res.headers['content-type'] || '');
        let text;
        try { text = new TextDecoder(charsetFrom(contentType)).decode(Buffer.concat(chunks)); } catch { text = Buffer.concat(chunks).toString('utf8'); }
        resolve({ status, contentType, text, url });
      });
      res.on('error', () => reject(new ExtractError('Halaman tidak dapat diambil. Coba lagi nanti.', 502)));
    });
    if (body) req.write(body);
    req.end();
  });
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', reg: '®', deg: '°', middot: '·', bull: '•', times: '×' };
function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return Object.hasOwn(entities, code.toLowerCase()) ? entities[code.toLowerCase()] : match;
  });
}

function tidyText(value) {
  return value.replace(/[ \t\f\v ]+/g, ' ').split('\n').map((line) => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

// Removes navigation-like runs: 5+ consecutive short list items (menus, language lists).
function dropMenus(text) {
  const kept = [];
  let run = [];
  const flush = () => {
    if (run.filter(Boolean).length < 5) kept.push(...run);
    run = [];
  };
  for (const line of text.split('\n')) {
    if ((line.startsWith('- ') && line.length <= 40) || (line === '' && run.length)) { run.push(line); continue; }
    flush();
    kept.push(line);
  }
  flush();
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function htmlToText(html) {
  const meta = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i.exec(html)
    || /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i.exec(html);
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = tidyText(decodeEntities((meta?.[1] || titleTag?.[1] || '').replace(/<[^>]+>/g, ''))).replace(/\s+/g, ' ').slice(0, 200);
  let body = html.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|aside|form|button|select|figure)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const toText = (fragment) => dropMenus(tidyText(decodeEntities(fragment
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<h[1-6]\b[^>]*>/gi, '\n\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|blockquote|pre|ul|ol|table|main|header)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))));
  const articles = body.match(/<article\b[\s\S]*?<\/article>/gi);
  const main = /<main\b[\s\S]*?<\/main>/i.exec(body)?.[0];
  for (const candidate of [articles?.join('\n'), main]) {
    if (candidate) {
      const text = toText(candidate);
      if (text.length >= 500) return { title, text };
    }
  }
  body = /<body\b[\s\S]*<\/body>/i.exec(body)?.[0] || body;
  return { title, text: toText(body) };
}

function youtubeId(url) {
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\.|^music\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') || /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(url.pathname)?.[1] || null;
  } else return null;
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

function pickCaptionTrack(tracks) {
  const score = (track) => {
    const lang = String(track.languageCode || '').toLowerCase();
    const manual = track.kind !== 'asr';
    if (lang.startsWith('id')) return manual ? 0 : 1;
    if (lang.startsWith('en')) return manual ? 2 : 3;
    return manual ? 4 : 5;
  };
  return [...tracks].filter((track) => typeof track?.baseUrl === 'string').sort((a, b) => score(a) - score(b))[0] || null;
}

function captionsToText(xml) {
  const parts = [...xml.matchAll(/<(text|p)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((match) => decodeEntities(decodeEntities(match[2].replace(/<[^>]+>/g, ''))).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const lines = [];
  for (let i = 0; i < parts.length; i += 12) lines.push(parts.slice(i, i + 12).join(' '));
  return lines.join('\n');
}

const noTranscript = 'Transkrip video tidak tersedia atau tidak dapat diambil. Salin transkrip secara manual ke kolom teks.';

async function youtubeTranscript(id) {
  const watch = await request(parsePublicUrl(`https://www.youtube.com/watch?v=${id}&hl=id`), { headers: { Cookie: 'CONSENT=YES+1' } });
  if (watch.status !== 200) throw new ExtractError('Video YouTube tidak dapat dibuka.');
  const rawTitle = /<meta name="title" content="([^"]*)"/.exec(watch.text)?.[1] || /<title>([\s\S]*?)<\/title>/.exec(watch.text)?.[1] || '';
  const title = decodeEntities(rawTitle).replace(/\s*-\s*YouTube\s*$/, '').trim().slice(0, 200) || 'Video YouTube';
  let tracks = null;
  const key = /"INNERTUBE_API_KEY":"([\w-]+)"/.exec(watch.text)?.[1];
  if (key) {
    try {
      const player = await request(parsePublicUrl(`https://www.youtube.com/youtubei/v1/player?key=${key}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } }, videoId: id }),
      });
      tracks = JSON.parse(player.text)?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null;
    } catch { tracks = null; }
  }
  if (!Array.isArray(tracks) || !tracks.length) {
    const match = /"captionTracks":(\[.*?\])/.exec(watch.text);
    try { tracks = match ? JSON.parse(match[1]) : null; } catch { tracks = null; }
  }
  const track = Array.isArray(tracks) ? pickCaptionTrack(tracks) : null;
  if (!track) throw new ExtractError(noTranscript);
  const captionUrl = parsePublicUrl(track.baseUrl.replace(/\\u0026/g, '&').replace(/&fmt=[^&]*/g, ''));
  if (!/(^|\.)youtube\.com$/.test(captionUrl.hostname)) throw new ExtractError(noTranscript);
  const captions = await request(captionUrl);
  const text = captions.status === 200 ? captionsToText(captions.text) : '';
  if (text.length < 20) throw new ExtractError(noTranscript);
  return { kind: 'youtube', title, text: text.slice(0, MAX_TEXT), url: `https://www.youtube.com/watch?v=${id}` };
}

async function extractFromUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) throw new ExtractError('Masukkan URL yang valid (maksimal 2.048 karakter).');
  const url = parsePublicUrl(raw);
  const videoId = youtubeId(url);
  if (videoId) return youtubeTranscript(videoId);
  const page = await request(url, { headers: { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' } });
  if (page.status < 200 || page.status >= 300) throw new ExtractError(`Halaman tidak dapat diambil (HTTP ${page.status}). Situs mungkin memerlukan login atau memblokir akses otomatis.`);
  const type = page.contentType.toLowerCase();
  if (type.includes('application/pdf')) throw new ExtractError('URL ini berisi PDF. Unduh file-nya, lalu pakai tombol "Pilih file PDF".');
  let title = '';
  let text = '';
  if (!type || type.includes('text/html') || type.includes('application/xhtml')) ({ title, text } = htmlToText(page.text));
  else if (type.includes('text/plain')) text = tidyText(page.text);
  else throw new ExtractError('Jenis konten tidak didukung. Gunakan halaman artikel atau unggah PDF.');
  if (text.length < 100) throw new ExtractError('Halaman tidak berisi cukup teks. Situs mungkin memuat isinya dengan JavaScript atau memerlukan login. Salin teksnya secara manual.');
  if (text.length > MAX_TEXT) throw new ExtractError('Isi halaman terlalu besar. Salin bagian yang ingin dipelajari secara manual.');
  return { kind: 'article', title: title || page.url.hostname, text, url: page.url.href };
}

module.exports = { extractFromUrl, ExtractError, htmlToText, youtubeId, parsePublicUrl, isBlockedAddress, captionsToText, pickCaptionTrack };
