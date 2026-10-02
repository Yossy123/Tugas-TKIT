(() => {
  'use strict';
  const STORAGE_KEY = 'studygen.history.v1';
  const MAX_RECORDS = 30;
  const labels = { summary: 'Ringkasan', quiz: 'Kuis', flashcard: 'Flashcard' };
  const result = document.getElementById('result-content');
  const badge = document.getElementById('result-badge');
  const announcement = document.getElementById('result-announcement');
  const historyList = document.getElementById('history-list');
  const historyMessage = document.getElementById('history-message');
  let records = [];
  let active = null;
  let restore = () => {};
  let busy = false;

  // All user and AI text is inserted as text, never as HTML.
  const element = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const button = (text, action, secondary = false) => {
    const node = element('button', secondary ? 'action-button secondary' : 'action-button', text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const notifyHistory = (text = '') => {
    historyMessage.textContent = text;
    historyMessage.hidden = !text;
  };
  const validText = (value, max = 2000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  const settingsFor = (value = {}) => ({
    count: [5, 10, 15].includes(value?.count) ? value.count : 5,
    difficulty: ['easy', 'medium', 'hard'].includes(value?.difficulty) ? value.difficulty : 'medium',
    summaryLength: ['short', 'medium', 'long'].includes(value?.summaryLength) ? value.summaryLength : 'medium',
  });
  const validResult = (type, value) => {
    if (type === 'summary') return validText(value, 60000);
    const items = type === 'quiz' ? value?.questions : value?.cards;
    if (!Array.isArray(items) || ![5, 10, 15].includes(items.length)) return false;
    return items.every((item) => type === 'quiz'
      ? validText(item?.question) && validText(item?.explanation) && ['A', 'B', 'C', 'D'].includes(item?.answer)
        && ['A', 'B', 'C', 'D'].every((letter) => validText(item?.options?.[letter]))
        && new Set(['A', 'B', 'C', 'D'].map((letter) => item.options[letter].trim())).size === 4
      : validText(item?.front) && validText(item?.back));
  };
  const allIndices = (record) => Array.from({ length: record.type === 'quiz' ? record.result.questions.length : record.result.cards.length }, (_, i) => i);
  const normalizeProgress = (record, saved) => {
    if (record.type === 'summary') return null;
    const all = allIndices(record);
    const indices = (value) => Array.isArray(value) && value.length > 0 && value.length <= all.length
      && value.every((i) => Number.isInteger(i) && all.includes(i)) && new Set(value).size === value.length ? value : all;
    if (record.type === 'quiz') {
      const selected = indices(saved?.indices);
      const answers = {};
      selected.forEach((i) => { if (['A', 'B', 'C', 'D'].includes(saved?.answers?.[i])) answers[i] = saved.answers[i]; });
      return { indices: selected, answers, submitted: saved?.submitted === true && selected.every((i) => answers[i]) };
    }
    const queue = indices(saved?.queue);
    const ratings = {};
    all.forEach((i) => { if (['known', 'review'].includes(saved?.ratings?.[i])) ratings[i] = saved.ratings[i]; });
    const position = Number.isInteger(saved?.position) && saved.position >= 0 && saved.position <= queue.length
      && queue.slice(0, saved.position).every((i) => ratings[i]) ? saved.position : 0;
    return { queue, position, ratings, revealed: saved?.revealed === true };
  };
  const validRecord = (record) => record && validText(record.id, 100) && validText(record.title, 100)
    && Object.hasOwn(labels, record.type) && validText(record.content, 15000)
    && Number.isFinite(record.createdAt) && record.createdAt > 0 && Number.isFinite(new Date(record.createdAt).getTime())
    && validResult(record.type, record.result);

  const loadHistory = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('invalid-history');
      const seen = new Set();
      const valid = parsed.filter((record) => {
        if (!validRecord(record) || seen.has(record.id)) return false;
        seen.add(record.id);
        return true;
      }).slice(0, MAX_RECORDS);
      if (valid.length !== parsed.length) notifyHistory('Sebagian riwayat tidak dapat dibaca. Materi yang valid tetap tersedia.');
      return valid.map((record) => ({ ...record, settings: settingsFor(record.settings), progress: normalizeProgress(record, record.progress) }));
    } catch {
      notifyHistory('Riwayat tidak dapat dibaca atau penyimpanan browser tidak tersedia. Hasil baru tetap bisa dipakai pada sesi ini.');
      return [];
    }
  };
  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      notifyHistory();
    } catch {
      notifyHistory('Riwayat belum tersimpan: penyimpanan browser penuh atau tidak diizinkan. Hasil tetap tersedia selama halaman ini terbuka.');
    }
  };
  const saveProgress = () => {
    // Deleting a record must not resurrect it when the current exercise changes.
    if (records.some((record) => record.id === active.id)) persist();
    renderHistory();
  };
  const scoreFor = (record) => record.progress.indices.filter((i) => record.progress.answers[i] === record.result.questions[i].answer).length;
  const historyStatus = (record) => {
    if (record.type === 'summary') return 'Siap dibaca';
    const progress = record.progress;
    if (record.type === 'quiz') return progress.submitted
      ? `Skor terakhir: ${scoreFor(record)}/${progress.indices.length}`
      : `${Object.keys(progress.answers).length}/${progress.indices.length} soal dijawab`;
    return `${Object.values(progress.ratings).filter((rating) => rating === 'known').length}/${record.result.cards.length} kartu dipahami`;
  };
  const renderHistory = () => {
    historyList.replaceChildren();
    if (!records.length) {
      historyList.append(element('p', 'history-empty', 'Belum ada riwayat. Bahan belajar yang kamu buat akan tersimpan di sini.'));
      return;
    }
    records.forEach((record) => {
      const row = element('article', 'history-item');
      const copy = element('div', 'history-copy');
      copy.append(element('h3', '', record.title));
      const date = new Date(record.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
      copy.append(element('p', 'history-meta', `${labels[record.type]} · ${date}`), element('p', 'history-progress', historyStatus(record)));
      const actions = element('div', 'session-actions');
      const open = button('Buka', () => {
        if (busy) return;
        active = record;
        restore(record);
        renderResult(true);
        result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      open.setAttribute('aria-label', `Buka ${record.title}, ${labels[record.type]}`);
      const remove = button('Hapus', () => {
        if (busy) return;
        records = records.filter((item) => item.id !== record.id);
        persist();
        renderHistory();
        const next = historyList.querySelector('button');
        if (next) next.focus();
        else document.getElementById('history-title').focus();
        announcement.textContent = `${record.title} dihapus dari riwayat.`;
      }, true);
      remove.setAttribute('aria-label', `Hapus ${record.title} dari riwayat`);
      open.disabled = remove.disabled = busy;
      actions.append(open, remove);
      row.append(copy, actions);
      historyList.append(row);
    });
  };

  const renderQuiz = () => {
    const { questions } = active.result;
    const progress = active.progress;
    const answered = () => progress.indices.filter((i) => progress.answers[i]).length;
    const status = element('p', 'session-meta');
    const updateStatus = () => { status.textContent = `${answered()}/${progress.indices.length} soal dijawab${progress.indices.length < questions.length ? ' · Latihan ulang' : ''}`; };
    updateStatus();
    result.append(status);
    if (progress.submitted) {
      const score = scoreFor(active);
      const scoreBox = element('div', 'score-box', `Skor: ${Math.round(score / progress.indices.length * 100)} · ${score}/${progress.indices.length} benar`);
      result.append(scoreBox);
    } else result.append(element('p', 'session-hint', 'Jawab semua soal, lalu periksa hasil untuk melihat pembahasan.'));
    const form = element('form', 'quiz-form');
    const submit = button('Periksa jawaban', () => {});
    submit.type = 'submit';
    submit.disabled = answered() !== progress.indices.length;
    progress.indices.forEach((index, order) => {
      const question = questions[index];
      const field = element('fieldset', 'quiz-question');
      field.append(element('legend', '', `${order + 1}. ${question.question}`));
      ['A', 'B', 'C', 'D'].forEach((letter) => {
        const option = element('label', 'quiz-option');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `question-${index}`;
        input.value = letter;
        input.checked = progress.answers[index] === letter;
        input.disabled = progress.submitted;
        if (progress.submitted && letter === question.answer) option.classList.add('is-correct');
        if (progress.submitted && input.checked && letter !== question.answer) option.classList.add('is-incorrect');
        input.addEventListener('change', () => {
          progress.answers[index] = letter;
          updateStatus();
          submit.disabled = answered() !== progress.indices.length;
          saveProgress();
        });
        option.append(input, element('span', '', `${letter}. ${question.options[letter]}`));
        field.append(option);
      });
      if (progress.submitted) {
        const correct = progress.answers[index] === question.answer;
        field.append(element('p', correct ? 'answer-feedback correct' : 'answer-feedback incorrect',
          `${correct ? 'Benar' : `Jawabanmu: ${progress.answers[index]}. Jawaban benar: ${question.answer}`} — ${question.explanation}`));
      }
      form.append(field);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (progress.submitted || answered() !== progress.indices.length) return;
      progress.submitted = true;
      saveProgress();
      renderResult(true);
      announcement.textContent = `Kuis selesai. ${scoreFor(active)} dari ${progress.indices.length} jawaban benar.`;
    });
    if (!progress.submitted) form.append(submit);
    result.append(form);
    if (progress.submitted) {
      const actions = element('div', 'session-actions');
      const wrong = progress.indices.filter((i) => progress.answers[i] !== questions[i].answer);
      const start = (indices) => {
        active.progress = { indices, answers: {}, submitted: false };
        saveProgress();
        renderResult(true);
      };
      if (wrong.length) actions.append(button(`Ulangi ${wrong.length} soal yang salah`, () => start(wrong)));
      actions.append(button('Ulangi semua soal', () => start(allIndices(active)), true));
      result.append(actions);
    }
  };

  const renderFlashcards = () => {
    const { cards } = active.result;
    const progress = active.progress;
    const known = Object.values(progress.ratings).filter((rating) => rating === 'known').length;
    result.append(element('p', 'session-meta', `${known}/${cards.length} kartu dipahami`));
    if (progress.position === progress.queue.length) {
      result.append(element('div', 'score-box', 'Sesi kartu selesai'), element('p', 'session-hint', 'Kamu bisa mengulangi kartu yang belum dipahami atau memulai semua kartu lagi.'));
      const actions = element('div', 'session-actions');
      const review = allIndices(active).filter((i) => progress.ratings[i] === 'review');
      const start = (queue, reset = false) => {
        active.progress = { queue, position: 0, revealed: false, ratings: reset ? {} : { ...progress.ratings } };
        saveProgress();
        renderResult(true);
      };
      if (review.length) actions.append(button(`Ulangi ${review.length} kartu yang belum paham`, () => start(review)));
      actions.append(button('Ulangi semua kartu', () => start(allIndices(active), true), true));
      result.append(actions);
      return;
    }
    result.append(element('p', 'session-hint', `Kartu ${progress.position + 1} dari ${progress.queue.length}. Coba ingat jawabannya sebelum membukanya.`));
    const index = progress.queue[progress.position];
    const card = cards[index];
    const face = element('div', 'flashcard-face');
    face.append(element('p', 'section-kicker', 'PERTANYAAN'), element('p', 'flashcard-question', card.front));
    if (progress.revealed) {
      const back = element('div', 'flashcard-answer');
      back.append(element('p', 'section-kicker', 'JAWABAN'), element('p', '', card.back));
      face.append(back);
    }
    result.append(face);
    if (!progress.revealed) {
      const reveal = button('Buka jawaban', () => {
        progress.revealed = true;
        saveProgress();
        renderResult();
        result.querySelector('.rating-actions button')?.focus();
        announcement.textContent = 'Jawaban dibuka. Tandai apakah kamu sudah paham.';
      });
      result.append(reveal);
    } else {
      const actions = element('div', 'session-actions rating-actions');
      const rate = (rating) => {
        progress.ratings[index] = rating;
        progress.position++;
        progress.revealed = false;
        saveProgress();
        renderResult();
        (result.querySelector('.flashcard-question') || result.querySelector('.session-focus')).focus();
        announcement.textContent = progress.position === progress.queue.length ? 'Sesi kartu selesai.' : `Kartu ${progress.position + 1} dari ${progress.queue.length}.`;
      };
      actions.append(button('Belum paham', () => rate('review'), true), button('Sudah paham', () => rate('known')));
      result.append(actions);
    }
    const question = result.querySelector('.flashcard-question');
    question.tabIndex = -1;
  };

  const renderResult = (focus = false) => {
    result.className = 'result-content is-interactive';
    result.replaceChildren();
    badge.hidden = false;
    badge.textContent = labels[active.type];
    const heading = element('h3', 'session-title session-focus', active.title);
    heading.tabIndex = -1;
    result.append(heading);
    if (active.type === 'summary') result.append(element('div', 'summary-text', active.result));
    else if (active.type === 'quiz') renderQuiz();
    else renderFlashcards();
    if (focus) heading.focus();
  };

  window.StudyGenUI = {
    initialize(options) {
      restore = options.restore;
      document.getElementById('history-title').tabIndex = -1;
      records = loadHistory();
      renderHistory();
    },
    setBusy(value) {
      busy = value;
      historyList.querySelectorAll('button').forEach((node) => { node.disabled = value; });
    },
    showGenerated(data, content, options = {}) {
      const settings = settingsFor(options.settings);
      if (!Object.hasOwn(labels, data.type) || !validResult(data.type, data.result)) throw new Error('Format hasil AI tidak valid. Silakan coba lagi.');
      if (data.type !== 'summary') {
        const count = data.type === 'quiz' ? data.result.questions.length : data.result.cards.length;
        if (count !== settings.count) throw new Error('Jumlah hasil AI tidak sesuai dengan pilihan. Silakan coba lagi.');
      }
      active = {
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title: options.title?.trim().slice(0, 100) || content.replace(/\s+/g, ' ').slice(0, 70),
        createdAt: Date.now(), type: data.type, content, result: data.result, settings,
      };
      active.progress = normalizeProgress(active, null);
      records = [active, ...records].slice(0, MAX_RECORDS);
      persist();
      renderHistory();
      renderResult();
      announcement.textContent = `${labels[active.type]} siap dipelajari.`;
    },
  };
})();
