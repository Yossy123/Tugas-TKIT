const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const handler = require('../api/generate.js');
const material = 'Fotosintesis menggunakan cahaya matahari dan air untuk menghasilkan glukosa dan oksigen.';
const originalKey = process.env.GROQ_API_KEY;

beforeEach(() => { process.env.GROQ_API_KEY = 'test-only-key'; });
afterEach(() => {
  if (originalKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalKey;
});

async function request(body = { type: 'summary', content: material }, method = 'POST') {
  const response = { headers: {}, statusCode: 200 };
  const res = {
    setHeader: (name, value) => { response.headers[name] = value; },
    status: (code) => { response.statusCode = code; return res; },
    json: (payload) => { response.body = payload; return res; },
  };
  await handler({ body, method }, res);
  return response;
}

function mockGroq(t, content) {
  return t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  }));
}

const questions = (count) => Array.from({ length: count }, (_, i) => ({
  question: ` Pertanyaan ${i + 1}? `,
  options: { A: ' Cahaya ', B: 'Batu', C: 'Minyak', D: 'Plastik' },
  answer: 'A', explanation: ' Cahaya disebutkan dalam materi. ',
}));
const cards = (count) => Array.from({ length: count }, (_, i) => ({ front: ` Konsep ${i + 1}? `, back: ' Penjelasan. ' }));

test('GET is rejected as JSON and POST is advertised', async (t) => {
  const upstream = mockGroq(t, 'unexpected');
  const response = await request(undefined, 'GET');
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'POST');
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.body.success, false);
  assert.equal(upstream.mock.callCount(), 0);
});

test('malformed bodies and invalid material/settings never call Groq', async (t) => {
  const upstream = mockGroq(t, 'unexpected');
  for (const body of ['{', null, [], 'null']) {
    assert.equal((await request(body)).statusCode, 400);
  }
  const invalid = [
    { content: '', type: 'summary' },
    { content: 'short', type: 'summary' },
    { content: 'x'.repeat(15001), type: 'summary' },
    { content: material, type: 'unknown' },
    ...['bad', [], { count: 7 }, { count: '10' }, { difficulty: 'unknown' }, { summaryLength: 'huge' }]
      .map((settings) => ({ content: material, type: 'quiz', settings })),
  ];
  for (const body of invalid) {
    const response = await request(body);
    assert.equal(response.statusCode, 422, JSON.stringify(body.settings));
    assert.equal(response.body.success, false);
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('missing or placeholder environment keys fail without calling Groq', async (t) => {
  const upstream = mockGroq(t, 'unexpected');
  for (const key of ['', 'your_groq_api_key_here']) {
    process.env.GROQ_API_KEY = key;
    const response = await request();
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.success, false);
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('summary uses the server environment key and returns the frontend contract', async (t) => {
  const upstream = mockGroq(t, ' Ringkasan materi. ');
  const settings = { count: 5, summaryLength: 'long', difficulty: 'medium' };
  const response = await request(JSON.stringify({ content: material, type: 'summary', settings }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { success: true, type: 'summary', settings, result: 'Ringkasan materi.' });
  const [url, options] = upstream.mock.calls[0].arguments;
  assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer test-only-key');
  assert.ok(options.signal instanceof AbortSignal);
  const payload = JSON.parse(options.body);
  assert.equal(payload.model, 'openai/gpt-oss-20b');
  assert.match(payload.messages[1].content, /ringkasan lengkap/);
  assert.ok(payload.messages[1].content.endsWith(material));
  assert.ok(!JSON.stringify(response).includes('test-only-key'));
});

test('quiz supports all requested counts and strips code fences and extra fields', async (t) => {
  const upstream = mockGroq(t, '');
  for (const count of [5, 10, 15]) {
    const items = questions(count);
    items[0].options.extra = 'must be removed';
    upstream.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '```json\n' + JSON.stringify({ questions: items }) + '\n```' } }] }) }));
    const response = await request({ type: 'quiz', content: material, settings: { count, difficulty: 'hard' } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.result.questions.length, count);
    assert.deepEqual(response.body.result.questions[0].options, { A: 'Cahaya', B: 'Batu', C: 'Minyak', D: 'Plastik' });
    assert.equal(response.body.result.questions[0].question, 'Pertanyaan 1?');
    const payload = JSON.parse(upstream.mock.calls.at(-1).arguments[1].body);
    assert.match(payload.messages[1].content, /Sulit: uji analisis/);
  }
});

