// Study statistics built from local history: totals, a quiz-score trend, and what to review next.
(() => {
  'use strict';
  const core = window.StudyGenCore;
  const container = document.getElementById('stats-content');
  const SVG = 'http://www.w3.org/2000/svg';
  let busy = false;

  const element = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const svg = (tag, attributes = {}) => {
    const node = document.createElementNS(SVG, tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  };
  const shortDate = (time) => new Date(time).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const tile = (label, value, note = '') => {
    const node = element('div', 'stat-tile');
    node.append(element('p', 'stat-label', label), element('p', 'stat-value', value));
    if (note) node.append(element('p', 'stat-note', note));
    return node;
  };

  // Single-series line chart: one accent color, no legend; the heading names the series.
  const trendChart = (attempts) => {
    const figure = element('figure', 'stat-chart');
    figure.append(element('figcaption', 'stat-heading', 'Skor kuis dari waktu ke waktu'));
    if (attempts.length < 2) {
      figure.append(element('p', 'stat-empty', attempts.length
        ? 'Kerjakan satu kuis lagi untuk melihat perkembangan skormu.'
        : 'Belum ada kuis yang diperiksa. Skor akan tampil di sini setelah kamu mengerjakan kuis.'));
      return figure;
    }
    const width = 640;
    const height = 220;
    const pad = { top: 14, right: 16, bottom: 28, left: 36 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const x = (i) => pad.left + (attempts.length === 1 ? plotW / 2 : (i / (attempts.length - 1)) * plotW);
    const y = (value) => pad.top + plotH - (value / 100) * plotH;
    const wrap = element('div', 'chart-wrap');
    const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart-svg', role: 'img', 'aria-label': `Grafik ${attempts.length} skor kuis terakhir, dari ${attempts[0].percent} sampai ${attempts.at(-1).percent}.` });
    [0, 50, 100].forEach((tick) => {
      chart.append(svg('line', { x1: pad.left, x2: width - pad.right, y1: y(tick), y2: y(tick), class: tick === 0 ? 'chart-baseline' : 'chart-grid' }));
      const label = svg('text', { x: pad.left - 8, y: y(tick) + 4, class: 'chart-axis', 'text-anchor': 'end' });
      label.textContent = String(tick);
      chart.append(label);
    });
    [0, attempts.length - 1].forEach((i) => {
      const label = svg('text', { x: x(i), y: height - 8, class: 'chart-axis', 'text-anchor': i === 0 ? 'start' : 'end' });
      label.textContent = new Date(attempts[i].at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      chart.append(label);
    });
    chart.append(svg('polyline', { points: attempts.map((item, i) => `${x(i)},${y(item.percent)}`).join(' '), class: 'chart-line' }));
    const tooltip = element('div', 'chart-tooltip');
    tooltip.hidden = true;
    const marker = svg('line', { y1: pad.top, y2: pad.top + plotH, class: 'chart-crosshair', visibility: 'hidden' });
    chart.append(marker);
    const show = (i) => {
      const item = attempts[i];
      marker.setAttribute('x1', x(i));
      marker.setAttribute('x2', x(i));
      marker.setAttribute('visibility', 'visible');
      tooltip.replaceChildren(element('strong', '', `Skor ${item.percent}`), element('span', '', `${core.formatPoints(item.score)}/${item.total} benar`), element('span', '', item.title), element('span', 'tooltip-muted', shortDate(item.at)));
      tooltip.hidden = false;
      const left = (x(i) / width) * 100;
      tooltip.style.left = `${Math.min(80, Math.max(20, left))}%`;
      tooltip.style.top = `${(y(item.percent) / height) * 100}%`;
    };
    const hide = () => { tooltip.hidden = true; marker.setAttribute('visibility', 'hidden'); };
    attempts.forEach((item, i) => {
      const group = svg('g', { class: 'chart-point', tabindex: '0', role: 'img', 'aria-label': `Skor ${item.percent}, ${item.title}, ${shortDate(item.at)}` });
      // Hit area is larger than the visible dot.
      group.append(svg('circle', { cx: x(i), cy: y(item.percent), r: 14, class: 'chart-hit' }), svg('circle', { cx: x(i), cy: y(item.percent), r: 4.5, class: 'chart-dot' }));
      group.addEventListener('pointerenter', () => show(i));
      group.addEventListener('focus', () => show(i));
      group.addEventListener('pointerleave', hide);
      group.addEventListener('blur', hide);
      chart.append(group);
    });
    const last = attempts.at(-1);
    const lastLabel = svg('text', { x: x(attempts.length - 1) - 8, y: y(last.percent) - 10, class: 'chart-label', 'text-anchor': 'end' });
    lastLabel.textContent = `${last.percent}`;
    chart.append(lastLabel);
    wrap.append(chart, tooltip);
    figure.append(wrap);

    // Table view of the same data for screen readers and anyone who prefers numbers.
    const details = element('details', 'chart-table');
    details.append(element('summary', '', 'Lihat sebagai tabel'));
    const table = element('table');
    const head = element('tr');
    ['Waktu', 'Materi', 'Benar', 'Skor'].forEach((text) => head.append(element('th', '', text)));
    table.append(head);
    [...attempts].reverse().forEach((item) => {
      const row = element('tr');
      [shortDate(item.at), item.title, `${core.formatPoints(item.score)}/${item.total}`, String(item.percent)].forEach((text) => row.append(element('td', '', text)));
      table.append(row);
    });
    details.append(table);
    figure.append(details);
    return figure;
  };

  const render = (records, { open }) => {
    if (!container) return;
    const now = Date.now();
    const quizzes = records.filter((record) => record.type === 'quiz');
    const decks = records.filter((record) => record.type === 'flashcard');
    const attempts = quizzes.flatMap((record) => (record.attempts || []).map((item) => ({ ...item, title: record.title, percent: Math.round((item.score / item.total) * 100) })))
      .sort((a, b) => a.at - b.at);
    const average = attempts.length ? Math.round(attempts.reduce((sum, item) => sum + item.percent, 0) / attempts.length) : null;
    const cardsTotal = decks.reduce((sum, record) => sum + record.result.cards.length, 0);
    const cardsKnown = decks.reduce((sum, record) => sum + Object.values(record.progress.ratings).filter((rating) => rating === 'known').length, 0);
    const dueDecks = decks.map((record) => ({ record, due: record.result.cards.filter((_, i) => core.isDue(record.srs?.[i], now)).length })).filter((item) => item.due > 0);
    const dueTotal = dueDecks.reduce((sum, item) => sum + item.due, 0);

    container.replaceChildren();
    if (!records.length) {
      container.append(element('p', 'history-empty', 'Statistik akan muncul setelah kamu membuat dan mengerjakan bahan belajar.'));
      return;
    }
    const tiles = element('div', 'stat-tiles');
    tiles.append(
      tile('Materi tersimpan', String(records.length)),
      tile('Kuis diperiksa', String(attempts.length)),
      tile('Rata-rata skor kuis', average === null ? '–' : String(average), average === null ? 'Belum ada kuis' : 'dari 100'),
      tile('Kartu dipahami', cardsTotal ? `${cardsKnown}/${cardsTotal}` : '–'),
      tile('Perlu diulang hari ini', String(dueTotal), dueTotal ? 'kartu flashcard' : 'Tidak ada kartu jatuh tempo'),
    );
    const grid = element('div', 'stat-grid');
    grid.append(trendChart(attempts.slice(-20)));

    const side = element('div', 'stat-side');
    const reviewBlock = element('section', 'stat-block');
    reviewBlock.append(element('h3', 'stat-heading', 'Jadwal ulang hari ini'));
    if (!dueDecks.length) reviewBlock.append(element('p', 'stat-empty', 'Tidak ada kartu yang jatuh tempo. Kartu yang kamu nilai akan dijadwalkan ulang otomatis.'));
    dueDecks.forEach(({ record, due }) => {
      const row = element('div', 'stat-row');
      row.append(element('span', '', `${record.title} · ${due} kartu`));
      const action = element('button', 'action-button secondary small', 'Buka');
      action.type = 'button';
      action.disabled = busy;
      action.setAttribute('aria-label', `Buka ${record.title} untuk mengulang ${due} kartu`);
      action.addEventListener('click', () => open(record));
      row.append(action);
      reviewBlock.append(row);
    });

    const mistakes = quizzes.flatMap((record) => Object.entries(record.mistakes || {}).map(([index, count]) => ({ record, index: Number(index), count })))
      .filter((item) => item.record.result.questions[item.index])
      .sort((a, b) => b.count - a.count || b.record.createdAt - a.record.createdAt).slice(0, 5);
    const mistakeBlock = element('section', 'stat-block');
    mistakeBlock.append(element('h3', 'stat-heading', 'Soal yang paling sering salah'));
    if (!mistakes.length) mistakeBlock.append(element('p', 'stat-empty', 'Belum ada catatan kesalahan. Soal yang salah dijawab akan muncul di sini.'));
    const list = element('ol', 'mistake-list');
    mistakes.forEach(({ record, index, count }) => {
      const item = element('li');
      const text = record.result.questions[index].question;
      item.append(element('span', 'mistake-question', text.length > 120 ? `${text.slice(0, 117)}...` : text), element('span', 'mistake-meta', `${record.title} · salah ${count}×`));
      list.append(item);
    });
    if (mistakes.length) mistakeBlock.append(list);
    side.append(reviewBlock, mistakeBlock);
    grid.append(side);
    container.append(tiles, grid);
  };

  window.StudyGenStats = {
    render,
    setBusy(value) {
      busy = value;
      container?.querySelectorAll('button').forEach((node) => { node.disabled = value; });
    },
  };
})();
