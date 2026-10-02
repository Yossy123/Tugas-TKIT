// Real browser interactions with deterministic AI responses; no API credits needed.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.STUDYGEN_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const port = 18743;
const base = `http://127.0.0.1:${port}`;
const key = 'studygen.history.v1';
const material = 'Fotosintesis menggunakan cahaya matahari, air, dan karbon dioksida untuk menghasilkan glukosa serta oksigen. Klorofil membantu tumbuhan menyerap cahaya.';
const questions = (count) => Array.from({ length: count }, (_, i) => ({
  question: `Pertanyaan ${i + 1}: apa yang dibutuhkan dalam fotosintesis?`,
  options: { A: 'Cahaya matahari', B: 'Batu', C: 'Minyak', D: 'Plastik' },
  answer: 'A', explanation: 'Materi menyebutkan cahaya matahari sebagai sumber energi.',
}));
const cards = (count) => Array.from({ length: count }, (_, i) => ({ front: `Konsep ${i + 1}?`, back: `Penjelasan konsep ${i + 1}.` }));
const samplePdf = () => {
  const stream = 'BT /F1 12 Tf 50 700 Td (Plants use sunlight and water to produce glucose and oxygen during photosynthesis.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
};

(async () => {
  const server = spawn(process.env.STUDYGEN_PHP || 'php', ['-S', `127.0.0.1:${port}`, '-t', root], { cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let browser;
  let serverErrors = '';
  server.stderr.on('data', (data) => { serverErrors += data.toString(); });
  try {
    for (let i = 0; i < 60; i++) {
      if (server.exitCode !== null) throw new Error(`PHP server failed: ${serverErrors}`);
      try { if ((await fetch(base)).ok) break; } catch {}
      if (i === 59) throw new Error('PHP server did not start');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // Validate the real PHP endpoint before intercepting AI responses in the browser.
    assert.equal((await fetch(`${base}/api/generate.php`)).status, 405);
    const invalidInputs = [
      { type: 'quiz', content: '' }, { type: 'unknown', content: material },
      { type: 'quiz', content: material, settings: 'bad' },
      { type: 'quiz', content: material, settings: { count: 7 } },
      { type: 'quiz', content: material, settings: { count: '10' } },
      { type: 'quiz', content: material, settings: { difficulty: 'impossible' } },
      { type: 'summary', content: material, settings: { summaryLength: 'huge' } },
      { type: 'flashcard', content: 'x'.repeat(15001) },
    ];
    for (const input of invalidInputs) {
      const response = await fetch(`${base}/api/generate.php`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      assert.equal(response.status, 422);
      assert.equal((await response.json()).success, false);
    }
    console.log('PASS: PHP rejects invalid material and settings');

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const requests = [];
    let responseMode = 'normal';
    let releaseRequest;
    await page.route('**/api/generate.php', async (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      if (responseMode === 'pending') await new Promise((resolve) => { releaseRequest = resolve; });
      if (responseMode === 'server-error') return route.fulfill({ status: 503, json: { success: false, error: 'Layanan AI sedang sibuk.' } });
      if (responseMode === 'non-json') return route.fulfill({ status: 200, body: '<html>invalid</html>' });
      const count = input.settings.count;
      const result = input.type === 'summary' ? 'Ringkasan:\nFotosintesis menghasilkan glukosa.\n\nPoin Penting:\n- Menggunakan cahaya matahari.'
        : input.type === 'quiz' ? { questions: questions(count) } : { cards: cards(count) };
      if (responseMode === 'wrong-count') result.questions.pop();
      await route.fulfill({ json: { success: true, type: input.type, result, settings: input.settings } });
    });
    await page.goto(base);
    assert.equal(await page.locator('#history-list .history-item').count(), 0);
    assert.equal(await page.locator('#count-setting').isVisible(), false);
    await page.locator('#generate-button').click();
    assert.match(await page.locator('#form-message').innerText(), /tidak boleh kosong/);
    assert.equal(requests.length, 0);

    await page.locator('#pdf-file').setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
    await page.waitForFunction(() => document.getElementById('pdf-status').textContent.includes('sudah masuk'));
    assert.match(await page.locator('#study-content').inputValue(), /photosynthesis/);
    console.log('PASS: existing PDF import still works');

    const generate = async (type, count = 5, title = type) => {
      await page.locator('#study-content').fill(material);
      await page.locator('#material-name').fill(title);
      await page.locator(`label.type-option:has(input[value="${type}"])`).click();
      if (type !== 'summary') await page.locator('#item-count').selectOption(String(count));
      await page.locator('#generate-button').click();
      await page.waitForFunction(() => !document.getElementById('generate-button').disabled);
    };
    await page.locator('#summary-length').selectOption('long');
    await generate('summary', 5, '<img src=x onerror="window.injected=true">');
    assert.equal(requests.at(-1).settings.summaryLength, 'long');
    assert.equal(await page.locator('#result-content img').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.match(await page.locator('.summary-text').innerText(), /Fotosintesis/);
    console.log('PASS: summary settings and safe text rendering');

    await page.locator('label.type-option:has(input[value="quiz"])').click();
    await page.locator('#quiz-difficulty').selectOption('hard');
    await generate('quiz', 10, 'Latihan biologi');
    assert.equal(requests.at(-1).settings.difficulty, 'hard');
    assert.equal(await page.locator('.quiz-question').count(), 10);
    assert.equal(await page.getByRole('button', { name: 'Periksa jawaban', exact: true }).isDisabled(), true);
    await page.locator('input[name="question-0"][value="A"]').check();
    await page.reload();
    await page.getByRole('button', { name: 'Buka Latihan biologi, Kuis', exact: true }).click();
    assert.equal(await page.locator('input[name="question-0"][value="A"]').isChecked(), true);
    assert.equal(await page.locator('#item-count').inputValue(), '10');
    assert.equal(await page.locator('#quiz-difficulty').inputValue(), 'hard');
    for (let i = 1; i < 10; i++) await page.locator(`input[name="question-${i}"][value="${i === 1 ? 'B' : 'A'}"]`).check();
    await page.getByRole('button', { name: 'Periksa jawaban', exact: true }).click();
    assert.match(await page.locator('.score-box').innerText(), /90.*9\/10/);
    assert.equal(await page.locator('.answer-feedback').count(), 10);
    const beforeRetry = requests.length;
    await page.getByRole('button', { name: 'Ulangi 1 soal yang salah', exact: true }).click();
    assert.equal(await page.locator('.quiz-question').count(), 1);
    await page.locator('input[name="question-1"][value="A"]').check();
    await page.getByRole('button', { name: 'Periksa jawaban', exact: true }).click();
    assert.match(await page.locator('.score-box').innerText(), /100.*1\/1/);
    assert.equal(requests.length, beforeRetry);
    await page.reload();
    await page.getByRole('button', { name: 'Buka Latihan biologi, Kuis', exact: true }).click();
    assert.match(await page.locator('.score-box').innerText(), /100.*1\/1/);
    await page.getByRole('button', { name: 'Ulangi semua soal', exact: true }).click();
    assert.equal(await page.locator('.quiz-question').count(), 10);
    console.log('PASS: quiz scoring, explanations, wrong-answer retry, draft and completed progress restore');

    await generate('flashcard', 5, 'Kartu biologi');
    assert.equal(await page.locator('#difficulty-setting').isVisible(), false);
    assert.equal(await page.locator('.flashcard-answer').count(), 0);
    for (let i = 0; i < 5; i++) {
      await page.getByRole('button', { name: 'Buka jawaban', exact: true }).click();
      if (i === 1) {
        await page.reload();
        await page.getByRole('button', { name: 'Buka Kartu biologi, Flashcard', exact: true }).click();
        assert.match(await page.locator('.flashcard-question').innerText(), /Konsep 2/);
        assert.match(await page.locator('.flashcard-answer').innerText(), /Penjelasan konsep 2/);
      }
      await page.getByRole('button', { name: i === 0 ? 'Belum paham' : 'Sudah paham', exact: true }).click();
    }
    assert.match(await page.locator('.session-meta').innerText(), /4\/5/);
    await page.getByRole('button', { name: 'Ulangi 1 kartu yang belum paham', exact: true }).click();
    assert.match(await page.locator('.flashcard-question').innerText(), /Konsep 1/);
    const beforeCardsRetry = requests.length;
    await page.getByRole('button', { name: 'Buka jawaban', exact: true }).click();
    await page.getByRole('button', { name: 'Sudah paham', exact: true }).click();
    assert.match(await page.locator('.session-meta').innerText(), /5\/5/);
    assert.equal(requests.length, beforeCardsRetry);
    await page.reload();
    await page.getByRole('button', { name: 'Buka Kartu biologi, Flashcard', exact: true }).click();
    assert.match(await page.locator('.score-box').innerText(), /selesai/);
    console.log('PASS: flashcard reveal, ratings, retry and session restore');

    for (const count of [5, 15]) {
      await generate('quiz', count, `Kuis ${count}`);
      assert.equal(await page.locator('.quiz-question').count(), count);
    }
    for (const count of [10, 15]) {
      await generate('flashcard', count, `Kartu ${count}`);
      assert.match(await page.locator('.session-meta').innerText(), new RegExp(`0/${count}`));
    }
    responseMode = 'pending';
    await page.locator('#generate-button').click();
    await page.waitForFunction(() => document.getElementById('generate-button').disabled);
    assert.equal(await page.locator('#study-content').getAttribute('readonly'), '');
    assert.equal(await page.locator('#history-list button:not(:disabled)').count(), 0);
    assert.equal(await page.locator('#item-count').isDisabled(), true);
    while (!releaseRequest) await new Promise((resolve) => setTimeout(resolve, 10));
    responseMode = 'normal';
    releaseRequest();
    await page.waitForFunction(() => !document.getElementById('generate-button').disabled);
    console.log('PASS: 5/10/15 results and controls locked during generation');

    await page.locator('label.type-option:has(input[value="quiz"])').click();
    for (const mode of ['wrong-count', 'server-error', 'non-json']) {
      responseMode = mode;
      const previous = await page.locator('.history-item').count();
      await generate('quiz', 5);
      assert.equal(await page.locator('#form-message').isVisible(), true);
      assert.equal(await page.locator('.history-item').count(), previous);
    }
    responseMode = 'normal';
    console.log('PASS: invalid AI output and server errors do not create history');

    await generate('flashcard', 5, 'Hapus aktif');
    await page.getByRole('button', { name: 'Hapus Hapus aktif dari riwayat', exact: true }).click();
    await page.getByRole('button', { name: 'Buka jawaban', exact: true }).click();
    await page.getByRole('button', { name: 'Sudah paham', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Buka Hapus aktif, Flashcard', exact: true }).count(), 0);
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
    await generate('summary', 5, 'Penyimpanan penuh');
    assert.equal(await page.locator('#history-message').isVisible(), true);
    assert.match(await page.locator('.summary-text').innerText(), /Fotosintesis/);
    console.log('PASS: deleting active history and failed storage keep exercises usable');

    await page.reload();
    await page.evaluate((storageKey) => localStorage.setItem(storageKey, '{broken'), key);
    await page.reload();
    assert.equal(await page.locator('#history-message').isVisible(), true);
    await generate('summary', 5, 'Pulih dari riwayat rusak');
    assert.equal(await page.locator('#history-message').isVisible(), false);
    const record = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey))[0], key);
    const seeded = Array.from({ length: 31 }, (_, i) => ({ ...record, id: `seed-${i}`, title: `Materi ${i}`, createdAt: Date.now() - i }));
    seeded.push({ ...record, id: 'bad-date', createdAt: 1e30 });
    await page.evaluate(({ storageKey, items }) => localStorage.setItem(storageKey, JSON.stringify(items)), { storageKey: key, items: seeded });
    await page.reload();
    assert.equal(await page.locator('.history-item').count(), 30);
    await generate('summary', 5, 'Hasil terbaru');
    assert.equal(await page.locator('.history-item').count(), 30);
    assert.equal(await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)).length, key), 30);
    console.log('PASS: damaged history recovery and 30-record limit');

    fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
    await page.evaluate((storageKey) => localStorage.removeItem(storageKey), key);
    await page.reload();
    await generate('flashcard', 5, 'Biologi — Fotosintesis');
    await page.getByRole('button', { name: 'Buka jawaban', exact: true }).click();
    await page.screenshot({ path: path.join(root, '.tmp', 'studygen-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    for (const type of ['summary', 'quiz', 'flashcard']) {
      await generate(type, 5, 'Biologi — Fotosintesis');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${type} must fit mobile viewport`);
    }
    await page.screenshot({ path: path.join(root, '.tmp', 'studygen-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: desktop/mobile screenshots, no horizontal overflow or browser exceptions');
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