test('flashcards return trimmed text at the requested count', async (t) => {
  mockGroq(t, JSON.stringify({ cards: cards(10) }));
  const response = await request({ type: 'flashcard', content: material, settings: { count: 10 } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.result.cards.length, 10);
  assert.deepEqual(response.body.result.cards[0], { front: 'Konsep 1?', back: 'Penjelasan.' });
});

test('invalid generated quizzes and cards are rejected before reaching the UI', async (t) => {
  const upstream = mockGroq(t, '');
  const duplicate = questions(5);
  duplicate[0].options.B = 'Cahaya';
  const invalidAnswer = questions(5);
  invalidAnswer[0].answer = 'E';
  const missingOption = questions(5);
  delete missingOption[0].options.D;
  const invalidCards = cards(5);
  invalidCards[0].back = 'x'.repeat(2001);
  for (const [type, result] of [
    ['quiz', 'not JSON'], ['quiz', 'null'],
    ['quiz', JSON.stringify({ questions: questions(4) })],
    ['quiz', JSON.stringify({ questions: duplicate })],
    ['quiz', JSON.stringify({ questions: invalidAnswer })],
    ['quiz', JSON.stringify({ questions: missingOption })],
    ['flashcard', JSON.stringify({ cards: cards(4) })],
    ['flashcard', JSON.stringify({ cards: invalidCards })],
  ]) {
    upstream.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: result } }] }) }));
    const response = await request({ type, content: material });
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.success, false);
  }
});

test('Groq HTTP errors produce safe JSON and never expose upstream details', async (t) => {
  t.mock.method(console, 'error', () => {});
  const upstream = mockGroq(t, '');
  const expectedCodes = {
    400: 'AI_REQUEST_REJECTED', 401: 'AI_AUTH_FAILED', 403: 'AI_ACCESS_DENIED',
    404: 'AI_MODEL_UNAVAILABLE', 422: 'AI_REQUEST_REJECTED', 429: 'AI_RATE_LIMITED', 500: 'AI_UPSTREAM_ERROR',
  };
  for (const status of [400, 401, 403, 404, 422, 429, 500]) {
    upstream.mock.mockImplementation(async () => ({ ok: false, status, json: async () => ({ error: 'test-only-key' }) }));
    const response = await request();
    assert.equal(response.statusCode, status === 429 ? 503 : 502);
    assert.equal(response.body.success, false);
    assert.equal(response.body.code, expectedCodes[status]);
    assert.equal(response.body.upstreamStatus, status);
    assert.ok(!JSON.stringify(response).includes('test-only-key'));
  }
});

test('network failures and timeouts produce JSON rather than crash', async (t) => {
  t.mock.method(console, 'error', () => {});
  const upstream = mockGroq(t, '');
  for (const error of [new TypeError('test-only-key'), new DOMException('timeout', 'TimeoutError')]) {
    upstream.mock.mockImplementation(async () => { throw error; });
    const response = await request();
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.success, false);
    assert.ok(!JSON.stringify(response).includes('test-only-key'));
  }
});

test('malformed or empty upstream responses produce a gateway error', async (t) => {
  const upstream = mockGroq(t, '');
  const responses = [
    { ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } },
    { ok: true, json: async () => ({ choices: [] }) },
    { ok: true, json: async () => ({ choices: [{ message: { content: ' ' } }] }) },
  ];
  for (const body of responses) {
    upstream.mock.mockImplementation(async () => body);
    assert.equal((await request()).statusCode, 502);
  }
});
