<?php
declare(strict_types=1);

// Local PHP/XAMPP backend; Vercel uses api/generate.js.

header('Content-Type: application/json; charset=utf-8');
header_remove('X-Powered-By');

function respond(bool $success, array $payload, int $status = 200): void {
    http_response_code($status);
    echo json_encode(array_merge(['success' => $success], $payload), JSON_UNESCAPED_UNICODE);
    exit;
}

function textLength(string $value): int {
    return function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
}

function loadEnvValue(string $key): ?string {
    $fromEnvironment = getenv($key);
    if (is_string($fromEnvironment) && $fromEnvironment !== '') return $fromEnvironment;
    $envFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . '.env';
    if (!is_readable($envFile)) return null;
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) return null;
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
        [$name, $value] = explode('=', $line, 2);
        if (trim($name) === $key) return trim($value, " \t\n\r\0\x0B\"'");
    }
    return null;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respond(false, ['error' => 'Method tidak diizinkan.'], 405);

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) respond(false, ['error' => 'Request tidak valid.'], 400);

$content = isset($input['content']) && is_string($input['content']) ? trim($input['content']) : '';
$type = isset($input['type']) && is_string($input['type']) ? $input['type'] : '';
$allowedTypes = ['summary', 'quiz', 'flashcard'];
if ($content === '') respond(false, ['error' => 'Materi tidak boleh kosong.'], 422);
if (!in_array($type, $allowedTypes, true)) respond(false, ['error' => 'Jenis generate tidak valid.'], 422);
$length = textLength($content);
if ($length < 20) respond(false, ['error' => 'Materi terlalu pendek. Masukkan minimal 20 karakter.'], 422);
if ($length > 15000) respond(false, ['error' => 'Materi terlalu panjang. Maksimal 15.000 karakter.'], 422);

$settings = $input['settings'] ?? [];
if (!is_array($settings)) respond(false, ['error' => 'Pengaturan tidak valid.'], 422);
$count = $settings['count'] ?? 5;
$difficulty = $settings['difficulty'] ?? 'medium';
$summaryLength = $settings['summaryLength'] ?? 'medium';
if (!is_int($count) || !in_array($count, [5, 10, 15], true)) respond(false, ['error' => 'Jumlah soal atau kartu harus 5, 10, atau 15.'], 422);
if (!is_string($difficulty) || !in_array($difficulty, ['easy', 'medium', 'hard'], true)) respond(false, ['error' => 'Kesulitan kuis tidak valid.'], 422);
if (!is_string($summaryLength) || !in_array($summaryLength, ['short', 'medium', 'long'], true)) respond(false, ['error' => 'Panjang ringkasan tidak valid.'], 422);
$difficultyInstructions = [
    'easy' => 'Mudah: uji pengenalan istilah dan fakta yang tertulis langsung dalam materi.',
    'medium' => 'Sedang: uji pemahaman hubungan antar konsep dalam materi.',
    'hard' => 'Sulit: uji analisis dan penerapan konsep, tetapi semua jawaban tetap harus dapat disimpulkan dari materi.',
];
$summaryInstructions = [
    'short' => 'Buat ringkasan singkat: fokus pada inti materi dan 3 sampai 5 poin utama.',
    'medium' => 'Buat ringkasan sedang: jelaskan konsep utama dan poin penting secara seimbang.',
    'long' => 'Buat ringkasan lengkap: susun per subtopik, pertahankan detail penting, definisi, dan contoh yang tersedia dalam materi.',
];

$systemPrompt = "Kamu adalah StudyGen, asisten belajar berbasis AI.\n\nTugasmu membantu pelajar dan mahasiswa memahami materi yang diberikan pengguna.\n\nGunakan hanya informasi yang terdapat dalam materi pengguna. Jangan mengarang fakta yang tidak tersedia dalam materi.\n\nGunakan Bahasa Indonesia yang jelas, sederhana, dan mudah dipahami. Jika materi tidak cukup untuk menghasilkan jawaban tertentu, jelaskan keterbatasannya.";
$prompts = [
    'summary' => "Ringkas materi berikut menjadi bahan belajar yang mudah dipahami.\n\nBuat output dengan struktur:\n\nJudul Materi\n\nRingkasan:\nPenjelasan singkat mengenai materi.\n\nPoin Penting:\n- poin penting\n- poin penting\n- poin penting\n\nKesimpulan:\nKesimpulan singkat dari materi.\n\nMateri:\n",
    'quiz' => "Berdasarkan materi berikut, buat tepat {$count} soal pilihan ganda yang berbeda. {$difficultyInstructions[$difficulty]} Balas HANYA dengan objek JSON valid berbentuk {\"questions\":[{\"question\":\"...\",\"options\":{\"A\":\"...\",\"B\":\"...\",\"C\":\"...\",\"D\":\"...\"},\"answer\":\"A\",\"explanation\":\"...\"}]}. answer harus satu huruf A, B, C, atau D. Pilihan harus berbeda dan penjelasan singkat. Jangan gunakan Markdown. Gunakan hanya informasi dari materi.\n\nMateri:\n",
    'flashcard' => "Berdasarkan materi berikut, buat tepat {$count} flashcard yang berbeda. Balas HANYA dengan objek JSON valid berbentuk {\"cards\":[{\"front\":\"pertanyaan singkat\",\"back\":\"jawaban yang jelas\"}]}. Jangan gunakan Markdown. Gunakan hanya informasi dari materi.\n\nMateri:\n",
];
if ($type === 'summary') $prompts['summary'] = $summaryInstructions[$summaryLength] . "\n\n" . $prompts['summary'];

