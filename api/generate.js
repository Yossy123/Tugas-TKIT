// Vercel backend. The PHP endpoint is retained for local XAMPP installations.
const letters = ['A', 'B', 'C', 'D'];
const fallbackError = 'Gagal menghasilkan materi. Silakan coba lagi.';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const textLength = (value) => Array.from(value).length;
const validText = (value) => typeof value === 'string' && value.trim() !== '' && textLength(value) <= 2000;

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const respond = (status, success, payload) => res.status(status).json({ success, ...payload });
  const fail = (status, error) => respond(status, false, { error });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(405, 'Method tidak diizinkan.');
  }

  let input = req.body;
  try {
    if (typeof input === 'string' || Buffer.isBuffer(input)) input = JSON.parse(input.toString());
  } catch {
    return fail(400, 'Request tidak valid.');
  }
  if (!isObject(input)) return fail(400, 'Request tidak valid.');
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  const type = input.type;
  if (!content) return fail(422, 'Materi tidak boleh kosong.');
  if (!['summary', 'quiz', 'flashcard'].includes(type)) return fail(422, 'Jenis generate tidak valid.');
  if (textLength(content) < 20) return fail(422, 'Materi terlalu pendek. Masukkan minimal 20 karakter.');
  if (textLength(content) > 15000) return fail(422, 'Materi terlalu panjang. Maksimal 15.000 karakter.');
  const settings = input.settings ?? {};
  if (!isObject(settings)) return fail(422, 'Pengaturan tidak valid.');
  const count = settings.count ?? 5;
  const difficulty = settings.difficulty ?? 'medium';
  const summaryLength = settings.summaryLength ?? 'medium';
  if (!Number.isInteger(count) || ![5, 10, 15].includes(count)) return fail(422, 'Jumlah soal atau kartu harus 5, 10, atau 15.');
  if (!['easy', 'medium', 'hard'].includes(difficulty)) return fail(422, 'Kesulitan kuis tidak valid.');
  if (!['short', 'medium', 'long'].includes(summaryLength)) return fail(422, 'Panjang ringkasan tidak valid.');

  const difficultyInstructions = {
    easy: 'Mudah: uji pengenalan istilah dan fakta yang tertulis langsung dalam materi.',
    medium: 'Sedang: uji pemahaman hubungan antar konsep dalam materi.',
    hard: 'Sulit: uji analisis dan penerapan konsep, tetapi semua jawaban tetap harus dapat disimpulkan dari materi.',
  };
  const summaryInstructions = {
    short: 'Buat ringkasan singkat: fokus pada inti materi dan 3 sampai 5 poin utama.',
    medium: 'Buat ringkasan sedang: jelaskan konsep utama dan poin penting secara seimbang.',
    long: 'Buat ringkasan lengkap: susun per subtopik, pertahankan detail penting, definisi, dan contoh yang tersedia dalam materi.',
  };
  const systemPrompt = 'Kamu adalah StudyGen, asisten belajar berbasis AI.\n\nTugasmu membantu pelajar dan mahasiswa memahami materi yang diberikan pengguna.\n\nGunakan hanya informasi yang terdapat dalam materi pengguna. Jangan mengarang fakta yang tidak tersedia dalam materi.\n\nGunakan Bahasa Indonesia yang jelas, sederhana, dan mudah dipahami. Jika materi tidak cukup untuk menghasilkan jawaban tertentu, jelaskan keterbatasannya.';
  const prompts = {
    summary: `${summaryInstructions[summaryLength]}\n\nRingkas materi berikut menjadi bahan belajar yang mudah dipahami.\n\nBuat output dengan struktur:\n\nJudul Materi\n\nRingkasan:\nPenjelasan singkat mengenai materi.\n\nPoin Penting:\n- poin penting\n- poin penting\n- poin penting\n\nKesimpulan:\nKesimpulan singkat dari materi.\n\nMateri:\n`,
    quiz: `Berdasarkan materi berikut, buat tepat ${count} soal pilihan ganda yang berbeda. ${difficultyInstructions[difficulty]} Balas HANYA dengan objek JSON valid berbentuk {"questions":[{"question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A","explanation":"..."}]}. answer harus satu huruf A, B, C, atau D. Pilihan harus berbeda dan penjelasan singkat. Jangan gunakan Markdown. Gunakan hanya informasi dari materi.\n\nMateri:\n`,
    flashcard: `Berdasarkan materi berikut, buat tepat ${count} flashcard yang berbeda. Balas HANYA dengan objek JSON valid berbentuk {"cards":[{"front":"pertanyaan singkat","back":"jawaban yang jelas"}]}. Jangan gunakan Markdown. Gunakan hanya informasi dari materi.\n\nMateri:\n`,
  };
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey || apiKey === 'your_groq_api_key_here') return fail(500, fallbackError);

  let upstream;
  let groqResponse;
  try {
    // Keep the entire upstream request (including the body read) below maxDuration.
    upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompts[type] + content }],
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!upstream.ok) {
      console.error(`StudyGen Groq returned HTTP ${upstream.status}`);
      return fail(upstream.status === 429 ? 503 : 502, upstream.status === 429
        ? 'Layanan AI sedang sibuk. Silakan coba lagi beberapa saat lagi.'
        : 'Layanan AI gagal memproses permintaan. Silakan coba lagi.');
    }
    groqResponse = await upstream.json();
  } catch (error) {
    // Never include headers, upstream response bodies, or the API key in logs/errors.
    if (error instanceof SyntaxError) return fail(502, fallbackError);
    console.error('StudyGen Groq connection failed.');
    return fail(503, 'Server tidak dapat terhubung ke layanan AI. Periksa koneksi internet server, lalu coba lagi.');
  }
  const result = groqResponse?.choices?.[0]?.message?.content;
  if (typeof result !== 'string' || !result.trim()) return fail(502, fallbackError);
  if (type === 'summary') return respond(200, true, { type, settings, result: result.trim() });

  let structured;
  try {
    const cleanResult = result.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
    structured = JSON.parse(cleanResult);
  } catch {
    return fail(502, 'Format hasil AI tidak valid. Silakan coba lagi.');
  }
  if (!isObject(structured)) return fail(502, 'Format hasil AI tidak valid. Silakan coba lagi.');
  if (type === 'quiz') {
    const questions = structured.questions;
    if (!Array.isArray(questions) || questions.length !== count) return fail(502, 'Jumlah atau format soal dari AI tidak sesuai. Silakan coba lagi.');
    const validated = [];
    for (const item of questions) {
      if (!isObject(item) || !validText(item.question) || !validText(item.explanation)
        || !isObject(item.options) || !letters.includes(item.answer)
        || !letters.every((letter) => validText(item.options[letter]))) return fail(502, 'Format kuis tidak valid. Silakan coba lagi.');
      const options = Object.fromEntries(letters.map((letter) => [letter, item.options[letter].trim()]));
      if (new Set(Object.values(options)).size !== 4) return fail(502, 'Pilihan jawaban dari AI tidak valid. Silakan coba lagi.');
      validated.push({ question: item.question.trim(), options, answer: item.answer, explanation: item.explanation.trim() });
    }
    return respond(200, true, { type, settings, result: { questions: validated } });
  }
  const cards = structured.cards;
  if (!Array.isArray(cards) || cards.length !== count) return fail(502, 'Jumlah atau format kartu dari AI tidak sesuai. Silakan coba lagi.');
  if (!cards.every((item) => isObject(item) && validText(item.front) && validText(item.back))) return fail(502, 'Format flashcard tidak valid. Silakan coba lagi.');
  return respond(200, true, { type, settings, result: { cards: cards.map((item) => ({ front: item.front.trim(), back: item.back.trim() })) } });
};
