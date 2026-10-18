(() => {
  const MIN_LENGTH = 20;
  const MAX_LENGTH = 15000;
  const MAX_PDF_SIZE = 10 * 1024 * 1024;
  const MAX_PDF_PAGES = 500;
  const MAX_PDF_TEXT = 1000000;
  const MAX_OCR_PAGES = 50;
  const $ = (id) => document.getElementById(id);
  const content = $('study-content');
  const pdfInput = $('pdf-file');
  const sourceStatus = $('pdf-status');
  const attachmentBox = $('pdf-attachment');
  const removeAttachment = $('remove-pdf');
  const runOcr = $('run-ocr');
  const urlForm = $('url-form');
  const urlInput = $('source-url');
  const urlButton = $('fetch-url');
  const textMaterial = $('text-material');
  const counter = $('char-counter');
  const typeInputs = [...document.querySelectorAll('input[name="type"]')];
  const generateButton = $('generate-button');
  const buttonLabel = generateButton.querySelector('.button-label');
  const message = $('form-message');
  const result = $('result-content');
  const badge = $('result-badge');
  const materialName = $('material-name');
  const itemCount = $('item-count');
  const difficulty = $('quiz-difficulty');
  const summaryLength = $('summary-length');
  const language = $('output-language');
  const questionType = $('question-type');
  const api = window.StudyGenAPI;
  const ui = window.StudyGenUI;
  const scriptUrl = document.currentScript?.src || new URL('js/app.js', document.baseURI).href;
  const pdfModuleUrl = new URL('vendor/pdfjs/pdf.min.mjs', scriptUrl).href;
  const pdfWorkerUrl = new URL('vendor/pdfjs/pdf.worker.min.mjs', scriptUrl).href;

  let selectedType = 'summary';
  let isGenerating = false;
  let reading = ''; // '', 'pdf', 'url' or 'ocr'
  // The current PDF or web page. Its text never goes into the textarea.
  let attachment = null;

  const loadPdfjs = async () => {
    const pdfjs = await import(pdfModuleUrl);
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return pdfjs;
  };
  const updateSettings = () => {
    $('summary-setting').hidden = selectedType !== 'summary';
    $('count-setting').hidden = selectedType === 'summary';
    $('difficulty-setting').hidden = selectedType !== 'quiz';
    $('question-type-setting').hidden = selectedType !== 'quiz';
    $('count-label').textContent = selectedType === 'quiz' ? 'Jumlah soal' : 'Jumlah kartu';
  };
  const updateCounter = () => { counter.textContent = `${content.value.length.toLocaleString('id-ID')} / ${MAX_LENGTH.toLocaleString('id-ID')}`; };
  const showMessage = (text = '') => { message.hidden = !text; message.textContent = text; };
  const setResult = (text, state = '') => { result.className = `result-content${state ? ` ${state}` : ''}`; result.textContent = text; };
  const resetResult = () => {
    result.className = 'result-content is-empty';
    result.innerHTML = '<span class="empty-symbol" aria-hidden="true">✳</span><p class="empty-title">Siap untuk mulai belajar?</p><p>Hasil dari materi yang kamu masukkan akan muncul di sini.</p>';
  };
  const updateBusyState = () => {
    const busy = isGenerating || Boolean(reading);
    generateButton.disabled = busy;
    [pdfInput, removeAttachment, runOcr, urlInput, urlButton, materialName, itemCount, difficulty, summaryLength, language, questionType, ...typeInputs]
      .forEach((input) => { input.disabled = busy; });
    content.readOnly = busy;
    result.setAttribute('aria-busy', String(isGenerating));
    ui.setBusy(busy);
    buttonLabel.textContent = isGenerating ? 'Sedang membuat...'
      : { pdf: 'Membaca PDF...', url: 'Mengambil isi URL...', ocr: 'Menjalankan OCR...' }[reading] || 'Buat bahan belajar';
  };
  const setLoading = (loading) => { isGenerating = loading; updateBusyState(); };
  const setStatus = (text, warning = false) => {
    sourceStatus.textContent = text;
    sourceStatus.classList.toggle('is-warning', warning);
  };
  const megabytes = (bytes) => (bytes / 1024 / 1024).toLocaleString('id-ID', { maximumFractionDigits: 2 });
  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

  const pdfText = (pageTexts) => Object.keys(pageTexts).map(Number).sort((a, b) => a - b)
    .map((page) => `Halaman ${page}:\n${pageTexts[page]}`).join('\n\n');

  const updateAttachment = () => {
    attachmentBox.hidden = !attachment;
    textMaterial.hidden = Boolean(attachment);
    counter.hidden = Boolean(attachment);
    runOcr.hidden = true;
    if (!attachment) return;
    $('pdf-name').textContent = attachment.name;
    if (attachment.kind === 'pdf') {
      const details = [`${attachment.pages} halaman`, `${megabytes(attachment.size)} MB`];
      if (attachment.ocrPages) details.push(`${attachment.ocrPages} halaman dibaca dengan OCR`);
      if (attachment.emptyPages.length) details.push(`${attachment.emptyPages.length} halaman tanpa teks`);
      $('pdf-details').textContent = details.join(' · ');
      removeAttachment.textContent = 'Hapus PDF';
      if (attachment.emptyPages.length) {
        const count = Math.min(MAX_OCR_PAGES, attachment.emptyPages.length);
        runOcr.hidden = false;
        runOcr.textContent = `Baca ${count} halaman scan (OCR)`;
      }
    } else {
      $('pdf-details').textContent = `${attachment.sourceKind === 'youtube' ? 'Transkrip YouTube' : 'Artikel web'} · ${hostOf(attachment.url)} · ${attachment.text.length.toLocaleString('id-ID')} karakter`;
      removeAttachment.textContent = 'Hapus URL';
    }
  };

  removeAttachment.addEventListener('click', () => {
    if (isGenerating || reading) return;
    attachment = null;
    updateAttachment();
    setStatus('Lampirkan PDF (maks. 10 MB, 500 halaman), tempel URL artikel/YouTube, atau ketik materi.');
    showMessage();
    content.focus();
  });

  pdfInput.addEventListener('change', async () => {
    const file = pdfInput.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setStatus('Pilih file dengan format PDF.', true);
      pdfInput.value = '';
      return;
    }
    if (file.size > MAX_PDF_SIZE) {
      setStatus('Ukuran PDF maksimal 10 MB.', true);
      pdfInput.value = '';
      return;
    }

    reading = 'pdf';
    updateBusyState();
    setStatus(`Membaca ${file.name}...`);
    let pdf;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('File yang dipilih bukan PDF yang valid.');
      // pdf.js takes ownership of the buffer it reads, so keep a copy for OCR.
      const copy = bytes.slice();
      const pdfjs = await loadPdfjs();
      pdf = await pdfjs.getDocument({ data: bytes }).promise;
      if (pdf.numPages > MAX_PDF_PAGES) throw new Error('PDF maksimal 500 halaman. Pisahkan dokumen menjadi beberapa file.');
      const pageTexts = {};
      const emptyPages = [];
      let total = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        setStatus(`Membaca halaman ${pageNumber} dari ${pdf.numPages}...`);
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => (item.str ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('').trim();
        page.cleanup();
        if (!pageText) { emptyPages.push(pageNumber); continue; }
        pageTexts[pageNumber] = pageText;
        total += pageText.length;
        if (total > MAX_PDF_TEXT) throw new Error('Isi PDF terlalu besar. Pisahkan dokumen menjadi beberapa file.');
      }
      const text = pdfText(pageTexts);
      if (text.length < MIN_LENGTH && !emptyPages.length) throw new Error('Teks PDF tidak terbaca.');
      attachment = {
        kind: 'pdf', name: file.name.slice(0, 255), pages: pdf.numPages, size: file.size,
        pageTexts, emptyPages, ocrPages: 0, text: text.length >= MIN_LENGTH ? text : '', notes: null,
        bytes: emptyPages.length ? copy : null,
      };
      updateAttachment();
      showMessage();
      if (!attachment.text) setStatus('PDF ini berupa hasil scan dan perlu OCR. Klik tombol OCR untuk membaca teksnya (butuh internet, bisa memakan waktu).', true);
      else if (emptyPages.length) setStatus(`PDF siap dipakai. ${emptyPages.length} halaman tanpa teks (hasil scan) perlu OCR agar ikut dipelajari.`, true);
      else setStatus('PDF siap dipakai. Seluruh halaman akan diproses tanpa mengisi kolom teks.');
    } catch (error) {
      const known = ['File yang dipilih bukan PDF', 'Teks PDF tidak terbaca', 'PDF maksimal', 'Isi PDF terlalu besar'];
      setStatus(known.some((start) => error.message?.startsWith(start)) ? error.message
        : 'PDF gagal dibaca. Pastikan file tidak rusak atau terkunci dengan kata sandi.', true);
    } finally {
      if (pdf) {
        try { await pdf.destroy(); } catch { /* The extracted text is already available. */ }
      }
      pdfInput.value = '';
      reading = '';
      updateBusyState();
    }
  });

  runOcr.addEventListener('click', async () => {
    if (isGenerating || reading || attachment?.kind !== 'pdf' || !attachment.bytes) return;
    const target = attachment;
    const pages = target.emptyPages.slice(0, MAX_OCR_PAGES);
    reading = 'ocr';
    updateBusyState();
    try {
      const texts = await window.StudyGenOCR.recognize({
        pdfjs: await loadPdfjs(), bytes: target.bytes, pages,
        onProgress: ({ stage, done, total, progress }) => {
          if (stage === 'load') setStatus('Memuat mesin OCR...');
          else if (stage === 'language') setStatus(`Mengunduh data bahasa OCR... ${Math.round(progress * 100)}%`);
          else setStatus(`OCR halaman ${done + 1} dari ${total}...`);
        },
      });
      let found = 0;
      for (const page of pages) {
        if ((texts[page] || '').length >= 10) {
          target.pageTexts[page] = texts[page];
          found++;
        }
      }
      target.ocrPages += found;
      target.emptyPages = target.emptyPages.filter((page) => !target.pageTexts[page] && !pages.includes(page));
      const text = pdfText(target.pageTexts);
      if (text.length > MAX_PDF_TEXT) throw new Error('Isi PDF terlalu besar setelah OCR. Pisahkan dokumen menjadi beberapa file.');
      target.text = text.length >= MIN_LENGTH ? text : '';
      target.notes = null;
      if (!target.emptyPages.length) target.bytes = null;
      if (attachment === target) updateAttachment();
      if (!target.text) setStatus('OCR tidak menemukan teks yang terbaca. Coba PDF dengan hasil scan yang lebih jelas.', true);
      else setStatus(`OCR selesai: ${found} dari ${pages.length} halaman berhasil dibaca.${target.emptyPages.length ? ` Masih ada ${target.emptyPages.length} halaman scan; klik OCR lagi untuk melanjutkan.` : ''} Hasil OCR bisa mengandung salah baca.`, found < pages.length);
    } catch (error) {
      setStatus(error.message?.startsWith('Mesin OCR') || error.message?.startsWith('Isi PDF') ? error.message : 'OCR gagal dijalankan. Coba lagi atau gunakan PDF lain.', true);
    } finally {
      reading = '';
      updateBusyState();
    }
  });

  urlForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isGenerating || reading) return;
    const raw = urlInput.value.trim();
    let parsed;
    try { parsed = new URL(raw); } catch { parsed = null; }
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      setStatus('Masukkan URL lengkap yang diawali https://, misalnya https://id.wikipedia.org/wiki/Fotosintesis.', true);
      urlInput.focus();
      return;
    }
    reading = 'url';
    updateBusyState();
    setStatus(`Mengambil isi ${hostOf(raw)}...`);
    try {
      const data = await api.request({ task: 'extract-url', url: raw }, { onWait: (seconds) => setStatus(`Server sibuk, mencoba lagi dalam ${seconds} detik...`) });
      const found = data.result;
      if (typeof found?.text !== 'string' || found.text.trim().length < MIN_LENGTH) throw new Error('Halaman tidak berisi teks yang bisa dipelajari.');
      attachment = {
        kind: 'url', sourceKind: found.kind === 'youtube' ? 'youtube' : 'article',
        name: (typeof found.title === 'string' && found.title.trim() ? found.title.trim() : hostOf(raw)).slice(0, 255),
        url: typeof found.url === 'string' && /^https?:\/\//.test(found.url) ? found.url.slice(0, 2048) : raw,
        text: found.text.trim(), notes: null,
      };
      urlInput.value = '';
      updateAttachment();
      showMessage();
      setStatus(attachment.sourceKind === 'youtube'
        ? 'Transkrip video siap dipakai. Transkrip otomatis bisa mengandung salah dengar.'
        : 'Isi artikel siap dipakai. Teks diambil dari halaman, tanpa gambar.');
    } catch (error) {
      setStatus(error.message || 'Isi URL gagal diambil.', true);
    } finally {
      reading = '';
      updateBusyState();
    }
  });

  content.addEventListener('input', () => { updateCounter(); showMessage(); });
  typeInputs.forEach((input) => input.addEventListener('change', () => {
    selectedType = input.value;
    updateSettings();
    typeInputs.forEach((item) => item.closest('.type-option')?.classList.toggle('is-selected', item.checked));
  }));

  generateButton.addEventListener('click', async () => {
    if (isGenerating || reading) return;
    if (attachment?.kind === 'pdf' && !attachment.text) return showMessage('PDF ini belum memiliki teks yang terbaca. Jalankan OCR terlebih dahulu.');
    let studyMaterial = attachment ? attachment.text : content.value.trim();
    if (!studyMaterial) return showMessage('Materi tidak boleh kosong.');
    if (studyMaterial.length < MIN_LENGTH) return showMessage(`Materi terlalu pendek. Masukkan minimal ${MIN_LENGTH} karakter agar StudyGen dapat memproses materi.`);
    if (!attachment && studyMaterial.length > MAX_LENGTH) return showMessage(`Materi terlalu panjang. Maksimal ${MAX_LENGTH.toLocaleString('id-ID')} karakter.`);
    const requestType = selectedType;
    const settings = {
      count: Number(itemCount.value), difficulty: difficulty.value, summaryLength: summaryLength.value,
      language: language.value, questionType: questionType.value,
    };
    const source = attachment;
    const title = materialName.value.trim() || (source ? source.name.replace(/\.pdf$/i, '') : '');
    const onWait = (seconds) => setResult(`Layanan AI sedang sibuk. Mencoba lagi dalam ${seconds} detik...`, 'is-loading');
    showMessage();
    setLoading(true);
    ui.clear();
    badge.hidden = true;
    setResult('StudyGen sedang memproses materi...', 'is-loading');
    try {
      if (source) {
        const label = source.kind === 'pdf' ? 'PDF' : source.sourceKind === 'youtube' ? 'video' : 'artikel';
        if (!source.notes) source.notes = await window.StudyGenDocument.prepare(source.text,
          async (chunk) => (await api.request({ type: 'summary', task: 'document-notes', content: chunk, settings: { count: 5, difficulty: 'medium', summaryLength: 'long' } }, { onWait })).result,
          (part, total, round) => setResult(`${round === 1 ? `Mempelajari ${label}` : `Menggabungkan catatan ${label}`}: bagian ${part} dari ${total}...`, 'is-loading'));
        studyMaterial = source.notes;
        setResult(`Seluruh bagian ${label} sudah dipelajari. Membuat bahan belajar...`, 'is-loading');
      }
      const data = await api.request({ type: requestType, content: studyMaterial, settings }, { onWait });
      const recordSource = !source ? undefined
        : source.kind === 'pdf' ? { type: 'pdf', name: source.name, pages: source.pages }
          : { type: 'url', name: source.name, url: source.url, kind: source.sourceKind };
      ui.showGenerated(data, studyMaterial, { title, settings, source: recordSource });
    } catch (error) {
      resetResult();
      showMessage(error.message || 'Gagal menghubungi AI. Silakan coba kembali beberapa saat lagi.');
    } finally { setLoading(false); }
  });

  ui.initialize({ restore: (record) => {
    attachment = null;
    updateAttachment();
    content.value = record.source ? '' : record.content;
    materialName.value = record.title;
    itemCount.value = String(record.settings.count);
    difficulty.value = record.settings.difficulty;
    summaryLength.value = record.settings.summaryLength;
    language.value = record.settings.language;
    questionType.value = record.settings.questionType;
    setStatus(record.source?.type === 'pdf'
      ? `Hasil dari ${record.source.name} dipulihkan. Pilih ulang PDF untuk membuat bahan belajar baru.`
      : record.source?.type === 'url'
        ? `Hasil dari ${record.source.name} dipulihkan. Tempel ulang URL-nya untuk membuat bahan belajar baru.`
        : 'Materi dipulihkan dari riwayat. Kamu bisa mengeditnya untuk membuat latihan baru.');
    updateCounter();
    const selected = typeInputs.find((item) => item.value === record.type);
    if (selected) {
      selected.checked = true;
      selected.dispatchEvent(new Event('change'));
    }
    showMessage();
  } });
  updateSettings();
  updateCounter();
})();
