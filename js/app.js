(() => {
  const MIN_LENGTH = 20;
  const MAX_LENGTH = 15000;
  const content = document.getElementById('study-content');
  const pdfInput = document.getElementById('pdf-file');
  const pdfStatus = document.getElementById('pdf-status');
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
  const MAX_PDF_SIZE = 10 * 1024 * 1024;
  const MAX_PDF_PAGES = 100;
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

      let extracted = '';
      let truncated = pdf.numPages > MAX_PDF_PAGES;
      for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_PDF_PAGES); pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => item.str ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
        if (!pageText) continue;
        const separator = extracted ? '\n\n' : '';
        const remaining = MAX_LENGTH - extracted.length - separator.length;
        if (remaining <= 0) {
          truncated = true;
          break;
        }
        if (pageText.length > remaining) {
          extracted += separator + pageText.slice(0, Math.max(remaining, 0));
          truncated = true;
          break;
        }
        extracted += separator + pageText;
      }

      extracted = extracted.trim();
      if (extracted.length < MIN_LENGTH) {
        throw new Error('Teks PDF tidak terbaca. Jika PDF berupa hasil scan, salin teksnya secara manual.');
      }
      content.value = extracted;
      updateCounter();
      showMessage();
      setPdfStatus(truncated
        ? 'Sebagian teks PDF dimasukkan karena batas 15.000 karakter atau 100 halaman. Periksa bagian yang akan dipakai.'
        : `Teks dari ${file.name} sudah masuk. Periksa atau edit sebelum membuat bahan belajar.`, truncated);
    } catch (error) {
      setPdfStatus(error.message === 'File yang dipilih bukan PDF yang valid.' || error.message?.startsWith('Teks PDF tidak terbaca')
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

  content.addEventListener('input', () => { updateCounter(); showMessage(); setPdfStatus('Materi dapat diketik atau diambil dari PDF.'); });
  typeInputs.forEach((input) => input.addEventListener('change', () => {
    selectedType = input.value;
    updateSettings();
    typeInputs.forEach((item) => {
      item.closest('.type-option')?.classList.toggle('is-selected', item.checked);
    });
  }));

  generateButton.addEventListener('click', async () => {
    if (isGenerating || isReadingPdf) return;
    const studyMaterial = content.value.trim();
    if (!studyMaterial) return showMessage('Materi tidak boleh kosong.');
    if (studyMaterial.length < MIN_LENGTH) return showMessage(`Materi terlalu pendek. Masukkan minimal ${MIN_LENGTH} karakter agar StudyGen dapat memproses materi.`);
    if (studyMaterial.length > MAX_LENGTH) return showMessage(`Materi terlalu panjang. Maksimal ${MAX_LENGTH.toLocaleString('id-ID')} karakter.`);
    const requestType = selectedType;
    const settings = { count: Number(itemCount.value), difficulty: difficulty.value, summaryLength: summaryLength.value };
    const title = materialName.value.trim();
    showMessage(); setLoading(true); badge.hidden = true;
    setResult('StudyGen sedang memproses materi...', 'is-loading');
    try {
      const response = await fetch(apiEndpoint, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ type:requestType, content:studyMaterial, settings }) });
      let data;
      try { data = await response.json(); } catch { throw new Error('Respons server tidak valid.'); }
      if (!response.ok || !data.success) throw new Error(data.error || 'Gagal menghasilkan materi. Silakan coba lagi.');
      if (data.type !== requestType) throw new Error('Jenis hasil server tidak sesuai dengan permintaan.');
      window.StudyGenUI.showGenerated(data, studyMaterial, { title, settings });
    } catch (error) {
      resetResult();
      showMessage(error.message || 'Gagal menghubungi AI. Silakan coba kembali beberapa saat lagi.');
    } finally { setLoading(false); }
  });
  window.StudyGenUI.initialize({ restore: (record) => {
    content.value = record.content;
    materialName.value = record.title;
    itemCount.value = String(record.settings.count);
    difficulty.value = record.settings.difficulty;
    summaryLength.value = record.settings.summaryLength;
    setPdfStatus('Materi dipulihkan dari riwayat. Kamu bisa mengeditnya untuk membuat latihan baru.');
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
