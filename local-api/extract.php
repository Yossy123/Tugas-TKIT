<?php
declare(strict_types=1);

// URL/YouTube text extraction for the local PHP backend; mirrors api/_lib/extract.js.
// Every request (including redirects) is pinned to a checked public IPv4 address.

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === realpath(__FILE__)) {
    http_response_code(404);
    exit;
}

const STUDYGEN_MAX_BYTES = 3 * 1024 * 1024;
const STUDYGEN_MAX_TEXT = 1000000;
const STUDYGEN_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 StudyGen';

final class ExtractException extends RuntimeException {
    public function __construct(string $message, public readonly int $status = 422) {
        parent::__construct($message);
    }
}

function isPublicIp(string $ip): bool {
    $flags = FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE;
    if (defined('FILTER_FLAG_GLOBAL_RANGE')) $flags |= FILTER_FLAG_GLOBAL_RANGE;
    return filter_var($ip, FILTER_VALIDATE_IP, $flags) !== false && !str_starts_with($ip, '100.64.');
}

/** @return array{url:string,host:string,port:int,ip:string,scheme:string} */
function publicUrl(string $raw): array {
    $raw = trim($raw);
    $parts = parse_url($raw);
    if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) throw new ExtractException('URL tidak valid. Contoh: https://contoh.com/artikel');
    $scheme = strtolower($parts['scheme']);
    if (!in_array($scheme, ['http', 'https'], true)) throw new ExtractException('Gunakan URL yang diawali http:// atau https://.');
    if (isset($parts['user']) || isset($parts['pass'])) throw new ExtractException('URL tidak boleh berisi nama pengguna atau kata sandi.');
    $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
    if (!in_array($port, [80, 443], true)) throw new ExtractException('Alamat URL tidak diizinkan.');
    $host = strtolower(trim($parts['host'], '[]'));
    if ($host === 'localhost' || preg_match('/\.(localhost|local|internal|home|lan)$/', $host)) throw new ExtractException('Alamat URL tidak diizinkan.');
    if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) throw new ExtractException('Alamat URL tidak diizinkan.');
    $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : (gethostbynamel($host) ?: []);
    if (!$ips) throw new ExtractException('Domain tidak ditemukan. Periksa kembali alamat URL.');
    foreach ($ips as $ip) {
        if (!isPublicIp($ip)) throw new ExtractException('Alamat URL tidak diizinkan.');
    }
    return ['url' => $raw, 'host' => $host, 'port' => $port, 'ip' => $ips[0], 'scheme' => $scheme];
}

function resolveRelativeUrl(string $base, string $location): string {
    if (preg_match('#^https?://#i', $location)) return $location;
    $parts = parse_url($base);
    $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
    if (str_starts_with($location, '//')) return $parts['scheme'] . ':' . $location;
    if (str_starts_with($location, '/')) return $origin . $location;
    $path = $parts['path'] ?? '/';
    return $origin . substr($path, 0, (int) strrpos($path, '/') + 1) . $location;
}

