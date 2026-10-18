// OCR for scanned PDF pages. Tesseract.js (and its language data) is only
// downloaded when the user asks for OCR, so normal use stays light.
(() => {
  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let loading = null;

  const loadTesseract = () => {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    loading ||= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TESSERACT_URL;
      script.integrity = 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F';
      script.crossOrigin = 'anonymous';
      script.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('Mesin OCR gagal dimuat.')));
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(new Error('Mesin OCR gagal dimuat. Pastikan perangkat terhubung ke internet.'));
      };
      document.head.append(script);
    });
    return loading;
  };

  // Returns { pageNumber: text } for the requested pages.
  const recognize = async ({ pdfjs, bytes, pages, onProgress = () => {} }) => {
    onProgress({ stage: 'load' });
    const Tesseract = await loadTesseract();
    const worker = await Tesseract.createWorker(['ind', 'eng'], 1, {
      logger: (event) => { if (event.status?.includes('traineddata')) onProgress({ stage: 'language', progress: event.progress || 0 }); },
    });
    const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const results = {};
    try {
      for (let i = 0; i < pages.length; i++) {
        const pageNumber = pages[i];
        onProgress({ stage: 'page', done: i, total: pages.length, page: pageNumber });
        const page = await pdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(3, 2000 / Math.max(base.width, base.height)) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport }).promise;
        page.cleanup();
        const { data } = await worker.recognize(canvas);
        results[pageNumber] = (data?.text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        canvas.width = 0;
        canvas.height = 0;
      }
    } finally {
      await worker.terminate();
      await pdf.destroy();
    }
    return results;
  };

  window.StudyGenOCR = { recognize };
})();
