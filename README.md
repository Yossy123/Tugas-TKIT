# StudyGen

AI-powered Study Assistant untuk mengubah materi belajar menjadi ringkasan, quiz pilihan ganda, atau flashcard.

## Features

- Generate ringkasan dengan pilihan panjang singkat, sedang, atau lengkap
- Kuis interaktif: 5/10/15 soal, pilihan kesulitan, skor, pembahasan, dan latihan ulang soal yang salah
- Flashcard interaktif: 5/10/15 kartu, buka jawaban, tandai pemahaman, dan ulangi kartu yang belum dipahami
- Riwayat lokal berisi materi, hasil AI, pengaturan, dan progres latihan
- Lampiran PDF hingga 10 MB / 500 halaman, diproses terpisah dari kolom teks
- Validasi materi dan loading/error state

## Tech Stack

- HTML
- CSS
- JavaScript
- PHP
- Node.js (backend Vercel)
- Groq API
- PDF.js untuk membaca PDF di browser

## Latihan dan riwayat

1. Masukkan materi, lalu isi judul opsional agar mudah ditemukan kembali.
2. Pilih cara belajar dan atur panjang ringkasan atau jumlah soal/kartu. Kuis juga memiliki pilihan kesulitan.
3. Pada kuis, jawab semua soal lalu klik **Periksa jawaban** untuk melihat skor dan pembahasan. **Ulangi soal yang salah** memulai latihan dari soal yang belum terjawab benar, tanpa panggilan AI baru.
4. Pada flashcard, coba ingat jawabannya sebelum klik **Buka jawaban**. Tandai **Belum paham** atau **Sudah paham** untuk berpindah ke kartu berikutnya. Di akhir sesi, kartu yang belum dipahami bisa diulang.
5. Klik **Buka** di riwayat untuk memulihkan materi, hasil, pengaturan, dan progres. Klik **Hapus** untuk menghapus satu hasil dari riwayat.

Maksimal 30 hasil terakhir disimpan dengan `localStorage` pada browser dan alamat situs yang sama. Riwayat tidak tersinkron antar perangkat dan dapat hilang jika data browser dihapus. Jika penyimpanan penuh atau diblokir, aplikasi menampilkan pemberitahuan dan hasil tetap bisa digunakan selama halaman masih terbuka. Hasil dan progres yang sudah disimpan dapat dibuka tanpa membuat ulang lewat Groq.

## Memakai PDF

Klik **Pilih file PDF** untuk melampirkan dokumen. Nama file, ukuran, dan jumlah
halaman ditampilkan; isi PDF tidak dimasukkan ke kolom teks. Klik **Hapus PDF**
untuk kembali ke materi ketik sebelumnya. Batas 15.000 karakter hanya berlaku
untuk materi yang diketik/ditempel.

PDF dapat berukuran hingga 10 MB, 500 halaman, dan 1 juta karakter teks yang
terbaca. Dokumen yang melewati batas ditolak dengan pesan, bukan dipotong diam-diam.
PDF dibaca di browser karena backend Groq saat ini menerima teks, bukan PDF mentah.
Seluruh halaman dibaca; dokumen panjang diproses per bagian menjadi catatan padat,
lalu catatan seluruh bagian digabungkan untuk membuat ringkasan, kuis, atau flashcard.
Pemrosesan bertahap memakai lebih dari satu permintaan AI dan dapat memerlukan
waktu lebih lama. Catatan dipakai ulang selama PDF yang sama masih terlampir.
Jika batas layanan AI tercapai, aplikasi mencoba ulang maksimal dua kali sebelum
menampilkan error. Peringkasan dapat menghilangkan detail; hasil belajar tetap
perlu diperiksa terhadap dokumen asli.

File PDF asli tidak disimpan ke server atau localStorage. Riwayat menyimpan nama
PDF, jumlah halaman, catatan yang dipakai, hasil, dan progres. Hasil/progres bisa
dibuka kembali; pilih ulang file untuk membuat bahan belajar baru dari PDF.
PDF hasil scan yang hanya berisi gambar memerlukan OCR dan belum didukung.
Halaman tanpa teks dilaporkan agar pengguna mengetahui bagian yang tidak terbaca.

Build PDF.js 5.7.284 disertakan secara lokal di `js/vendor/pdfjs` beserta lisensinya, sehingga fitur PDF tidak memerlukan CDN atau instalasi npm saat aplikasi dijalankan.

