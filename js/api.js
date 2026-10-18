// One place for backend calls, including the automatic retry when Groq is busy.
(() => {
  const endpoint = document.currentScript?.dataset.apiUrl || 'api/generate';

  const request = async (payload, { onWait = () => {} } = {}) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } catch {
        throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet, lalu coba lagi.');
      }
      let data;
      try { data = await response.json(); } catch { throw new Error('Respons server tidak valid.'); }
      if (data?.upstreamStatus === 429 && attempt < 2) {
        const seconds = Math.min(120, Math.max(1, Number(data.retryAfter) || 60));
        onWait(seconds);
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        continue;
      }
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Gagal menghubungi AI. Silakan coba lagi.');
      if (payload.type && data.type !== payload.type) throw new Error('Jenis hasil server tidak sesuai dengan permintaan.');
      return data;
    }
    throw new Error('Layanan AI sedang sibuk. Silakan coba lagi beberapa saat lagi.');
  };

  window.StudyGenAPI = { endpoint, request };
})();