$apiKey = loadEnvValue('GROQ_API_KEY');
if (!$apiKey || $apiKey === 'your_groq_api_key_here') respond(false, ['error' => 'Gagal menghasilkan materi. Silakan coba lagi.'], 500);
if (!function_exists('curl_init')) respond(false, ['error' => 'Gagal menghasilkan materi. Silakan coba lagi.'], 500);

$body = json_encode(['model' => 'openai/gpt-oss-20b', 'messages' => [['role' => 'system', 'content' => $systemPrompt], ['role' => 'user', 'content' => $prompts[$type] . $content]], 'temperature' => 0.4], JSON_UNESCAPED_UNICODE);
$curl = curl_init('https://api.groq.com/openai/v1/chat/completions');
curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $apiKey, 'Content-Type: application/json'], CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_TIMEOUT => 45]);
$rawResponse = curl_exec($curl);
$httpCode = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
$curlCode = curl_errno($curl);
$curlError = curl_error($curl);
curl_close($curl);
if ($rawResponse === false || $curlCode !== 0) {
    error_log("StudyGen Groq connection failed: cURL {$curlCode}: {$curlError}");
    respond(false, ['error' => 'Server tidak dapat terhubung ke layanan AI. Periksa koneksi internet server, lalu coba lagi.'], 503);
}
if ($httpCode < 200 || $httpCode >= 300) {
    error_log("StudyGen Groq returned HTTP {$httpCode}");
    $message = $httpCode === 429
        ? 'Layanan AI sedang sibuk. Silakan coba lagi beberapa saat lagi.'
        : 'Layanan AI gagal memproses permintaan. Silakan coba lagi.';
    respond(false, ['error' => $message], $httpCode === 429 ? 503 : 502);
}
$groqResponse = json_decode($rawResponse, true);
$result = $groqResponse['choices'][0]['message']['content'] ?? null;
if (!is_string($result) || trim($result) === '') respond(false, ['error' => 'Gagal menghasilkan materi. Silakan coba lagi.'], 502);
if ($type === 'summary') respond(true, ['type' => $type, 'settings' => $settings, 'result' => trim($result)]);

$cleanResult = trim($result);
if (preg_match('/^```(?:json)?\s*(.*?)\s*```$/si', $cleanResult, $matches)) $cleanResult = $matches[1];
$structured = json_decode($cleanResult, true);
if (!is_array($structured)) respond(false, ['error' => 'Format hasil AI tidak valid. Silakan coba lagi.'], 502);

function validText(mixed $value): bool {
    return is_string($value) && trim($value) !== '' && textLength($value) <= 2000;
}

if ($type === 'quiz') {
    $questions = $structured['questions'] ?? null;
    if (!is_array($questions) || !array_is_list($questions) || count($questions) !== $count) respond(false, ['error' => 'Jumlah atau format soal dari AI tidak sesuai. Silakan coba lagi.'], 502);
    $validated = [];
    foreach ($questions as $item) {
        if (!is_array($item) || !validText($item['question'] ?? null) || !validText($item['explanation'] ?? null)) respond(false, ['error' => 'Format kuis tidak valid. Silakan coba lagi.'], 502);
        $options = $item['options'] ?? null;
        $answer = $item['answer'] ?? null;
        if (!is_array($options) || !is_string($answer) || !in_array($answer, ['A', 'B', 'C', 'D'], true)) respond(false, ['error' => 'Format kuis tidak valid. Silakan coba lagi.'], 502);
        foreach (['A', 'B', 'C', 'D'] as $letter) {
            if (!validText($options[$letter] ?? null)) respond(false, ['error' => 'Format kuis tidak valid. Silakan coba lagi.'], 502);
        }
        if (count(array_unique(array_map('trim', array_intersect_key($options, array_flip(['A', 'B', 'C', 'D']))))) !== 4) respond(false, ['error' => 'Pilihan jawaban dari AI tidak valid. Silakan coba lagi.'], 502);
        $validated[] = ['question' => trim($item['question']), 'options' => array_map('trim', array_intersect_key($options, array_flip(['A', 'B', 'C', 'D']))), 'answer' => $answer, 'explanation' => trim($item['explanation'])];
    }
    respond(true, ['type' => $type, 'settings' => $settings, 'result' => ['questions' => $validated]]);
}

$cards = $structured['cards'] ?? null;
if (!is_array($cards) || !array_is_list($cards) || count($cards) !== $count) respond(false, ['error' => 'Jumlah atau format kartu dari AI tidak sesuai. Silakan coba lagi.'], 502);
$validated = [];
foreach ($cards as $item) {
    if (!is_array($item) || !validText($item['front'] ?? null) || !validText($item['back'] ?? null)) respond(false, ['error' => 'Format flashcard tidak valid. Silakan coba lagi.'], 502);
    $validated[] = ['front' => trim($item['front']), 'back' => trim($item['back'])];
}
respond(true, ['type' => $type, 'settings' => $settings, 'result' => ['cards' => $validated]]);