/** @return array{status:int,contentType:string,text:string,url:string} */
function fetchPublic(string $rawUrl, string $method = 'GET', array $headers = [], ?string $body = null, int $redirects = 4): array {
    $target = publicUrl($rawUrl);
    $responseHeaders = [];
    $buffer = '';
    $tooLarge = false;
    $curl = curl_init($target['url']);
    $requestHeaders = array_merge(['User-Agent: ' . STUDYGEN_USER_AGENT, 'Accept-Language: id,en;q=0.8'], $headers);
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $requestHeaders,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_RESOLVE => [$target['host'] . ':' . $target['port'] . ':' . $target['ip']],
        CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_ENCODING => '',
        CURLOPT_HEADERFUNCTION => function ($handle, string $line) use (&$responseHeaders): int {
            $pair = explode(':', $line, 2);
            if (count($pair) === 2) $responseHeaders[strtolower(trim($pair[0]))] = trim($pair[1]);
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => function ($handle, string $chunk) use (&$buffer, &$tooLarge): int {
            if (strlen($buffer) + strlen($chunk) > STUDYGEN_MAX_BYTES) { $tooLarge = true; return 0; }
            $buffer .= $chunk;
            return strlen($chunk);
        },
    ]);
    if ($body !== null) curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
    $ok = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $errno = curl_errno($curl);
    curl_close($curl);
    if ($tooLarge) throw new ExtractException('Halaman terlalu besar untuk dibaca (maksimal 3 MB).');
    if ($ok === false || $errno !== 0) {
        if ($errno === CURLE_OPERATION_TIMEDOUT) throw new ExtractException('Halaman terlalu lama merespons. Coba lagi nanti.', 504);
        throw new ExtractException('Halaman tidak dapat diambil. Periksa URL atau coba lagi nanti.', 502);
    }
    if ($status >= 300 && $status < 400 && !empty($responseHeaders['location'])) {
        if ($redirects <= 0) throw new ExtractException('Halaman terlalu banyak dialihkan.');
        $keep = $status === 307 || $status === 308;
        return fetchPublic(resolveRelativeUrl($target['url'], $responseHeaders['location']), $keep ? $method : 'GET', $headers, $keep ? $body : null, $redirects - 1);
    }
    $contentType = $responseHeaders['content-type'] ?? '';
    if (preg_match('/charset=["\']?([\w-]+)/i', $contentType, $match) && strcasecmp($match[1], 'utf-8') !== 0 && function_exists('mb_convert_encoding')) {
        $converted = @mb_convert_encoding($buffer, 'UTF-8', $match[1]);
        if (is_string($converted)) $buffer = $converted;
    }
    return ['status' => $status, 'contentType' => $contentType, 'text' => $buffer, 'url' => $target['url']];
}

