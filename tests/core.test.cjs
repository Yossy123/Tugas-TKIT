const assert = require('node:assert/strict');
const { test } = require('node:test');
const core = require('../js/study-core.js');
const extract = require('../api/_lib/extract.js');

test('short answers accept small typos, accents, and key phrases but reject wrong answers', () => {
  assert.equal(core.checkShort('Klorofil', ['klorofil']), true);
  assert.equal(core.checkShort('klorofl', ['klorofil']), true);
  assert.equal(core.checkShort('  KLOROFIL. ', ['klorofil']), true);
  assert.equal(core.checkShort('zat hijau daun klorofil', ['klorofil']), true);
  assert.equal(core.checkShort('café', ['cafe']), true);
  assert.equal(core.checkShort('glukosa', ['klorofil', 'zat hijau daun']), false);
  assert.equal(core.checkShort('', ['klorofil']), false);
  assert.equal(core.checkShort('O3', ['O2']), false, 'very short keys must match exactly');
});

test('points and correctness cover every question kind', () => {
  const multiple = { question: 'q', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, answer: 'B', explanation: 'e' };
  const truefalse = { kind: 'truefalse', question: 'q', answer: false, explanation: 'e' };
  const short = { kind: 'short', question: 'q', answer: 'oksigen', alternatives: ['O2'], explanation: 'e' };
  const essay = { kind: 'essay', question: 'q', answer: 'poin', explanation: 'e' };
  assert.equal(core.pointsFor(multiple, 'B'), 1);
  assert.equal(core.pointsFor(multiple, 'A'), 0);
  assert.equal(core.pointsFor(truefalse, 'false'), 1);
  assert.equal(core.pointsFor(truefalse, 'true'), 0);
  assert.equal(core.pointsFor(short, 'o2'), 1);
  assert.equal(core.pointsFor(essay, 'jawaban', { score: 75, feedback: 'ok' }), 0.75);
  assert.equal(core.isCorrect(essay, 'jawaban', { score: 60, feedback: 'ok' }), true);
  assert.equal(core.isCorrect(essay, 'jawaban', { score: 59, feedback: 'ok' }), false);
  assert.equal(core.formatPoints(3.75), '3,8');
});

test('SM-2 schedule grows intervals for remembered cards and resets forgotten ones', () => {
  const now = new Date(2026, 9, 18, 15, 0).getTime();
  const first = core.schedule(undefined, 4, now);
  assert.deepEqual([first.interval, first.reps], [1, 1]);
  assert.equal(first.due, core.startOfDay(now) + core.DAY);
  const second = core.schedule(first, 4, now);
  assert.deepEqual([second.interval, second.reps], [6, 2]);
  const third = core.schedule(second, 4, now);
  assert.equal(third.interval, Math.round(6 * second.ef));
  const forgotten = core.schedule(third, 1, now);
  assert.deepEqual([forgotten.interval, forgotten.reps], [1, 0]);
  assert.ok(forgotten.ef < third.ef && forgotten.ef >= 1.3);
  assert.equal(core.isDue(first, now), false);
  assert.equal(core.isDue(first, first.due), true);
  assert.equal(core.isDue(undefined, now), false, 'new cards are not overdue');
});

test('export text includes questions and a separate answer key', () => {
  const text = core.exportText({
    title: 'Biologi', type: 'quiz', createdAt: Date.now(),
    result: { questions: [
      { question: 'Apa?', options: { A: 'Cahaya', B: 'Batu', C: 'Air', D: 'Tanah' }, answer: 'A', explanation: 'Karena cahaya.' },
      { kind: 'truefalse', question: 'Daun hijau.', answer: true, explanation: 'Klorofil.' },
    ] },
  });
  assert.match(text, /^Biologi\n/);
  assert.match(text, /1\. Apa\?\n {3}A\. Cahaya/);
  assert.match(text, /KUNCI JAWABAN[\s\S]*1\. A\. Cahaya[\s\S]*2\. Benar/);
});

test('HTML extraction keeps article text and drops scripts, navigation, and entities', () => {
  const body = 'Fotosintesis adalah proses tumbuhan membuat makanan. '.repeat(12);
  const html = `<html><head><title>Judul &amp; Tes</title><script>var secret = 1;</script></head><body>
    <nav>Menu Beranda</nav><article><h1>Fotosintesis</h1><p>${body}</p><ul><li>Cahaya&nbsp;matahari</li><li>Air &#38; CO&#8322;</li></ul></article>
    <footer>Hak cipta</footer></body></html>`;
  const { title, text } = extract.htmlToText(html);
  assert.equal(title, 'Judul & Tes');
  assert.match(text, /Fotosintesis adalah proses/);
  assert.match(text, /- Cahaya matahari/);
  assert.match(text, /Air & CO₂/);
  assert.doesNotMatch(text, /secret|Menu Beranda|Hak cipta/);
});

test('YouTube ids, caption parsing, and track preference', () => {
  const id = 'dQw4w9WgXcQ';
  for (const url of [`https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}?t=3`, `https://m.youtube.com/shorts/${id}`, `https://www.youtube.com/embed/${id}`]) {
    assert.equal(extract.youtubeId(new URL(url)), id, url);
  }
  assert.equal(extract.youtubeId(new URL('https://example.com/watch?v=' + id)), null);
  assert.equal(extract.youtubeId(new URL('https://www.youtube.com/watch?v=short')), null);
  assert.equal(extract.captionsToText('<transcript><text start="0">Halo &amp;amp; selamat</text><text start="1">datang</text></transcript>'), 'Halo & selamat datang');
  const picked = extract.pickCaptionTrack([
    { languageCode: 'en', baseUrl: 'en' }, { languageCode: 'id', kind: 'asr', baseUrl: 'id-auto' }, { languageCode: 'id', baseUrl: 'id' },
  ]);
  assert.equal(picked.baseUrl, 'id');
});

test('URL guard blocks local and private network targets', () => {
  for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://10.1.2.3/', 'http://192.168.1.1/admin', 'http://169.254.169.254/latest',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'file:///etc/passwd', 'ftp://example.com/', 'http://user:pass@example.com/', 'http://example.com:8080/', 'http://printer.local/']) {
    assert.throws(() => extract.parsePublicUrl(url), extract.ExtractError, url);
  }
  assert.equal(extract.parsePublicUrl('https://id.wikipedia.org/wiki/Fotosintesis').hostname, 'id.wikipedia.org');
  assert.equal(extract.isBlockedAddress('8.8.8.8'), false);
  assert.equal(extract.isBlockedAddress('172.20.0.1'), true);
  assert.equal(extract.isBlockedAddress('fd00::1'), true);
});
