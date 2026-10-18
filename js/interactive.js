(() => {
  'use strict';
  const STORAGE_KEY = 'studygen.history.v1';
  const MAX_RECORDS = 30;
  const MAX_CHAT = 30;
  const MAX_ATTEMPTS = 50;
  const core = window.StudyGenCore;
  const api = window.StudyGenAPI;
  const labels = { summary: 'Ringkasan', quiz: 'Kuis', flashcard: 'Flashcard' };
  const kindLabels = { multiple: 'Pilihan ganda', truefalse: 'Benar/Salah', short: 'Isian singkat', essay: 'Esai' };
  const $ = (id) => document.getElementById(id);
  const result = $('result-content');
  const badge = $('result-badge');
  const announcement = $('result-announcement');
  const historyList = $('history-list');
  const historyMessage = $('history-message');
  const toolbar = $('result-toolbar');
  const chatPanel = $('chat-panel');
  const chatLog = $('chat-log');
  const chatForm = $('chat-form');
  const chatInput = $('chat-input');
  const chatSend = $('chat-send');
  const chatMessage = $('chat-message');
  const chatClear = $('chat-clear');
  const printArea = $('print-area');
  let records = [];
  let active = null;
  let restore = () => {};
  let busy = false;
  let editing = false;
  let chatBusy = false;

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
  const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validText = (value, max = 2000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  const settingsFor = (value = {}) => ({
    count: [5, 10, 15].includes(value?.count) ? value.count : 5,
    difficulty: ['easy', 'medium', 'hard'].includes(value?.difficulty) ? value.difficulty : 'medium',
    summaryLength: ['short', 'medium', 'long'].includes(value?.summaryLength) ? value.summaryLength : 'medium',
    language: ['id', 'en'].includes(value?.language) ? value.language : 'id',
    questionType: ['multiple', 'truefalse', 'short', 'essay', 'mixed'].includes(value?.questionType) ? value.questionType : 'multiple',
  });
  const validQuestion = (item) => {
    if (!validText(item?.question) || !validText(item?.explanation)) return false;
    if (item.kind !== undefined && !['multiple', 'truefalse', 'short', 'essay'].includes(item.kind)) return false;
    const kind = core.questionKind(item);
    if (kind === 'multiple') {
      return ['A', 'B', 'C', 'D'].includes(item.answer) && ['A', 'B', 'C', 'D'].every((letter) => validText(item?.options?.[letter]))
        && new Set(['A', 'B', 'C', 'D'].map((letter) => item.options[letter].trim())).size === 4;
    }
    if (kind === 'truefalse') return typeof item.answer === 'boolean';
    if (kind === 'short') return validText(item.answer, 200) && (item.alternatives === undefined
      || (Array.isArray(item.alternatives) && item.alternatives.length <= 5 && item.alternatives.every((value) => validText(value, 200))));
    return validText(item.answer);
  };
  const validResult = (type, value) => {
    if (type === 'summary') return validText(value, 60000);
    const items = type === 'quiz' ? value?.questions : value?.cards;
    if (!Array.isArray(items) || ![5, 10, 15].includes(items.length)) return false;
    return items.every((item) => (type === 'quiz' ? validQuestion(item) : validText(item?.front) && validText(item?.back)));
  };
  const allIndices = (record) => Array.from({ length: record.type === 'quiz' ? record.result.questions.length : record.result.cards.length }, (_, i) => i);
  const validAnswer = (question, value) => {
    const kind = core.questionKind(question);
    if (kind === 'multiple') return ['A', 'B', 'C', 'D'].includes(value);
    if (kind === 'truefalse') return value === 'true' || value === 'false';
    return validText(value, kind === 'short' ? 500 : 2000);
  };
  const validGrade = (grade) => Number.isInteger(grade?.score) && grade.score >= 0 && grade.score <= 100 && validText(grade?.feedback);
  const normalizeProgress = (record, saved) => {
    if (record.type === 'summary') return null;
    const all = allIndices(record);
    const indices = (value) => (Array.isArray(value) && value.length > 0 && value.length <= all.length
      && value.every((i) => Number.isInteger(i) && all.includes(i)) && new Set(value).size === value.length ? value : all);
    if (record.type === 'quiz') {
      const { questions } = record.result;
      const selected = indices(saved?.indices);
      const answers = {};
      const grades = {};
      selected.forEach((i) => {
        if (validAnswer(questions[i], saved?.answers?.[i])) answers[i] = saved.answers[i];
        if (core.questionKind(questions[i]) === 'essay' && answers[i] && validGrade(saved?.grades?.[i])) grades[i] = saved.grades[i];
      });
      const complete = selected.every((i) => answers[i] && (core.questionKind(questions[i]) !== 'essay' || grades[i]));
      return { indices: selected, answers, grades, submitted: saved?.submitted === true && complete };
    }
    const queue = indices(saved?.queue);
    const ratings = {};
    all.forEach((i) => { if (['known', 'review'].includes(saved?.ratings?.[i])) ratings[i] = saved.ratings[i]; });
    const position = Number.isInteger(saved?.position) && saved.position >= 0 && saved.position <= queue.length
      && queue.slice(0, saved.position).every((i) => ratings[i]) ? saved.position : 0;
    return { queue, position, ratings, revealed: saved?.revealed === true };
  };
  // Optional data (chat, scores, mistakes, review schedule) is cleaned instead of rejecting the record.
  const normalizeExtras = (record) => {
    const extras = {};
    const indexCount = record.type === 'summary' ? 0 : allIndices(record).length;
    const validIndex = (key) => /^\d+$/.test(key) && Number(key) < indexCount;
    if (Array.isArray(record.chat)) {
      extras.chat = record.chat.filter((item) => ['user', 'assistant'].includes(item?.role) && validText(item?.content, 6000))
        .map(({ role, content }) => ({ role, content })).slice(-MAX_CHAT);
    }
    if (record.type === 'quiz') {
      extras.attempts = Array.isArray(record.attempts) ? record.attempts.filter((item) => Number.isFinite(item?.at) && item.at > 0
        && Number.isInteger(item?.total) && item.total >= 1 && item.total <= 15 && Number.isFinite(item?.score) && item.score >= 0 && item.score <= item.total)
        .map(({ at, score, total }) => ({ at, score, total })).slice(-MAX_ATTEMPTS) : [];
      extras.mistakes = {};
      if (isPlainObject(record.mistakes)) {
        Object.entries(record.mistakes).forEach(([key, count]) => { if (validIndex(key) && Number.isInteger(count) && count > 0) extras.mistakes[key] = Math.min(count, 999); });
      }
    }
    if (record.type === 'flashcard') {
      extras.srs = {};
      if (isPlainObject(record.srs)) {
        Object.entries(record.srs).forEach(([key, state]) => {
          if (validIndex(key) && Number.isFinite(state?.ef) && state.ef >= 1.3 && state.ef <= 3 && Number.isInteger(state?.interval) && state.interval >= 1
            && state.interval <= 3650 && Number.isInteger(state?.reps) && state.reps >= 0 && Number.isFinite(state?.due) && state.due > 0) {
            extras.srs[key] = { ef: state.ef, interval: state.interval, reps: state.reps, due: state.due };
          }
        });
      }
    }
    return extras;
  };
  const validSource = (source) => source === undefined
    || (source?.type === 'pdf' && validText(source.name, 255) && Number.isInteger(source.pages) && source.pages >= 1 && source.pages <= 500)
    || (source?.type === 'url' && validText(source.name, 255) && validText(source.url, 2048) && /^https?:\/\//.test(source.url) && ['article', 'youtube'].includes(source.kind));
  const validRecord = (record) => record && validText(record.id, 100) && validText(record.title, 100) && validSource(record.source)
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
      return valid.map((record) => {
        const { chat, attempts, mistakes, srs, ...base } = record;
        return { ...base, settings: settingsFor(record.settings), progress: normalizeProgress(record, record.progress), ...normalizeExtras(record) };
      });
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
  const renderStats = () => window.StudyGenStats?.render(records, { open: openRecord });
  const saveRecord = (record) => {
    // Deleting a record must not resurrect it when the current exercise changes.
    if (records.includes(record)) persist();
    renderHistory();
    renderStats();
  };
  const saveProgress = () => saveRecord(active);

  const quizPoints = (record) => record.progress.indices.reduce((sum, i) => sum
    + core.pointsFor(record.result.questions[i], record.progress.answers[i], record.progress.grades[i]), 0);
  const dueCards = (record, now = Date.now()) => (record.type === 'flashcard'
    ? allIndices(record).filter((i) => core.isDue(record.srs?.[i], now)) : []);
  const historyStatus = (record) => {
    if (record.type === 'summary') return 'Siap dibaca';
    const progress = record.progress;
    if (record.type === 'quiz') return progress.submitted
      ? `Skor terakhir: ${core.formatPoints(quizPoints(record))}/${progress.indices.length}`
      : `${Object.keys(progress.answers).length}/${progress.indices.length} soal dijawab`;
    const due = dueCards(record).length;
    return `${Object.values(progress.ratings).filter((rating) => rating === 'known').length}/${record.result.cards.length} kartu dipahami${due ? ` · ${due} perlu diulang hari ini` : ''}`;
  };
  const openRecord = (record) => {
    if (busy) return;
    active = record;
    editing = false;
    restore(record);
    renderResult(true);
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      const kind = record.type === 'quiz' && record.settings.questionType !== 'multiple'
        ? ` (${record.settings.questionType === 'mixed' ? 'Campuran' : kindLabels[record.settings.questionType]})` : '';
      copy.append(element('p', 'history-meta', `${labels[record.type]}${kind} · ${date}`), element('p', 'history-progress', historyStatus(record)));
      const actions = element('div', 'session-actions');
      const open = button('Buka', () => openRecord(record));
      open.setAttribute('aria-label', `Buka ${record.title}, ${labels[record.type]}`);
      const remove = button('Hapus', () => {
        if (busy) return;
        records = records.filter((item) => item.id !== record.id);
        persist();
        renderHistory();
        renderStats();
        const next = historyList.querySelector('button');
        if (next) next.focus();
        else $('history-title').focus();
        announcement.textContent = `${record.title} dihapus dari riwayat.`;
      }, true);
      remove.setAttribute('aria-label', `Hapus ${record.title} dari riwayat`);
      open.disabled = remove.disabled = busy;
      actions.append(open, remove);
      row.append(copy, actions);
      historyList.append(row);
    });
  };

  const feedbackFor = (question, answer, grade) => {
    const kind = core.questionKind(question);
    const correct = core.isCorrect(question, answer, grade);
    if (kind === 'essay') return `Nilai esai: ${grade.score}/100 — ${grade.feedback} Poin jawaban ideal: ${question.answer}`;
    if (correct) return `Benar — ${question.explanation}`;
    if (kind === 'multiple') return `Jawabanmu: ${answer}. Jawaban benar: ${question.answer} — ${question.explanation}`;
    if (kind === 'truefalse') return `Jawabanmu: ${answer === 'true' ? 'Benar' : 'Salah'}. Jawaban benar: ${question.answer ? 'Benar' : 'Salah'} — ${question.explanation}`;
    return `Jawabanmu: ${answer}. Jawaban yang diharapkan: ${question.answer} — ${question.explanation}`;
  };

  const renderQuiz = () => {
    const record = active;
    const { questions } = record.result;
    const progress = record.progress;
    const answered = () => progress.indices.filter((i) => progress.answers[i]).length;
    const status = element('p', 'session-meta');
    const updateStatus = () => { status.textContent = `${answered()}/${progress.indices.length} soal dijawab${progress.indices.length < questions.length ? ' · Latihan ulang' : ''}`; };
    updateStatus();
    result.append(status);
    if (progress.submitted) {
      const points = quizPoints(record);
      result.append(element('div', 'score-box', `Skor: ${Math.round(points / progress.indices.length * 100)} · ${core.formatPoints(points)}/${progress.indices.length} benar`));
    } else {
      const hasEssay = progress.indices.some((i) => core.questionKind(questions[i]) === 'essay');
      result.append(element('p', 'session-hint', `Jawab semua soal, lalu periksa hasil untuk melihat pembahasan.${hasEssay ? ' Jawaban esai dinilai oleh AI berdasarkan materi.' : ''}`));
    }
    const form = element('form', 'quiz-form');
    const quizMessage = element('p', 'form-message');
    quizMessage.hidden = true;
    quizMessage.setAttribute('role', 'alert');
    const submit = button('Periksa jawaban', () => {});
    submit.type = 'submit';
    submit.disabled = answered() !== progress.indices.length;
    let saveTimer;
    const setAnswer = (index, value, persistNow = true) => {
      if (value) progress.answers[index] = value;
      else delete progress.answers[index];
      delete progress.grades[index];
      updateStatus();
      submit.disabled = answered() !== progress.indices.length;
      clearTimeout(saveTimer);
      if (persistNow) saveProgress();
      else saveTimer = setTimeout(() => saveRecord(record), 500);
    };
    progress.indices.forEach((index, order) => {
      const question = questions[index];
      const kind = core.questionKind(question);
      const field = element('fieldset', 'quiz-question');
      const legend = element('legend', '', `${order + 1}. ${kind === 'truefalse' ? `Benar atau salah: ${question.question}` : question.question}`);
      field.append(legend);
      if (record.settings.questionType === 'mixed' || kind !== 'multiple') field.append(element('span', 'question-kind', kindLabels[kind]));
      if (kind === 'multiple' || kind === 'truefalse') {
        const choices = kind === 'multiple' ? ['A', 'B', 'C', 'D'].map((letter) => [letter, `${letter}. ${question.options[letter]}`]) : [['true', 'Benar'], ['false', 'Salah']];
        const correctValue = kind === 'multiple' ? question.answer : String(question.answer);
        const group = element('div', kind === 'truefalse' ? 'truefalse-options' : '');
        choices.forEach(([value, text]) => {
          const option = element('label', 'quiz-option');
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = `question-${index}`;
          input.value = value;
          input.checked = progress.answers[index] === value;
          input.disabled = progress.submitted;
          if (progress.submitted && value === correctValue) option.classList.add('is-correct');
          if (progress.submitted && input.checked && value !== correctValue) option.classList.add('is-incorrect');
          input.addEventListener('change', () => setAnswer(index, value));
          option.append(input, element('span', '', text));
          group.append(option);
        });
        field.append(group);
      } else {
        const id = `answer-${index}`;
        const label = element('label', 'sr-only', `Jawaban soal ${order + 1}`);
        label.htmlFor = id;
        const input = document.createElement(kind === 'essay' ? 'textarea' : 'input');
        input.id = id;
        input.className = kind === 'essay' ? 'answer-input essay-input' : 'answer-input text-input';
        if (kind === 'short') input.type = 'text';
        input.maxLength = kind === 'essay' ? 2000 : 500;
        input.placeholder = kind === 'essay' ? 'Tulis jawabanmu dengan kalimat sendiri...' : 'Jawaban singkat';
        input.value = progress.answers[index] || '';
        input.disabled = progress.submitted;
        if (progress.submitted) input.classList.add(core.isCorrect(question, progress.answers[index], progress.grades[index]) ? 'is-correct' : 'is-incorrect');
        input.addEventListener('input', () => setAnswer(index, input.value.trim() ? input.value : '', false));
        input.addEventListener('change', () => { clearTimeout(saveTimer); saveRecord(record); });
        field.append(label, input);
      }
      if (progress.submitted) {
        const correct = core.isCorrect(question, progress.answers[index], progress.grades[index]);
        field.append(element('p', correct ? 'answer-feedback correct' : 'answer-feedback incorrect', feedbackFor(question, progress.answers[index], progress.grades[index])));
      }
      form.append(field);
    });
    const finish = () => {
      progress.submitted = true;
      const points = quizPoints(record);
      record.attempts = [...(record.attempts || []), { at: Date.now(), score: Math.round(points * 10) / 10, total: progress.indices.length }].slice(-MAX_ATTEMPTS);
      record.mistakes ||= {};
      progress.indices.forEach((i) => {
        if (!core.isCorrect(questions[i], progress.answers[i], progress.grades[i])) record.mistakes[i] = Math.min(999, (record.mistakes[i] || 0) + 1);
      });
      saveRecord(record);
      if (active === record && !editing) {
        renderResult(true);
        announcement.textContent = `Kuis selesai. ${core.formatPoints(points)} dari ${progress.indices.length} jawaban benar.`;
      }
    };
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (progress.submitted || submit.disabled || answered() !== progress.indices.length) return;
      const ungraded = progress.indices.filter((i) => core.questionKind(questions[i]) === 'essay' && !progress.grades[i]);
      if (!ungraded.length) return finish();
      form.querySelectorAll('input, textarea').forEach((input) => { input.disabled = true; });
      submit.disabled = true;
      quizMessage.hidden = true;
      try {
        for (let n = 0; n < ungraded.length; n++) {
          const i = ungraded[n];
          submit.textContent = `Menilai esai ${n + 1} dari ${ungraded.length}...`;
          const data = await api.request({
            task: 'grade', content: record.content, question: questions[i].question, reference: questions[i].answer,
            answer: progress.answers[i].trim(), settings: { language: record.settings.language },
          }, { onWait: (seconds) => { submit.textContent = `AI sibuk, mencoba lagi dalam ${seconds} detik...`; } });
          if (!validGrade(data.result)) throw new Error('Penilaian esai dari AI tidak valid. Silakan coba lagi.');
          progress.grades[i] = { score: data.result.score, feedback: data.result.feedback };
        }
        finish();
      } catch (error) {
        form.querySelectorAll('input, textarea').forEach((input) => { input.disabled = false; });
        submit.disabled = false;
        submit.textContent = 'Periksa jawaban';
        quizMessage.textContent = `${error.message || 'Penilaian esai gagal.'} Jawabanmu tetap tersimpan.`;
        quizMessage.hidden = false;
        saveRecord(record);
      }
    });
    if (!progress.submitted) form.append(submit, quizMessage);
    result.append(form);
    if (progress.submitted) {
      const actions = element('div', 'session-actions');
      const wrong = progress.indices.filter((i) => !core.isCorrect(questions[i], progress.answers[i], progress.grades[i]));
      const start = (indices) => {
        record.progress = { indices, answers: {}, grades: {}, submitted: false };
        saveProgress();
        renderResult(true);
      };
      if (wrong.length) actions.append(button(`Ulangi ${wrong.length} soal yang salah`, () => start(wrong)));
      actions.append(button('Ulangi semua soal', () => start(allIndices(record)), true));
      result.append(actions);
    }
  };

  const renderFlashcards = () => {
    const record = active;
    const { cards } = record.result;
    const progress = record.progress;
    const known = Object.values(progress.ratings).filter((rating) => rating === 'known').length;
    const due = dueCards(record);
    result.append(element('p', 'session-meta', `${known}/${cards.length} kartu dipahami`));
    const start = (queue, reset = false) => {
      record.progress = { queue, position: 0, revealed: false, ratings: reset ? {} : { ...progress.ratings } };
      saveProgress();
      renderResult(true);
    };
    if (progress.position === progress.queue.length) {
      result.append(element('div', 'score-box', 'Sesi kartu selesai'));
      const scheduled = Object.values(record.srs || {}).map((state) => state.due).filter((time) => time > Date.now());
      const next = scheduled.length ? Math.min(...scheduled) : null;
      result.append(element('p', 'session-hint', due.length
        ? `${due.length} kartu sudah waktunya diulang hari ini. Mengulang tepat waktu membantu ingatan bertahan lebih lama.`
        : `Kamu bisa mengulangi kartu yang belum dipahami atau memulai semua kartu lagi.${next ? ` Jadwal ulang berikutnya: ${core.describeDue(next)}.` : ''}`));
      const actions = element('div', 'session-actions');
      const review = allIndices(record).filter((i) => progress.ratings[i] === 'review');
      if (due.length) actions.append(button(`Ulangi ${due.length} kartu jatuh tempo`, () => start(due)));
      if (review.length) actions.append(button(`Ulangi ${review.length} kartu yang belum paham`, () => start(review), due.length > 0));
      actions.append(button('Ulangi semua kartu', () => start(allIndices(record), true), true));
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
      result.append(button('Buka jawaban', () => {
        progress.revealed = true;
        saveProgress();
        renderResult();
        result.querySelector('.rating-actions button')?.focus();
        announcement.textContent = 'Jawaban dibuka. Tandai seberapa baik kamu mengingatnya.';
      }));
    } else {
      const actions = element('div', 'session-actions rating-actions');
      // Quality follows SM-2: 1 = forgot, 3 = remembered with effort, 4 = remembered well.
      const rate = (rating, quality) => {
        progress.ratings[index] = rating;
        record.srs = { ...(record.srs || {}), [index]: core.schedule(record.srs?.[index], quality) };
        progress.position++;
        progress.revealed = false;
        saveProgress();
        renderResult();
        (result.querySelector('.flashcard-question') || result.querySelector('.session-focus')).focus();
        announcement.textContent = progress.position === progress.queue.length ? 'Sesi kartu selesai.' : `Kartu ${progress.position + 1} dari ${progress.queue.length}.`;
      };
      actions.append(button('Belum paham', () => rate('review', 1), true), button('Ragu-ragu', () => rate('known', 3), true), button('Sudah paham', () => rate('known', 4)));
      result.append(actions, element('p', 'session-hint rating-hint', 'Belum paham: diulang besok. Ragu-ragu dan Sudah paham: dijadwalkan makin jarang sesuai daya ingatmu.'));
    }
    result.querySelector('.flashcard-question').tabIndex = -1;
  };

  // Editing lets users fix AI mistakes before studying from them.
  const field = (labelText, value, { multiline = false, max = 2000, rows = 3 } = {}) => {
    const wrapper = element('label', 'edit-field');
    wrapper.append(element('span', 'field-label', labelText));
    const input = document.createElement(multiline ? 'textarea' : 'input');
    input.className = multiline ? 'edit-textarea' : 'text-input';
    if (multiline) input.rows = rows;
    input.maxLength = max;
    input.value = value;
    wrapper.append(input);
    return [wrapper, input];
  };
  const select = (labelText, options, value) => {
    const wrapper = element('label', 'edit-field');
    wrapper.append(element('span', 'field-label', labelText));
    const input = document.createElement('select');
    options.forEach(([optionValue, text]) => {
      const option = element('option', '', text);
      option.value = optionValue;
      input.append(option);
    });
    input.value = value;
    wrapper.append(input);
    return [wrapper, input];
  };
  const renderEditor = () => {
    const record = active;
    const form = element('form', 'edit-form');
    form.append(element('p', 'session-hint', record.type === 'quiz'
      ? 'Perbaiki soal yang kurang tepat. Menyimpan perubahan akan mengulang progres kuis ini.'
      : 'Perbaiki isi yang kurang tepat. Semua kolom wajib diisi (maksimal 2.000 karakter).'));
    const [titleField, titleInput] = field('Judul', record.title, { max: 100 });
    form.append(titleField);
    let collect;
    if (record.type === 'summary') {
      const [summaryField, summaryInput] = field('Ringkasan', record.result, { multiline: true, max: 60000, rows: 16 });
      form.append(summaryField);
      collect = () => summaryInput.value.trim();
    } else if (record.type === 'flashcard') {
      const inputs = record.result.cards.map((card, i) => {
        const group = element('fieldset', 'edit-group');
        group.append(element('legend', '', `Kartu ${i + 1}`));
        const [frontField, front] = field('Pertanyaan', card.front, { multiline: true, rows: 2 });
        const [backField, back] = field('Jawaban', card.back, { multiline: true, rows: 3 });
        group.append(frontField, backField);
        form.append(group);
        return { front, back };
      });
      collect = () => ({ cards: inputs.map(({ front, back }) => ({ front: front.value.trim(), back: back.value.trim() })) });
    } else {
      const inputs = record.result.questions.map((question, i) => {
        const kind = core.questionKind(question);
        const group = element('fieldset', 'edit-group');
        group.append(element('legend', '', `Soal ${i + 1} · ${kindLabels[kind]}`));
        const [questionField, questionInput] = field(kind === 'truefalse' ? 'Pernyataan' : 'Pertanyaan', question.question, { multiline: true, rows: 2 });
        group.append(questionField);
        const parts = { kind, question: questionInput };
        if (kind === 'multiple') {
          parts.options = {};
          ['A', 'B', 'C', 'D'].forEach((letter) => {
            const [optionField, optionInput] = field(`Pilihan ${letter}`, question.options[letter]);
            parts.options[letter] = optionInput;
            group.append(optionField);
          });
          const [answerField, answerInput] = select('Jawaban benar', ['A', 'B', 'C', 'D'].map((letter) => [letter, letter]), question.answer);
          parts.answer = answerInput;
          group.append(answerField);
        } else if (kind === 'truefalse') {
          const [answerField, answerInput] = select('Pernyataan ini', [['true', 'Benar'], ['false', 'Salah']], String(question.answer));
          parts.answer = answerInput;
          group.append(answerField);
        } else {
          const [answerField, answerInput] = field(kind === 'short' ? 'Jawaban benar' : 'Poin jawaban ideal', question.answer, { multiline: kind === 'essay', max: kind === 'short' ? 200 : 2000 });
          parts.answer = answerInput;
          group.append(answerField);
          if (kind === 'short') {
            const [altField, altInput] = field('Jawaban lain yang diterima (satu per baris, opsional)', (question.alternatives || []).join('\n'), { multiline: true, rows: 2, max: 1100 });
            parts.alternatives = altInput;
            group.append(altField);
          }
        }
        const [explanationField, explanationInput] = field(kind === 'essay' ? 'Kriteria penilaian' : 'Pembahasan', question.explanation, { multiline: true, rows: 2 });
        parts.explanation = explanationInput;
        group.append(explanationField);
        form.append(group);
        return parts;
      });
      collect = () => ({ questions: inputs.map((parts) => {
        const base = { question: parts.question.value.trim(), explanation: parts.explanation.value.trim() };
        if (parts.kind === 'multiple') {
          return { question: base.question, options: Object.fromEntries(Object.entries(parts.options).map(([letter, input]) => [letter, input.value.trim()])), answer: parts.answer.value, explanation: base.explanation };
        }
        if (parts.kind === 'truefalse') return { kind: 'truefalse', ...base, answer: parts.answer.value === 'true' };
        if (parts.kind === 'short') {
          const alternatives = [...new Set(parts.alternatives.value.split('\n').map((line) => line.trim()).filter(Boolean))].slice(0, 5);
          return { kind: 'short', question: base.question, answer: parts.answer.value.trim(), alternatives, explanation: base.explanation };
        }
        return { kind: 'essay', question: base.question, answer: parts.answer.value.trim(), explanation: base.explanation };
      }) });
    }
    const error = element('p', 'form-message');
    error.hidden = true;
    error.setAttribute('role', 'alert');
    const actions = element('div', 'session-actions edit-actions');
    const save = element('button', 'action-button', 'Simpan perubahan');
    save.type = 'submit';
    actions.append(save, button('Batal', () => { editing = false; renderResult(true); }, true));
    form.append(error, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const title = titleInput.value.trim();
      const next = collect();
      if (!validText(title, 100) || !validResult(record.type, next)) {
        error.textContent = record.type === 'quiz'
          ? 'Periksa kembali: semua kolom wajib diisi, maksimal 2.000 karakter, dan keempat pilihan jawaban tidak boleh sama.'
          : 'Periksa kembali: semua kolom wajib diisi dan tidak melebihi batas karakter.';
        error.hidden = false;
        error.focus?.();
        return;
      }
      record.title = title;
      record.result = next;
      if (record.type === 'quiz') {
        record.progress = normalizeProgress(record, null);
        record.mistakes = {};
      }
      editing = false;
      saveRecord(record);
      renderResult(true);
      announcement.textContent = record.type === 'quiz' ? 'Perubahan disimpan. Progres kuis diulang dari awal.' : 'Perubahan disimpan.';
    });
    result.append(form);
    titleInput.focus();
  };

  // Export: copy, download as text, or print (the browser can save the print as PDF).
  const fileName = (record) => `${record.title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'studygen'}-${record.type}.txt`;
  const flash = (node, text) => {
    const original = node.dataset.label || node.textContent;
    node.dataset.label = original;
    node.textContent = text;
    clearTimeout(node.flashTimer);
    node.flashTimer = setTimeout(() => { node.textContent = original; }, 2000);
  };
  $('export-copy').addEventListener('click', async () => {
    const copyButton = $('export-copy');
    if (!active) return;
    const text = core.exportText(active);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = element('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      if (!copied) { flash(copyButton, 'Gagal menyalin'); return; }
    }
    flash(copyButton, 'Tersalin ✓');
    announcement.textContent = 'Hasil disalin ke clipboard.';
  });
  $('export-download').addEventListener('click', () => {
    if (!active) return;
    const url = URL.createObjectURL(new Blob(['﻿', core.exportText(active)], { type: 'text/plain;charset=utf-8' }));
    const link = element('a');
    link.href = url;
    link.download = fileName(active);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announcement.textContent = 'File hasil sedang diunduh.';
  });
  $('export-print').addEventListener('click', () => {
    if (!active) return;
    const [title, meta, ...rest] = core.exportText(active).split('\n');
    printArea.replaceChildren(element('h1', '', title), element('p', 'print-meta', meta), element('div', 'print-body', rest.join('\n').trim()));
    window.print();
  });
  $('export-edit').addEventListener('click', () => {
    if (!active || busy) return;
    editing = true;
    renderResult();
  });

  // Questions about the material, answered only from the saved material.
  const renderChat = () => {
    chatPanel.hidden = !active || editing;
    if (!active) return;
    const messages = active.chat || [];
    chatLog.replaceChildren();
    if (!messages.length) chatLog.append(element('p', 'chat-empty', 'Tanyakan bagian yang belum jelas. StudyGen menjawab hanya berdasarkan materi ini.'));
    messages.forEach((item) => {
      const bubble = element('div', `chat-bubble ${item.role}`);
      bubble.append(element('span', 'chat-role', item.role === 'user' ? 'Kamu' : 'StudyGen'), element('p', '', item.content));
      chatLog.append(bubble);
    });
    if (chatBusy && chatBusy === active) chatLog.append(element('p', 'chat-typing', 'StudyGen sedang menjawab...'));
    chatClear.hidden = !messages.length;
    chatInput.disabled = chatSend.disabled = Boolean(chatBusy);
    chatLog.scrollTop = chatLog.scrollHeight;
  };
  const showChatMessage = (text = '') => {
    chatMessage.textContent = text;
    chatMessage.hidden = !text;
  };
  chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = chatInput.value.trim();
    if (!active || chatBusy) return;
    if (question.length < 2) return showChatMessage('Tulis pertanyaanmu terlebih dahulu.');
    const record = active;
    record.chat = [...(record.chat || []), { role: 'user', content: question }];
    chatInput.value = '';
    chatBusy = record;
    showChatMessage();
    renderChat();
    try {
      const data = await api.request({
        task: 'chat', content: record.content, settings: { language: record.settings.language },
        messages: record.chat.slice(-10).map(({ role, content }) => ({ role, content: content.slice(0, 2000) })),
      }, { onWait: (seconds) => showChatMessage(`Layanan AI sibuk, mencoba lagi dalam ${seconds} detik...`) });
      if (!validText(data.result, 6000)) throw new Error('Jawaban AI tidak valid. Silakan coba lagi.');
      record.chat = [...record.chat, { role: 'assistant', content: data.result }].slice(-MAX_CHAT);
      showChatMessage();
      saveRecord(record);
    } catch (error) {
      record.chat = record.chat.slice(0, -1);
      if (active === record) chatInput.value = question;
      showChatMessage(error.message || 'Pertanyaan gagal dikirim.');
    } finally {
      chatBusy = false;
      renderChat();
      if (active === record) chatInput.focus();
    }
  });
  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      chatForm.requestSubmit();
    }
  });
  chatClear.addEventListener('click', () => {
    if (!active || chatBusy) return;
    active.chat = [];
    saveRecord(active);
    renderChat();
    chatInput.focus();
  });

  const renderResult = (focus = false) => {
    result.className = 'result-content is-interactive';
    result.replaceChildren();
    badge.hidden = false;
    badge.textContent = labels[active.type];
    toolbar.hidden = editing;
    showChatMessage();
    if (editing) {
      result.append(element('h3', 'session-title', `Edit ${labels[active.type].toLowerCase()}`));
      renderEditor();
      renderChat();
      return;
    }
    const heading = element('h3', 'session-title session-focus', active.title);
    heading.tabIndex = -1;
    result.append(heading);
    if (active.source) result.append(element('p', 'session-source', active.source.type === 'pdf' ? `Sumber: ${active.source.name}` : `Sumber: ${active.source.name} (${active.source.kind === 'youtube' ? 'YouTube' : 'artikel'})`));
    if (active.type === 'summary') result.append(element('div', 'summary-text', active.result));
    else if (active.type === 'quiz') renderQuiz();
    else renderFlashcards();
    renderChat();
    if (focus) heading.focus();
  };

  window.StudyGenUI = {
    initialize(options) {
      restore = options.restore;
      $('history-title').tabIndex = -1;
      records = loadHistory();
      renderHistory();
      renderStats();
    },
    setBusy(value) {
      busy = value;
      historyList.querySelectorAll('button').forEach((node) => { node.disabled = value; });
      $('export-edit').disabled = value;
      window.StudyGenStats?.setBusy?.(value);
    },
    clear() {
      active = null;
      editing = false;
      toolbar.hidden = true;
      chatPanel.hidden = true;
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
        ...(options.source ? { source: options.source } : {}),
      };
      active.progress = normalizeProgress(active, null);
      Object.assign(active, normalizeExtras(active));
      editing = false;
      records = [active, ...records].slice(0, MAX_RECORDS);
      persist();
      renderHistory();
      renderStats();
      renderResult();
      announcement.textContent = `${labels[active.type]} siap dipelajari.`;
    },
  };
})();
