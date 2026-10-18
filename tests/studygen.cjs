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
const typedQuestions = (type = 'multiple', count) => (type === 'multiple' ? questions(count) : Array.from({ length: count }, (_, i) => {
  const kind = type === 'mixed' ? ['truefalse', 'short'][i % 2] : type;
  if (kind === 'truefalse') return { kind, question: `Pernyataan ${i + 1}: tumbuhan butuh cahaya.`, answer: true, explanation: 'Materi menyebut cahaya.' };
  if (kind === 'short') return { kind, question: `Isian ${i + 1}: pigmen penyerap cahaya?`, answer: 'klorofil', alternatives: ['zat hijau daun'], explanation: 'Klorofil menyerap cahaya.' };
  return { kind: 'essay', question: `Esai ${i + 1}: jelaskan fotosintesis.`, answer: 'Cahaya, air, CO2 menjadi glukosa dan oksigen.', explanation: 'Sebut bahan dan hasil.' };
}));
const cards = (count) => Array.from({ length: count }, (_, i) => ({ front: `Konsep ${i + 1}?`, back: `Penjelasan konsep ${i + 1}.` }));
const samplePdf = (pageCount = 1, empty = false) => {
  const fontId = 3 + pageCount * 2;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pageCount} >>`,
  ];
  for (let page = 0; page < pageCount; page++) {
    const text = 'Plants use sunlight and water to produce glucose and oxygen during photosynthesis.';
    const lines = empty ? [] : Array.from({ length: pageCount > 1 ? 40 : 1 }, (_, i) => `${text} Page ${page + 1} detail ${i + 1}.`);
    if (!empty) lines.push(`LAST_PAGE_MARKER_${page + 1}`);
    const stream = `BT /F1 9 Tf 30 740 Td 14 TL ${lines.map((line, i) => `${i ? 'T* ' : ''}(${line}) Tj`).join('\n')} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4 + page * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
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
    assert.equal((await fetch(`${base}/local-api/generate.php`)).status, 405);
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
      const response = await fetch(`${base}/local-api/generate.php`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
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
    await page.route('**/local-api/generate.php', async (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      if (responseMode === 'pending') await new Promise((resolve) => { releaseRequest = resolve; });
      if (responseMode === 'server-error') return route.fulfill({ status: 503, json: { success: false, error: 'Layanan AI sedang sibuk.' } });
      if (responseMode === 'non-json') return route.fulfill({ status: 200, body: '<html>invalid</html>' });
      if (input.task === 'chat') return route.fulfill({ json: { success: true, task: 'chat', result: `Jawaban dari materi: ${input.messages.at(-1).content}` } });
      if (input.task === 'grade') return route.fulfill({ json: { success: true, task: 'grade', result: { score: input.answer.includes('cahaya') ? 80 : 20, feedback: 'Umpan balik esai.' } } });
      if (input.task === 'extract-url') return route.fulfill({ json: { success: true, task: 'extract-url', result: { kind: 'article', title: 'Artikel Fotosintesis', url: input.url, text: material.repeat(3) } } });
      const count = input.settings.count;
      const result = input.type === 'summary' ? 'Ringkasan:\nFotosintesis menghasilkan glukosa.\n\nPoin Penting:\n- Menggunakan cahaya matahari.'
        : input.type === 'quiz' ? { questions: typedQuestions(input.settings.questionType, count) } : { cards: cards(count) };
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
    await page.waitForFunction(() => document.getElementById('pdf-status').textContent.includes('PDF siap dipakai'));
    assert.equal(await page.locator('#study-content').inputValue(), '');
    assert.equal(await page.locator('#text-material').isVisible(), false);
    assert.equal(await page.locator('#pdf-name').innerText(), 'sample.pdf');
    await page.locator('#generate-button').click();
    await page.waitForFunction(() => !document.getElementById('generate-button').disabled);
    assert.match(requests.at(-1).content, /photosynthesis/);
    assert.equal(requests.at(-1).task, undefined);
    await page.locator('#remove-pdf').click();
    assert.equal(await page.locator('#text-material').isVisible(), true);

    await page.locator('#study-content').fill('Materi ketik yang tetap tersimpan ketika PDF dilampirkan.');
    await page.locator('#pdf-file').setInputFiles({ name: 'long.pdf', mimeType: 'application/pdf', buffer: samplePdf(8) });
    await page.waitForFunction(() => document.getElementById('pdf-status').textContent.includes('PDF siap dipakai'));
    assert.match(await page.locator('#pdf-details').innerText(), /8 halaman/);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'PDF attachment must fit mobile viewport');
    await page.screenshot({ path: path.join(root, '.tmp', 'studygen-pdf-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1365, height: 900 });
    const beforePdfRequests = requests.length;
    await page.locator('#generate-button').click();
    await page.waitForFunction(() => !document.getElementById('generate-button').disabled);
    const notesRequests = requests.slice(beforePdfRequests).filter((input) => input.task === 'document-notes');
    assert.ok(notesRequests.length > 1);
    assert.ok(notesRequests.every((input) => input.content.length <= 15000));
    assert.ok(notesRequests.at(-1).content.includes('LAST_PAGE_MARKER_8'));
    assert.ok(notesRequests.map((input) => input.content).join('').length > 15000);
    assert.equal(requests.at(-1).type, 'summary');
    const notesRequestCount = requests.filter((input) => input.task === 'document-notes').length;
    for (const type of ['quiz', 'flashcard']) {
      await page.locator(`label.type-option:has(input[value="${type}"])`).click();
      await page.locator('#item-count').selectOption('10');
      await page.locator('#generate-button').click();
      await page.waitForFunction(() => !document.getElementById('generate-button').disabled);
      assert.equal(requests.at(-1).type, type);
    }
    assert.equal(requests.filter((input) => input.task === 'document-notes').length, notesRequestCount);
    const pdfRecord = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey))[0], key);
    assert.deepEqual(pdfRecord.source, { type: 'pdf', name: 'long.pdf', pages: 8 });
    await page.locator('#remove-pdf').click();
    assert.equal(await page.locator('#study-content').inputValue(), 'Materi ketik yang tetap tersimpan ketika PDF dilampirkan.');
    await page.reload();
    await page.getByRole('button', { name: 'Buka long, Flashcard', exact: true }).click();
    assert.equal(await page.locator('#study-content').inputValue(), '');
    assert.match(await page.locator('#pdf-status').innerText(), /Pilih ulang PDF/);
    assert.equal(await page.getByRole('button', { name: 'Buka jawaban', exact: true }).count(), 1);
    await page.locator('#pdf-file').setInputFiles({ name: 'scanned.pdf', mimeType: 'application/pdf', buffer: samplePdf(1, true) });
    await page.waitForFunction(() => document.getElementById('pdf-status').textContent.includes('perlu OCR'));
    assert.equal(await page.locator('#pdf-attachment').isVisible(), true);
    assert.match(await page.locator('#run-ocr').innerText(), /Baca 1 halaman scan/);
    const beforeScan = requests.length;
    await page.locator('#generate-button').click();
    assert.match(await page.locator('#form-message').innerText(), /Jalankan OCR/);
    assert.equal(requests.length, beforeScan);
    await page.locator('#remove-pdf').click();
    await page.evaluate((storageKey) => localStorage.removeItem(storageKey), key);
    await page.reload();
    console.log('PASS: PDF attachments stay out of textarea; all long-PDF pages reach AI; cached notes and PDF history work; scans report OCR requirement');

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

    await page.evaluate((storageKey) => localStorage.removeItem(storageKey), key);
    await page.reload();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await page.locator('#source-url').fill('https://contoh.com/fotosintesis');
    await page.locator('#fetch-url').click();
    await page.waitForFunction(() => document.getElementById('pdf-status').textContent.includes('Isi artikel siap'));
    assert.equal(await page.locator('#pdf-name').innerText(), 'Artikel Fotosintesis');
    assert.equal(await page.locator('#remove-pdf').innerText(), 'Hapus URL');
    assert.equal(await page.locator('#text-material').isVisible(), false);
    await page.locator('#output-language').selectOption('en');
    await page.locator('#generate-button').click();
    await page.waitForFunction(() => !document.getElementById('generate-button').disabled);
    assert.equal(requests.at(-1).settings.language, 'en');
    const urlRecord = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey))[0], key);
    assert.deepEqual(urlRecord.source, { type: 'url', name: 'Artikel Fotosintesis', url: 'https://contoh.com/fotosintesis', kind: 'article' });
    assert.equal(urlRecord.settings.language, 'en');
    assert.match(await page.locator('.session-source').innerText(), /Artikel Fotosintesis/);
    await page.locator('#remove-pdf').click();
    await page.locator('#output-language').selectOption('id');
    console.log('PASS: URL source becomes an attachment and output language is sent and saved');

    await page.locator('#export-copy').click();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^Artikel Fotosintesis\r?\n[\s\S]*Fotosintesis menghasilkan glukosa/);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-download').click()]);
    assert.equal(download.suggestedFilename(), 'artikel-fotosintesis-summary.txt');
    await page.locator('#export-edit').click();
    assert.equal(await page.locator('#chat-panel').isVisible(), false);
    await page.locator('.edit-form textarea').first().fill('Ringkasan yang sudah diperbaiki pengguna.');
    await page.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
    assert.match(await page.locator('.summary-text').innerText(), /sudah diperbaiki pengguna/);
    assert.equal(await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey))[0].result, key), 'Ringkasan yang sudah diperbaiki pengguna.');
    console.log('PASS: copy, download, and editing a result');

    await page.locator('#chat-input').fill('Apa itu klorofil?');
    await page.locator('#chat-input').press('Enter');
    await page.waitForSelector('.chat-bubble.assistant');
    assert.match(await page.locator('.chat-bubble.assistant').innerText(), /Jawaban dari materi: Apa itu klorofil\?/);
    assert.deepEqual(requests.at(-1).messages, [{ role: 'user', content: 'Apa itu klorofil?' }]);
    assert.equal(requests.at(-1).content, urlRecord.content);
    await page.reload();
    await page.getByRole('button', { name: 'Buka Artikel Fotosintesis, Ringkasan', exact: true }).click();
    assert.equal(await page.locator('.chat-bubble').count(), 2);
    console.log('PASS: chat answers are shown and saved with the material');

    await page.locator('label.type-option:has(input[value="quiz"])').click();
    await page.locator('#question-type').selectOption('mixed');
    await generate('quiz', 5, 'Kuis campuran');
    assert.equal(requests.at(-1).settings.questionType, 'mixed');
    await page.locator('input[name="question-0"][value="true"]').check();
    await page.locator('#answer-1').fill('klorofl');
    await page.locator('input[name="question-2"][value="false"]').check();
    await page.locator('#answer-3').fill('Zat hijau daun');
    await page.locator('input[name="question-4"][value="true"]').check();
    await page.getByRole('button', { name: 'Periksa jawaban', exact: true }).click();
    assert.match(await page.locator('.score-box').innerText(), /80.*4\/5/);
    await page.getByRole('button', { name: 'Ulangi 1 soal yang salah', exact: true }).click();
    await page.locator('input[name="question-2"][value="true"]').check();
    await page.getByRole('button', { name: 'Periksa jawaban', exact: true }).click();
    assert.match(await page.locator('.score-box').innerText(), /100.*1\/1/);
    assert.equal(await page.locator('#stats-content .chart-svg').count(), 1);
    assert.equal(await page.locator('#stats-content .chart-point').count(), 2);
    assert.equal(await page.locator('.mistake-list li').count(), 1);
    assert.match(await page.locator('.mistake-list li').innerText(), /Pernyataan 3[\s\S]*salah 1×/);

    await page.locator('#question-type').selectOption('essay');
    await generate('quiz', 5, 'Kuis esai');
    const beforeGrades = requests.length;
    for (let i = 0; i < 5; i++) await page.locator(`#answer-${i}`).fill(i < 4 ? 'Butuh cahaya dan air' : 'Tidak tahu');
    await page.getByRole('button', { name: 'Periksa jawaban', exact: true }).click();
    await page.waitForSelector('.score-box');
    assert.equal(requests.slice(beforeGrades).filter((input) => input.task === 'grade').length, 5);
    assert.match(await page.locator('.score-box').innerText(), /68.*3,4\/5/);
    assert.match(await page.locator('.answer-feedback').first().innerText(), /Nilai esai: 80\/100/);
    console.log('PASS: mixed, short-answer, true/false and AI-graded essay quizzes; stats chart and mistakes');

    await generate('flashcard', 5, 'Kartu SRS');
    for (const label of ['Belum paham', 'Ragu-ragu', 'Sudah paham', 'Sudah paham', 'Sudah paham']) {
      await page.getByRole('button', { name: 'Buka jawaban', exact: true }).click();
      await page.getByRole('button', { name: label, exact: true }).click();
    }
    const srs = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey))[0].srs, key);
    assert.deepEqual(Object.keys(srs), ['0', '1', '2', '3', '4']);
    assert.equal(srs[0].reps, 0);
    assert.equal(srs[2].reps, 1);
    assert.match(await page.locator('.session-hint').innerText(), /Jadwal ulang berikutnya: besok/);
    await page.evaluate((storageKey) => {
      const items = JSON.parse(localStorage.getItem(storageKey));
      Object.values(items[0].srs).forEach((state) => { state.due = Date.now() - 1000; });
      localStorage.setItem(storageKey, JSON.stringify(items));
    }, key);
    await page.reload();
    assert.match(await page.locator('.history-progress').first().innerText(), /5 perlu diulang hari ini/);
    await page.locator('.stat-block').getByRole('button', { name: 'Buka Kartu SRS untuk mengulang 5 kartu', exact: true }).click();
    await page.getByRole('button', { name: 'Ulangi 5 kartu jatuh tempo', exact: true }).click();
    assert.match(await page.locator('.session-hint').first().innerText(), /Kartu 1 dari 5/);
    console.log('PASS: spaced repetition schedules cards and offers due reviews');

    await page.locator('#theme-toggle').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(20, 24, 21)');
    await page.screenshot({ path: path.join(root, '.tmp', 'studygen-dark.png'), fullPage: true });
    await page.locator('#theme-toggle').click();
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(246, 243, 236)');
    console.log('PASS: dark mode toggle persists');

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
