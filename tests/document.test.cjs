const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitText, prepare, CHUNK_SIZE } = require('../js/document.js');

test('document chunks cover the entire input, including the final page', () => {
  const text = ('Halaman materi: definisi dan contoh.\n'.repeat(1000)) + 'PENANDA_HALAMAN_TERAKHIR';
  const chunks = splitText(text);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every((chunk) => chunk.length <= CHUNK_SIZE));
  assert.ok(chunks.at(-1).includes('PENANDA_HALAMAN_TERAKHIR'));
});

test('long paragraphs retain every character and do not split emoji pairs', () => {
  const text = 'x'.repeat(CHUNK_SIZE - 1) + '😀' + 'y'.repeat(CHUNK_SIZE) + 'z';
  const chunks = splitText(text);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every((chunk) => chunk.length <= CHUNK_SIZE && chunk.length >= 20));
  assert.ok(chunks.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk) && !/^[\uDC00-\uDFFF]/.test(chunk)));
});

test('short PDFs reach generation without an extra AI request', async () => {
  const text = 'Materi singkat yang dapat diproses langsung.';
  assert.equal(await prepare(text, () => { throw new Error('unexpected request'); }), text);
});

test('long PDFs summarize all chunks and report progress', async () => {
  const text = 'a'.repeat(40000) + 'PENANDA_TERAKHIR';
  const seen = [];
  const progress = [];
  const result = await prepare(text, async (chunk) => { seen.push(chunk); return 'Catatan penting dari bagian materi.'; }, (...args) => progress.push(args));
  assert.equal(seen.join(''), text);
  assert.equal(progress.length, seen.length);
  assert.equal(progress.at(-1)[0], seen.length);
  assert.ok(result.length <= CHUNK_SIZE);
});

test('large intermediate notes are reduced again without discarding parts', async () => {
  const seen = [];
  const rounds = [];
  const result = await prepare('x'.repeat(60000), async (chunk) => {
    seen.push(chunk);
    return chunk.includes('Bagian') ? 'Gabungan semua catatan.' : 'N'.repeat(3000);
  }, (part, total, round) => rounds.push(round));
  assert.ok(rounds.includes(2));
  assert.ok(seen.some((chunk) => chunk.includes('Bagian 5:')));
  assert.ok(result.length <= CHUNK_SIZE);
});

test('invalid AI notes and upstream failures stop the document pipeline', async () => {
  for (const result of ['', null, 'x'.repeat(6001)]) {
    await assert.rejects(prepare('x'.repeat(20000), async () => result), /tidak valid/);
  }
  await assert.rejects(prepare('x'.repeat(20000), async () => { throw new Error('AI_AUTH_FAILED'); }), /AI_AUTH_FAILED/);
});