function decodeEntities(string $value): string {
    return html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

function tidyText(string $value): string {
    // Note: in PCRE \v means any vertical whitespace (including newlines), so use \x0B.
    $value = preg_replace('/[ \t\f\x0B\x{00A0}]+/u', ' ', $value) ?? $value;
    $lines = array_map('trim', explode("\n", str_replace("\r", '', $value)));
    return trim(preg_replace("/\n{3,}/", "\n\n", implode("\n", $lines)) ?? '');
}

function fragmentToText(string $fragment): string {
    $fragment = preg_replace('/<br\s*\/?>/i', "\n", $fragment);
    $fragment = preg_replace('/<li\b[^>]*>/i', "\n- ", $fragment);
    $fragment = preg_replace('/<h[1-6]\b[^>]*>/i', "\n\n", $fragment);
    $fragment = preg_replace('/<\/(p|div|section|article|h[1-6]|li|tr|blockquote|pre|ul|ol|table|main|header)>/i', "\n", $fragment);
    $fragment = preg_replace('/<[^>]+>/', ' ', $fragment);
    return dropMenus(tidyText(decodeEntities((string) $fragment)));
}

// Removes navigation-like runs: 5+ consecutive short list items (menus, language lists).
function dropMenus(string $text): string {
    $kept = [];
    $run = [];
    $flush = function () use (&$run, &$kept): void {
        if (count(array_filter($run, fn ($item) => $item !== '')) < 5) array_push($kept, ...$run);
        $run = [];
    };
    foreach (explode("\n", $text) as $line) {
        if ((str_starts_with($line, '- ') && mb_strlen($line) <= 40) || ($line === '' && $run)) { $run[] = $line; continue; }
        $flush();
        $kept[] = $line;
    }
    $flush();
    return trim(preg_replace("/\n{3,}/", "\n\n", implode("\n", $kept)) ?? '');
}

/** @return array{title:string,text:string} */
function htmlToText(string $html): array {
    $title = '';
    if (preg_match('/<meta[^>]+property=["\']og:title["\'][^>]*content=["\']([^"\']*)["\']/i', $html, $m)
        || preg_match('/<meta[^>]+content=["\']([^"\']*)["\'][^>]*property=["\']og:title["\']/i', $html, $m)
        || preg_match('/<title[^>]*>(.*?)<\/title>/is', $html, $m)) {
        $title = mb_substr(trim(preg_replace('/\s+/u', ' ', decodeEntities(strip_tags($m[1]))) ?? ''), 0, 200);
    }
    $body = preg_replace('/<!--.*?-->/s', ' ', $html) ?? $html;
    $body = preg_replace('/<(script|style|noscript|svg|template|iframe|head|nav|footer|aside|form|button|select|figure)\b.*?<\/\1\s*>/is', ' ', $body) ?? $body;
    $candidates = [];
    if (preg_match_all('/<article\b.*?<\/article>/is', $body, $articles)) $candidates[] = implode("\n", $articles[0]);
    if (preg_match('/<main\b.*?<\/main>/is', $body, $main)) $candidates[] = $main[0];
    foreach ($candidates as $candidate) {
        $text = fragmentToText($candidate);
        if (mb_strlen($text) >= 500) return ['title' => $title, 'text' => $text];
    }
    if (preg_match('/<body\b.*<\/body>/is', $body, $match)) $body = $match[0];
    return ['title' => $title, 'text' => fragmentToText($body)];
}

function youtubeId(string $url): ?string {
    $parts = parse_url($url);
    $host = preg_replace('/^(www\.|m\.|music\.)/', '', strtolower($parts['host'] ?? ''));
    $path = $parts['path'] ?? '';
    $id = null;
    if ($host === 'youtu.be') $id = explode('/', ltrim($path, '/'))[0] ?? null;
    elseif ($host === 'youtube.com' || $host === 'youtube-nocookie.com') {
        parse_str($parts['query'] ?? '', $query);
        $id = is_string($query['v'] ?? null) ? $query['v'] : null;
        if (!$id && preg_match('#^/(?:shorts|embed|live|v)/([^/?\#]+)#', $path, $m)) $id = $m[1];
    } else return null;
    return $id !== null && preg_match('/^[\w-]{11}$/', $id) ? $id : null;
}

function captionsToText(string $xml): string {
    preg_match_all('/<(text|p)\b[^>]*>(.*?)<\/\1>/s', $xml, $matches);
    $parts = [];
    foreach ($matches[2] as $part) {
        $clean = trim(preg_replace('/\s+/u', ' ', decodeEntities(decodeEntities(strip_tags($part)))) ?? '');
        if ($clean !== '') $parts[] = $clean;
    }
    $lines = array_map(fn ($chunk) => implode(' ', $chunk), array_chunk($parts, 12));
    return implode("\n", $lines);
}

/** @return array{kind:string,title:string,text:string,url:string} */
function youtubeTranscript(string $id): array {
    $noTranscript = 'Transkrip video tidak tersedia atau tidak dapat diambil. Salin transkrip secara manual ke kolom teks.';
    $watch = fetchPublic("https://www.youtube.com/watch?v={$id}&hl=id", 'GET', ['Cookie: CONSENT=YES+1']);
    if ($watch['status'] !== 200) throw new ExtractException('Video YouTube tidak dapat dibuka.');
    $title = 'Video YouTube';
    if (preg_match('/<meta name="title" content="([^"]*)"/', $watch['text'], $m) || preg_match('/<title>(.*?)<\/title>/s', $watch['text'], $m)) {
        $title = mb_substr(trim(preg_replace('/\s*-\s*YouTube\s*$/', '', decodeEntities($m[1])) ?? ''), 0, 200) ?: 'Video YouTube';
    }
    $tracks = null;
    if (preg_match('/"INNERTUBE_API_KEY":"([\w-]+)"/', $watch['text'], $key)) {
        try {
            $player = fetchPublic("https://www.youtube.com/youtubei/v1/player?key={$key[1]}", 'POST', ['Content-Type: application/json'],
                json_encode(['context' => ['client' => ['clientName' => 'ANDROID', 'clientVersion' => '20.10.38']], 'videoId' => $id]));
            $tracks = json_decode($player['text'], true)['captions']['playerCaptionsTracklistRenderer']['captionTracks'] ?? null;
        } catch (ExtractException) { $tracks = null; }
    }
    if (!is_array($tracks) || !$tracks) {
        $tracks = preg_match('/"captionTracks":(\[.*?\])/', $watch['text'], $m) ? json_decode($m[1], true) : null;
    }
    if (!is_array($tracks)) throw new ExtractException($noTranscript);
    $tracks = array_values(array_filter($tracks, fn ($track) => is_array($track) && is_string($track['baseUrl'] ?? null)));
    $score = function (array $track): int {
        $lang = strtolower((string) ($track['languageCode'] ?? ''));
        $manual = ($track['kind'] ?? '') !== 'asr';
        if (str_starts_with($lang, 'id')) return $manual ? 0 : 1;
        if (str_starts_with($lang, 'en')) return $manual ? 2 : 3;
        return $manual ? 4 : 5;
    };
    usort($tracks, fn ($a, $b) => $score($a) <=> $score($b));
    if (!$tracks) throw new ExtractException($noTranscript);
    $captionUrl = preg_replace('/&fmt=[^&]*/', '', str_replace('&', '&', $tracks[0]['baseUrl']));
    if (!preg_match('#^https://([\w-]+\.)*youtube\.com/#', $captionUrl)) throw new ExtractException($noTranscript);
    $captions = fetchPublic($captionUrl);
    $text = $captions['status'] === 200 ? captionsToText($captions['text']) : '';
    if (mb_strlen($text) < 20) throw new ExtractException($noTranscript);
    return ['kind' => 'youtube', 'title' => $title, 'text' => mb_substr($text, 0, STUDYGEN_MAX_TEXT), 'url' => "https://www.youtube.com/watch?v={$id}"];
}

/** @return array{kind:string,title:string,text:string,url:string} */
function extractFromUrl(mixed $raw): array {
    if (!is_string($raw) || trim($raw) === '' || strlen($raw) > 2048) throw new ExtractException('Masukkan URL yang valid (maksimal 2.048 karakter).');
    $raw = trim($raw);
    publicUrl($raw);
    $videoId = youtubeId($raw);
    if ($videoId !== null) return youtubeTranscript($videoId);
    $page = fetchPublic($raw, 'GET', ['Accept: text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5']);
    if ($page['status'] < 200 || $page['status'] >= 300) throw new ExtractException("Halaman tidak dapat diambil (HTTP {$page['status']}). Situs mungkin memerlukan login atau memblokir akses otomatis.");
    $type = strtolower($page['contentType']);
    if (str_contains($type, 'application/pdf')) throw new ExtractException('URL ini berisi PDF. Unduh file-nya, lalu pakai tombol "Pilih file PDF".');
    $title = '';
    if ($type === '' || str_contains($type, 'text/html') || str_contains($type, 'application/xhtml')) ['title' => $title, 'text' => $text] = htmlToText($page['text']);
    elseif (str_contains($type, 'text/plain')) $text = tidyText($page['text']);
    else throw new ExtractException('Jenis konten tidak didukung. Gunakan halaman artikel atau unggah PDF.');
    if (mb_strlen($text) < 100) throw new ExtractException('Halaman tidak berisi cukup teks. Situs mungkin memuat isinya dengan JavaScript atau memerlukan login. Salin teksnya secara manual.');
    if (mb_strlen($text) > STUDYGEN_MAX_TEXT) throw new ExtractException('Isi halaman terlalu besar. Salin bagian yang ingin dipelajari secara manual.');
    return ['kind' => 'article', 'title' => $title !== '' ? $title : (string) parse_url($page['url'], PHP_URL_HOST), 'text' => $text, 'url' => $page['url']];
}
