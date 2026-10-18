# StudyGen

Asisten belajar berbasis AI yang mengubah materi pelajaran menjadi **ringkasan**, **kuis**, dan **flashcard**. Materi bisa diketik, diambil dari PDF, atau dari artikel web dan video YouTube.

Repository: [Yossy123/Tugas-TKIT](https://github.com/Yossy123/Tugas-TKIT)

## Daftar isi

- [Fitur](#fitur)
- [Tech stack](#tech-stack)
- [Menjalankan di komputer sendiri (Laragon / XAMPP)](#menjalankan-di-komputer-sendiri-laragon--xampp)
- [Cara memakai](#cara-memakai)
- [Deploy ke Vercel](#deploy-ke-vercel)
- [Struktur project](#struktur-project)
- [Pengujian](#pengujian)
- [Mengatasi masalah](#mengatasi-masalah)
- [Batasan](#batasan)

## Fitur

**Sumber materi**
- Ketik atau tempel teks (hingga 15.000 karakter)
- PDF hingga 10 MB / 500 halaman, dibaca langsung di browser
- OCR untuk halaman PDF hasil scan (Tesseract.js, bahasa Indonesia + Inggris)
- URL artikel web atau video YouTube (diambil transkrip/subtitle-nya)

**Cara belajar**
- **Ringkasan**: singkat, sedang, atau lengkap
- **Kuis**: 5/10/15 soal, tiga tingkat kesulitan, skor, pembahasan, dan latihan ulang soal yang salah
  - Tipe soal: pilihan ganda, benar/salah, isian singkat (toleran salah ketik kecil), esai yang dinilai AI, atau campuran
- **Flashcard** dengan *spaced repetition* (algoritma SM-2): kartu yang belum paham muncul lagi besok, yang sudah paham dijadwalkan makin jarang

**Lainnya**
- **Tanya materi**: chat yang menjawab hanya berdasarkan materi yang sedang dibuka
- **Statistik belajar**: grafik skor kuis, rata-rata skor, kartu yang perlu diulang hari ini, dan soal yang paling sering salah
- **Edit hasil AI** sebelum dipelajari
- **Export**: salin, unduh `.txt`, atau cetak / simpan sebagai PDF (kuis dilengkapi kunci jawaban)
- **Bahasa hasil**: Indonesia atau English
- **Mode gelap**: mengikuti setelan sistem, bisa diganti manual
- **Riwayat** 30 hasil terakhir beserta progres, jadwal ulang kartu, dan percakapan

## Tech stack

| Bagian | Teknologi |
|---|---|
| Frontend | HTML, CSS, JavaScript murni (tanpa framework) |
| Backend lokal | PHP 8.1+ dengan ekstensi cURL dan mbstring (`local-api/`) |
| Backend Vercel | Node.js 24 (`api/`) |
| AI | [Groq API](https://console.groq.com), model `openai/gpt-oss-20b` |
| PDF | PDF.js 5.7.284 (disertakan di `js/vendor/pdfjs`) |
| OCR | Tesseract.js 5.1.1 (diunduh dari CDN saat dibutuhkan) |
| Tes | Node test runner + Playwright |

Kedua backend punya perilaku dan format respons yang sama. Frontend memilih backend lewat atribut `data-api-url` pada tag script `js/api.js`.

## Menjalankan di komputer sendiri (Laragon / XAMPP)

1. Salin atau clone project ini ke folder web server:
   - Laragon: `C:\laragon\www\studygen`
   - XAMPP: `C:\xampp\htdocs\studygen`
2. Salin `.env.example` menjadi `.env`, lalu isi API key Groq:
   ```env
   GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxx
   ```
   API key hanya dibaca oleh backend dan tidak pernah dikirim ke browser. File `.env` sudah dikecualikan dari Git.
3. Pastikan ekstensi PHP `curl` aktif (di Laragon sudah aktif secara default).
4. Jalankan Apache: di Laragon klik **Start All**, di XAMPP klik **Start** pada Apache.
5. Buka di browser:
   - `http://localhost/studygen/`
   - atau `http://studygen.test` (Laragon, jika *auto virtual hosts* aktif)

Node.js dan npm **tidak** diperlukan untuk menjalankan aplikasi secara lokal. Keduanya hanya dipakai untuk deploy ke Vercel dan menjalankan tes.

## Cara memakai

1. **Masukkan materi.** Ketik di kolom teks, klik **Pilih file PDF**, atau tempel URL lalu klik **Ambil**. Isi PDF dan URL tidak dimasukkan ke kolom teks. Klik **Hapus PDF** / **Hapus URL** untuk kembali ke teks.
2. **Isi judul** (opsional) agar mudah ditemukan di riwayat.
3. **Pilih cara belajar** dan atur pengaturannya: panjang ringkasan, tipe soal, jumlah soal/kartu, kesulitan, dan bahasa hasil.
4. Klik **Buat bahan belajar**.

**Kuis**: jawab semua soal lalu klik **Periksa jawaban**. Jawaban esai dinilai AI (0–100); nilai 60 ke atas dihitung benar. **Ulangi soal yang salah** memulai latihan ulang tanpa memanggil AI lagi.

**Flashcard**: coba ingat jawabannya, klik **Buka jawaban**, lalu tandai:
- **Belum paham**: kartu diulang besok
- **Ragu-ragu** / **Sudah paham**: kartu dijadwalkan ulang dengan jarak yang makin panjang

Kartu yang jatuh tempo ditandai di riwayat dan di bagian statistik.

**Tanya materi**: kolom chat di bawah hasil. Jawaban hanya diambil dari materi hasil tersebut, dan percakapannya ikut tersimpan.

**Toolbar hasil**: **Salin**, **Unduh .txt**, **Cetak / PDF** (pilih "Simpan sebagai PDF" di dialog cetak), dan **Edit hasil**. Mengedit kuis akan mengulang progresnya.

### PDF yang panjang dan PDF hasil scan

- Seluruh halaman dibaca. Dokumen panjang (termasuk artikel/transkrip panjang) diringkas per bagian menjadi catatan padat, lalu catatan itu dipakai untuk membuat bahan belajar. Proses ini memakai beberapa permintaan AI, dan catatannya dipakai ulang selama lampiran yang sama masih terpasang.
- Halaman tanpa teks (hasil scan) dilaporkan, lalu bisa dibaca dengan tombol **Baca … halaman scan (OCR)**, maksimal 50 halaman per klik. Mesin OCR dan data bahasanya (beberapa MB) diunduh dari CDN jsDelivr saat tombol diklik, jadi butuh internet.
- File PDF asli tidak disimpan ke server maupun ke browser.

### Riwayat

Maksimal 30 hasil terakhir disimpan di `localStorage` browser. Riwayat tidak tersinkron antar perangkat dan bisa hilang jika data browser dihapus. Klik **Buka** untuk memulihkan materi, hasil, pengaturan, dan progres tanpa memanggil AI lagi.

## Deploy ke Vercel

1. Di Vercel pilih **Add New → Project**, lalu import repo `Yossy123/Tugas-TKIT`.
2. Gunakan **Framework Preset: Other** dan **Root Directory: `./`**. Build command (`npm run build`) dan output directory (`dist`) sudah diatur di `vercel.json`.
3. Tambahkan environment variable **`GROQ_API_KEY`** berisi API key Groq (tanpa prefix `NEXT_PUBLIC_` atau `VITE_`). Aktifkan untuk Production dan Preview bila perlu.
4. Klik **Deploy**. Jika environment variable diubah setelah deploy, lakukan **Redeploy**.

Saat build, `scripts/build.cjs` menyalin `index.html`, `css/`, dan `js/` ke `dist/`, lalu mengarahkan frontend ke `/api/generate`. Folder `dist/` tidak memuat API key, backend PHP, atau file tes. Rute lama `/api/generate.php` tetap diarahkan ke backend Node.js.

## Struktur project

```
├── index.html              Halaman utama
├── css/style.css           Tampilan, termasuk mode gelap dan tampilan cetak
├── js/
│   ├── api.js              Pemanggilan backend + coba ulang otomatis saat AI sibuk
│   ├── app.js              Input materi, PDF, URL, OCR, dan tombol generate
│   ├── interactive.js      Hasil, kuis, flashcard, edit, export, chat, riwayat
│   ├── study-core.js       Logika murni: penilaian jawaban, SM-2, teks export
│   ├── stats.js            Statistik dan grafik skor
│   ├── document.js         Pemecahan dokumen panjang menjadi catatan
│   ├── ocr.js              OCR halaman PDF hasil scan
│   ├── theme.js            Tombol mode gelap/terang
│   └── vendor/pdfjs/       PDF.js beserta lisensinya
├── local-api/              Backend PHP (Laragon/XAMPP)
│   ├── generate.php
│   └── extract.php         Pengambilan teks artikel dan transkrip YouTube
├── api/                    Backend Node.js (Vercel)
│   ├── generate.js
│   └── _lib/extract.js
├── scripts/build.cjs       Build untuk Vercel
└── tests/                  Tes unit dan tes browser
```

## Pengujian

Semua tes memakai respons AI simulasi, jadi tidak membutuhkan API key atau kredit Groq.

**Tes unit** (backend Node, penilaian jawaban, spaced repetition, ekstraksi URL):

```bash
npm test
```

**Tes browser** (membutuhkan Node.js dan PHP di PATH):

```bash
cd tests
npm install
npx playwright install chromium   # hanya pertama kali
npm test
```

Tes browser menjalankan server PHP sementara di port 18743 dan menyimpan screenshot desktop, mobile, dan mode gelap di folder `.tmp`.

## Mengatasi masalah

| Gejala | Penyebab dan solusi |
|---|---|
| "Respons server tidak valid" setelah update | Browser masih memakai file JS lama. Tekan **Ctrl+Shift+R**. |
| Generate gagal di lokal | Pastikan Apache berjalan, `.env` berisi `GROQ_API_KEY`, dan ekstensi `curl` aktif. Lihat **DevTools → Network → generate.php → Response**. |
| `AI_AUTH_FAILED` / 401 | API key ditolak Groq. Isi hanya key-nya, tanpa `GROQ_API_KEY=`, tanda kutip, atau `Bearer`, lalu redeploy. |
| `AI_ACCESS_DENIED` / 403 | Periksa izin model/organisasi di Groq. |
| `AI_MODEL_UNAVAILABLE` / 404 | Model tidak tersedia di Groq. |
| `AI_RATE_LIMITED` / 429 | Batas layanan tercapai. Aplikasi mencoba ulang otomatis maksimal dua kali. |
| URL tidak bisa diambil | Halaman butuh login, memuat isi dengan JavaScript, atau video tidak punya subtitle. Salin teksnya secara manual. |

Respons error tidak pernah menyertakan API key atau isi error mentah dari Groq.

## Batasan

- Hasil AI bisa keliru atau menghilangkan detail. Selalu periksa kembali terhadap materi asli; gunakan **Edit hasil** untuk memperbaikinya.
- Hasil OCR dan transkrip otomatis YouTube bisa mengandung salah baca/salah dengar.
- Demi keamanan, server menolak URL ke alamat lokal atau jaringan privat (misalnya `localhost` atau `192.168.x.x`).
- Riwayat dan statistik hanya tersimpan di browser yang dipakai.

> Model awal `llama-3.1-8b-instant` sudah tidak tersedia di Groq, sehingga project memakai `openai/gpt-oss-20b` sebagai penggantinya.
