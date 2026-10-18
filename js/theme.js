// Light/dark toggle. The initial theme is applied by a small inline script in <head>
// so the page never flashes the wrong colors.
(() => {
  const KEY = 'studygen.theme';
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const current = () => document.documentElement.dataset.theme || (media.matches ? 'dark' : 'light');
  const render = () => {
    const dark = current() === 'dark';
    toggle.setAttribute('aria-pressed', String(dark));
    toggle.querySelector('.theme-icon').textContent = dark ? '☀' : '☾';
    toggle.querySelector('.theme-label').textContent = dark ? 'Terang' : 'Gelap';
    toggle.setAttribute('aria-label', dark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap');
  };
  toggle.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* The theme still applies for this visit. */ }
    render();
  });
  media.addEventListener?.('change', render);
  render();
})();
