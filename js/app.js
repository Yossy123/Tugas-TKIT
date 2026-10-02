(() => {
  const MIN_LENGTH = 20;
  const MAX_LENGTH = 15000;
  const content = document.getElementById('study-content');
  const pdfInput = document.getElementById('pdf-file');
  const pdfStatus = document.getElementById('pdf-status');
  const pdfAttachment = document.getElementById('pdf-attachment');
  const removePdf = document.getElementById('remove-pdf');
  const textMaterial = document.getElementById('text-material');
  const counter = document.getElementById('char-counter');
  const typeInputs = [...document.querySelectorAll('input[name="type"]')];
  const generateButton = document.getElementById('generate-button');
  const buttonLabel = generateButton.querySelector('.button-label');
  const message = document.getElementById('form-message');
  const result = document.getElementById('result-content');
  const badge = document.getElementById('result-badge');
  const materialName = document.getElementById('material-name');
  const itemCount = document.getElementById('item-count');
  const difficulty = document.getElementById('quiz-difficulty');
  const summaryLength = document.getElementById('summary-length');
  const updateSettings = () => {
    document.getElementById('summary-setting').hidden = selectedType !== 'summary';
    document.getElementById('count-setting').hidden = selectedType === 'summary';
    document.getElementById('difficulty-setting').hidden = selectedType !== 'quiz';
    document.getElementById('count-label').textContent = selectedType === 'quiz' ? 'Jumlah soal' : 'Jumlah kartu';
  };
  let selectedType = 'summary';
  let isGenerating = false;
  let isReadingPdf = false;
  let selectedPdf = null;
  const MAX_PDF_SIZE = 10 * 1024 * 1024;
  const MAX_PDF_PAGES = 500;
  const MAX_PDF_TEXT = 1000000;
  const scriptUrl = document.currentScript?.src || new URL('js/app.js', document.baseURI).href;
  const apiEndpoint = document.currentScript?.dataset.apiUrl || 'api/generate';
  const pdfModuleUrl = new URL('vendor/pdfjs/pdf.min.mjs', scriptUrl).href;
  const pdfWorkerUrl = new URL('vendor/pdfjs/pdf.worker.min.mjs', scriptUrl).href;

  const updateCounter = () => { counter.textContent = `${content.value.length.toLocaleString('id-ID')} / ${MAX_LENGTH.toLocaleString('id-ID')}`; };
  const showMessage = (text = '') => { message.hidden = !text; message.textContent = text; };
  const setResult = (text, state = '') => { result.className = `result-content${state ? ` ${state}` : ''}`; result.textContent = text; };
  const resetResult = () => {
    result.className = 'result-content is-empty';
    result.innerHTML = '<span class="empty-symbol" aria-hidden="true">✳</span><p class="empty-title">Siap untuk mulai belajar?</p><p>Hasil dari materi yang kamu masukkan akan muncul di sini.</p>';
  };
  const updateBusyState = () => {
    generateButton.disabled = isGenerating || isReadingPdf;
    pdfInput.disabled = isGenerating || isReadingPdf;
    removePdf.disabled = isGenerating || isReadingPdf;
    content.readOnly = isGenerating || isReadingPdf;
    [materialName, itemCount, difficulty, summaryLength, ...typeInputs].forEach((input) => { input.disabled = isGenerating || isReadingPdf; });
    result.setAttribute('aria-busy', String(isGenerating));
    window.StudyGenUI.setBusy(isGenerating || isReadingPdf);
    buttonLabel.textContent = isGenerating ? 'Sedang membuat...' : isReadingPdf ? 'Membaca PDF...' : 'Buat bahan belajar';
  };
  const setLoading = (loading) => { isGenerating = loading; updateBusyState(); };
  const setPdfStatus = (text, warning = false) => {
    pdfStatus.textContent = text;
    pdfStatus.classList.toggle('is-warning', warning);
  };
  const updatePdfAttachment = () => {
    pdfAttachment.hidden = !selectedPdf;
    textMaterial.hidden = Boolean(selectedPdf);
    counter.hidden = Boolean(selectedPdf);
    if (selectedPdf) {
      document.getElementById('pdf-name').textContent = selectedPdf.name;
      document.getElementById('pdf-details').textContent = `${selectedPdf.pages} halaman · ${(selectedPdf.size / 1024 / 1024).toLocaleString('id-ID', { maximumFractionDigits: 2 })} MB${selectedPdf.emptyPages ? ` · ${selectedPdf.emptyPages} halaman tanpa teks` : ''}`;
    }
  };
  removePdf.addEventListener('click', () => {
    if (isGenerating || isReadingPdf) return;
    selectedPdf = null;
    updatePdfAttachment();
    setPdfStatus('Lampirkan PDF maksimal 10 MB dan 500 halaman, atau masukkan materi teks.');
    showMessage();
    content.focus();
  });

  const requestGeneration = async (payload) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(apiEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      let data;
      try { data = await response.json(); } catch { throw new Error('Respons server tidak valid.'); }
      if (data.upstreamStatus === 429 && attempt < 2) {
        const seconds = Math.min(120, Math.max(1, Number(data.retryAfter) || 60));
        setResult(`Layanan AI sedang sibuk. Mencoba lagi dalam ${seconds} detik...`, 'is-loading');
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        continue;
      }
      if (!response.ok || !data.success) throw new Error(data.error || 'Gagal menghasilkan materi. Silakan coba lagi.');
      if (data.type !== payload.type) throw new Error('Jenis hasil server tidak sesuai dengan permintaan.');
      return data;
    }
  };

  pdfInput.addEventListener('change', async () => {
    const file = pdfInput.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setPdfStatus('Pilih file dengan format PDF.', true);
      pdfInput.value = '';
      return;
    }
    if (file.size > MAX_PDF_SIZE) {
      setPdfStatus('Ukuran PDF maksimal 10 MB.', true);
      pdfInput.value = '';
      return;
    }

    isReadingPdf = true;
    updateBusyState();
    setPdfStatus(`Membaca ${file.name}...`);
    let pdf;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) {
        throw new Error('File yang dipilih bukan PDF yang valid.');
      }
      const pdfjs = await import(pdfModuleUrl);
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      pdf = await pdfjs.getDocument({ data: bytes }).promise;
      if (pdf.numPages > MAX_PDF_PAGES) throw new Error('PDF maksimal 500 halaman. Pisahkan dokumen menjadi beberapa file.');
      let extracted = '';
      let emptyPages = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        setPdfStatus(`Membaca halaman ${pageNumber} dari ${pdf.numPages}...`);
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => item.str ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
        page.cleanup();
        if (!pageText) { emptyPages++; continue; }
        extracted += `${extracted ? '\n\n' : ''}Halaman ${pageNumber}:\n${pageText}`;
        if (extracted.length > MAX_PDF_TEXT) throw new Error('Isi PDF terlalu besar. Pisahkan dokumen menjadi beberapa file.');
      }

      extracted = extracted.trim();
      if (extracted.length < MIN_LENGTH) {
        throw new Error('Teks PDF tidak terbaca. PDF hasil scan perlu OCR sebelum digunakan.');
      }
      selectedPdf = { name: file.name.slice(0, 255), pages: pdf.numPages, size: file.size, emptyPages, text: extracted, notes: null };
      updatePdfAttachment();
      showMessage();
      setPdfStatus(emptyPages
        ? `PDF siap dipakai. ${emptyPages} halaman tanpa teks tidak dapat dibaca; halaman scan perlu OCR.`
        : 'PDF siap dipakai. Seluruh halaman akan diproses tanpa mengisi kolom teks.', emptyPages > 0);
    } catch (error) {
      setPdfStatus(error.message === 'File yang dipilih bukan PDF yang valid.' || error.message?.startsWith('Teks PDF tidak terbaca') || error.message?.startsWith('PDF maksimal') || error.message?.startsWith('Isi PDF terlalu besar')
        ? error.message
        : 'PDF gagal dibaca. Pastikan file tidak rusak atau terkunci dengan kata sandi.', true);
    } finally {
      if (pdf) {
        try { await pdf.destroy(); } catch { /* The selected text is already available. */ }
      }
      pdfInput.value = '';
      isReadingPdf = false;
      updateBusyState();
    }
  });

  content.addEventListener('input', () => { updateCounter(); showMessage(); });
  typeInputs.forEach((input) => input.addEventListener('change', () => {
    selectedType = input.value;
    updateSettings();
    typeInputs.forEach((item) => {
      item.closest('.type-option')?.classList.toggle('is-selected', item.checked);
    });
  }));

  generateButton.addEventListener('click', async () => {
    if (isGenerating || isReadingPdf) return;
    let studyMaterial = selectedPdf ? selectedPdf.text : content.value.trim();
    if (!studyMaterial) return showMessage('Materi tidak boleh kosong.');
    if (studyMaterial.length < MIN_LENGTH) return showMessage(`Materi terlalu pendek. Masukkan minimal ${MIN_LENGTH} karakter agar StudyGen dapat memproses materi.`);
    if (!selectedPdf && studyMaterial.length > MAX_LENGTH) return showMessage(`Materi terlalu panjang. Maksimal ${MAX_LENGTH.toLocaleString('id-ID')} karakter.`);
    const requestType = selectedType;
    const settings = { count: Number(itemCount.value), difficulty: difficulty.value, summaryLength: summaryLength.value };
    const title = materialName.value.trim() || (selectedPdf ? selectedPdf.name.replace(/\.pdf$/i, '') : '');
    showMessage(); setLoading(true); badge.hidden = true;
    setResult('StudyGen sedang memproses materi...', 'is-loading');
    try {
      if (selectedPdf) {
        if (!selectedPdf.notes) selectedPdf.notes = await window.StudyGenDocument.prepare(selectedPdf.text,
          async (chunk) => (await requestGeneration({ type: 'summary', task: 'document-notes', content: chunk, settings: { count: 5, difficulty: 'medium', summaryLength: 'long' } })).result,
          (part, total, round) => setResult(`${round === 1 ? 'Mempelajari PDF' : 'Menggabungkan catatan PDF'}: bagian ${part} dari ${total}...`, 'is-loading'));
        studyMaterial = selectedPdf.notes;
        setResult('Seluruh bagian PDF sudah dipelajari. Membuat bahan belajar...', 'is-loading');
      }
      const data = await requestGeneration({ type: requestType, content: studyMaterial, settings });
      const source = selectedPdf ? { type: 'pdf', name: selectedPdf.name, pages: selectedPdf.pages } : undefined;
      window.StudyGenUI.showGenerated(data, studyMaterial, { title, settings, source });
    } catch (error) {
      resetResult();
      showMessage(error.message || 'Gagal menghubungi AI. Silakan coba kembali beberapa saat lagi.');
    } finally { setLoading(false); }
  });
  window.StudyGenUI.initialize({ restore: (record) => {
    selectedPdf = null;
    updatePdfAttachment();
    content.value = record.source?.type === 'pdf' ? '' : record.content;
    materialName.value = record.title;
    itemCount.value = String(record.settings.count);
    difficulty.value = record.settings.difficulty;
    summaryLength.value = record.settings.summaryLength;
    setPdfStatus(record.source?.type === 'pdf'
      ? `Hasil dari ${record.source.name} dipulihkan. Pilih ulang PDF untuk membuat bahan belajar baru.`
      : 'Materi dipulihkan dari riwayat. Kamu bisa mengeditnya untuk membuat latihan baru.');
    updateCounter();
    const selected = typeInputs.find((item) => item.value === record.type);
    if (selected) {
      selected.checked = true;
      selected.dispatchEvent(new Event('change'));
    }
    showMessage();
  }});
  updateSettings();
  updateCounter();
})();