## Installation

1. Clone atau salin repository ini ke folder `htdocs` XAMPP, misalnya `C:\xampp\htdocs\studygen`.
2. Salin `.env.example` menjadi `.env` pada root project.
3. Isi `GROQ_API_KEY` di file `.env` dengan API key Groq Anda.
4. Pastikan ekstensi PHP cURL aktif di XAMPP (`php_curl`).
5. Jalankan Apache melalui XAMPP Control Panel.
6. Buka `http://localhost/studygen/` di browser.

## Environment

```env
GROQ_API_KEY=
```

API key hanya dibaca oleh backend PHP dan tidak pernah dikirim ke browser. File `.env` sudah dikecualikan dari Git.

## Deploy ke Vercel

Backend Vercel menggunakan `api/generate.js` (Node.js 24). Build mengatur frontend
agar memakai `/api/generate`. Instalasi XAMPP memakai `local-api/generate.php`
melalui atribut `data-api-url` pada script frontend. Backend PHP disimpan di luar
folder `api/` agar Vercel tidak menyajikannya sebagai endpoint statis.
Rute lama `/api/generate.php` tetap diarahkan ke backend Node.js untuk frontend lama.

1. Di Vercel pilih **Add New → Project**, lalu import repo `Yossy123/Tugas-TKIT`.
2. Gunakan **Framework Preset: Other** dan **Root Directory: `./`**. Konfigurasi
   repo sudah menetapkan **Build Command: `npm run build`** dan **Output Directory: `dist`**.
3. Tambahkan environment variable **`GROQ_API_KEY`**, dengan value berupa API key
   Groq dari `.env` lokal. Aktifkan untuk **Production** dan **Preview** bila diperlukan.
   Jangan menambahkan prefix `NEXT_PUBLIC_` atau `VITE_`.
4. Klik **Deploy**. Jika environment variable baru ditambahkan atau diubah setelah
   deploy, lakukan **Redeploy** agar deployment memakai value tersebut.
5. Buka URL hasil deploy, masukkan materi, lalu coba ringkasan, kuis, dan flashcard.

Di Vercel API key dibaca melalui `process.env.GROQ_API_KEY`; `.env` lokal tidak
perlu diunggah. Build hanya menyalin `index.html`, `css/`, dan `js/` ke `dist/`.
Folder tersebut tidak memuat API key, backend PHP, atau file pengujian.
`.vercelignore` juga mengecualikan `.env` dan backend PHP dari upload CLI.

Pemeriksaan backend Vercel: jalankan `npm test` dari root project. Tes memakai
respons Groq simulasi dan tidak membutuhkan API key. `npm run build` menyiapkan
aset publik tanpa membutuhkan dependency tambahan.

Jika generate gagal, periksa **Network → `/api/generate` → Response** di browser,
atau **Logs** pada Vercel. Kode `AI_AUTH_FAILED` / `upstreamStatus: 401` berarti
Groq menolak API key. Isi value `GROQ_API_KEY` hanya dengan key, tanpa awalan
`GROQ_API_KEY=`, tanda kutip, atau `Bearer`, lalu redeploy. `AI_ACCESS_DENIED` (403)
berarti akses ditolak; periksa izin model/organisasi di Groq. `AI_MODEL_UNAVAILABLE`
(404) berarti model tidak tersedia, sedangkan `AI_RATE_LIMITED` (429) berarti
batas layanan tercapai. Respons tidak menyertakan key atau body error mentah Groq.

## Pemeriksaan pengembangan

Pemeriksaan browser berada di `tests` dan membutuhkan Node.js serta PHP pada PATH. Jalankan `npm install` lalu `npm test` dari folder `tests`; pada instalasi Playwright pertama, jalankan `npx playwright install chromium`. Tes menjalankan server PHP lokal sementara pada port 18743 dan menggunakan respons AI simulasi, sehingga tidak memerlukan API key atau kredit Groq. Browser pengguna dan riwayatnya tidak dipakai. Screenshot desktop dan mobile tersimpan di `.tmp`.

## AI Model

`openai/gpt-oss-20b`

> Model awal `llama-3.1-8b-instant` sudah tidak tersedia di Groq. Project memakai model chat Groq yang tersedia sebagai penggantinya.
