// Shows the Groq quota reported by the backend after each AI call.
(() => {
  const storageKey = 'studygen.aiQuota';
  const element = document.getElementById('ai-quota');
  if (!element) return;
  const format = (value) => value.toLocaleString('id-ID');
  const duration = (seconds) => {
    if (seconds < 60) return `${Math.max(1, Math.round(seconds))} detik`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} menit`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return minutes ? `${hours} jam ${minutes} menit` : `${hours} jam`;
  };

  const render = (quota) => {
    const elapsed = (Date.now() - quota.savedAt) / 1000;
    // A saved number older than its reset time has refilled since.
    const current = (bucket) => bucket && (bucket.resetSeconds && elapsed >= bucket.resetSeconds ? { ...bucket, remaining: bucket.limit } : bucket);
    const requests = current(quota.requests);
    const tokens = current(quota.tokens);
    const main = requests || tokens;
    if (!main) return;
    const lines = [];
    if (requests) {
      lines.push(`Permintaan AI: sisa ${format(requests.remaining)} dari ${format(requests.limit)} per hari.`);
      if (requests.resetSeconds && requests.resetSeconds > elapsed) lines.push(`Kuota permintaan pulih penuh dalam ±${duration(requests.resetSeconds - elapsed)}.`);
    }
    if (tokens) lines.push(`Token: sisa ${format(tokens.remaining)} dari ${format(tokens.limit)} per menit.`);
    lines.push('Kuota dipakai bersama oleh semua pengguna aplikasi ini.');
    element.title = lines.join('\n');
    element.setAttribute('aria-label', `Kuota AI. ${lines.join(' ')}`);
    element.innerHTML = '';
    element.append('Kuota AI ');
    const count = document.createElement('strong');
    count.textContent = `${format(main.remaining)}/${format(main.limit)}`;
    element.append(count);
    element.classList.toggle('is-low', main.remaining / main.limit < 0.1);
    element.hidden = false;
  };

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved?.savedAt) render(saved);
  } catch {}

  window.addEventListener('studygen:ratelimit', (event) => {
    const quota = { ...event.detail, savedAt: Date.now() };
    render(quota);
    try { localStorage.setItem(storageKey, JSON.stringify(quota)); } catch {}
  });
})();
