// Pure study logic shared by the UI and Node tests: answer checking,
// quiz scoring, SM-2 spaced repetition, and plain-text export.
(() => {
  const DAY = 24 * 60 * 60 * 1000;
  const typeLabels = { summary: 'Ringkasan', quiz: 'Kuis', flashcard: 'Flashcard' };

  const questionKind = (question) => (['truefalse', 'short', 'essay'].includes(question?.kind) ? question.kind : 'multiple');

  const normalizeAnswer = (value) => String(value ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

  const editDistance = (a, b) => {
    if (Math.abs(a.length - b.length) > 2) return 3;
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      for (let j = 1; j <= b.length; j++) {
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      previous = current;
    }
    return previous[b.length];
  };

  // Accepts exact matches, small typos, and answers that contain the key phrase.
  const checkShort = (answer, accepted) => {
    const given = normalizeAnswer(answer);
    if (!given) return false;
    return accepted.some((option) => {
      const key = normalizeAnswer(option);
      if (!key) return false;
      if (given === key) return true;
      if (key.length >= 4 && ` ${given} `.includes(` ${key} `)) return true;
      const allowed = key.length >= 10 ? 2 : key.length >= 5 ? 1 : 0;
      return allowed > 0 && editDistance(given, key) <= allowed;
    });
  };

  // Points earned for one question: 1 or 0, or a fraction for AI-graded essays.
  const pointsFor = (question, answer, grade) => {
    const kind = questionKind(question);
    if (answer === undefined || answer === null || answer === '') return 0;
    if (kind === 'multiple') return answer === question.answer ? 1 : 0;
    if (kind === 'truefalse') return answer === String(question.answer) ? 1 : 0;
    if (kind === 'short') return checkShort(answer, [question.answer, ...(question.alternatives || [])]) ? 1 : 0;
    return Number.isFinite(grade?.score) ? Math.max(0, Math.min(100, grade.score)) / 100 : 0;
  };
  const isCorrect = (question, answer, grade) => pointsFor(question, answer, grade) >= (questionKind(question) === 'essay' ? 0.6 : 1);

  const formatPoints = (value) => (Math.round(value * 10) / 10).toLocaleString('id-ID');

  const startOfDay = (time) => {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };

  // SM-2: quality 0-5. Below 3 means the card was forgotten and restarts tomorrow.
  const schedule = (previous, quality, now = Date.now()) => {
    let ef = Number.isFinite(previous?.ef) ? previous.ef : 2.5;
    let reps = Number.isInteger(previous?.reps) ? previous.reps : 0;
    let interval = Number.isInteger(previous?.interval) ? previous.interval : 0;
    if (quality < 3) {
      reps = 0;
      interval = 1;
    } else {
      interval = reps === 0 ? 1 : reps === 1 ? 6 : Math.round(interval * ef);
      reps += 1;
    }
    ef = Math.max(1.3, Math.min(3, ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))));
    interval = Math.min(3650, Math.max(1, interval));
    return { ef: Math.round(ef * 100) / 100, interval, reps, due: startOfDay(now) + interval * DAY };
  };
  const isDue = (state, now = Date.now()) => Boolean(state) && state.due <= now;

  const describeDue = (due, now = Date.now()) => {
    const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
    if (days <= 0) return 'hari ini';
    if (days === 1) return 'besok';
    if (days < 7) return `${days} hari lagi`;
    return new Date(due).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' });
  };

  const exportText = (record) => {
    const lines = [record.title, `${typeLabels[record.type]} · StudyGen · ${new Date(record.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}`];
    if (record.source?.type === 'pdf') lines.push(`Sumber: ${record.source.name} (${record.source.pages} halaman)`);
    if (record.source?.type === 'url') lines.push(`Sumber: ${record.source.name} — ${record.source.url}`);
    lines.push('');
    if (record.type === 'summary') lines.push(record.result);
    else if (record.type === 'flashcard') {
      record.result.cards.forEach((card, i) => lines.push(`${i + 1}. ${card.front}`, `   Jawaban: ${card.back}`, ''));
    } else {
      const questions = record.result.questions;
      questions.forEach((question, i) => {
        const kind = questionKind(question);
        lines.push(`${i + 1}. ${kind === 'truefalse' ? `Benar atau salah: ${question.question}` : question.question}`);
        if (kind === 'multiple') ['A', 'B', 'C', 'D'].forEach((letter) => lines.push(`   ${letter}. ${question.options[letter]}`));
        if (kind === 'short') lines.push('   Jawaban: ____________');
        if (kind === 'essay') lines.push('   (Jawab dalam bentuk uraian)');
        lines.push('');
      });
      lines.push('KUNCI JAWABAN', '');
      questions.forEach((question, i) => {
        const kind = questionKind(question);
        const key = kind === 'multiple' ? `${question.answer}. ${question.options[question.answer]}`
          : kind === 'truefalse' ? (question.answer ? 'Benar' : 'Salah')
            : kind === 'short' ? [question.answer, ...(question.alternatives || [])].join(' / ')
              : question.answer;
        lines.push(`${i + 1}. ${key}`, `   ${question.explanation}`, '');
      });
    }
    return `${lines.join('\n').trim()}\n`;
  };

  const api = { questionKind, normalizeAnswer, checkShort, pointsFor, isCorrect, formatPoints, schedule, isDue, describeDue, startOfDay, exportText, DAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.StudyGenCore = api;
})();
