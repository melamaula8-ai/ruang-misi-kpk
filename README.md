# Ruang Misi KPK

Aplikasi React + TypeScript + Vite untuk asesmen KPK. Data kelompok, jawaban, penilaian, dan pengaturan guru disimpan di **database bersama** sehingga guru dan siswa dapat mengakses data yang sama dari perangkat berbeda. Browser (`localStorage`) hanya menjadi cache.

Seluruh tumpukan berjalan di paket gratis dan **tidak memakai API berbayar atau API key apa pun**:

| Bagian | Layanan | Catatan batas gratis |
| --- | --- | --- |
| Hosting statis | Cloudflare Pages | permintaan aset statis tidak dibatasi |
| API (`/api/sync`, `/api/teacher-auth`) | Pages Functions | memakai kuota Workers Free: 100.000 permintaan/hari |
| Database | Cloudflare D1 (SQLite) | 5 juta baris dibaca/hari, 100.000 baris ditulis/hari, 5 GB |

Batas harian di atas direset pukul 00:00 UTC. Bila batas terlampaui, kueri/permintaan gagal sampai reset, dan data lokal di browser tetap aman. Angka batas dapat berubah; cek halaman harga Cloudflare sebelum dipakai untuk banyak kelas sekaligus.

Perkiraan beban (hitungan kasar, bukan hasil uji lapangan): siswa menarik data tiap 8 detik dan guru tiap 5 detik, serta tab yang tersembunyi berhenti menarik data. Satu kelas 30 siswa selama 90 menit sekitar 20 ribuan permintaan baca, ditambah simpan otomatis tiap jeda mengetik 1 detik.

## Menjalankan UI secara lokal

1. Instal Node.js 22 atau lebih baru dan jalankan `npm install` (file `package-lock.json` perlu dibuat ulang; commit hasilnya).
2. `npm run dev` menampilkan UI di `http://localhost:3000`. Tanpa backend, aplikasi tampil dalam mode offline (data di browser saja).

## Menjalankan dengan backend lokal

1. Salin `.env.example` menjadi `.dev.vars` dan isi tiga nilainya.
2. `npm run db:migrate:local` lalu `npm run pages:dev` (Wrangler membuat D1 lokal).

## Deploy gratis ke Cloudflare Pages

1. `npx wrangler login`, lalu `npx wrangler d1 create ruang-misi-kpk`. Salin `database_id` yang muncul ke `wrangler.toml`.
2. `npm run db:migrate:remote` untuk membuat tabel di D1.
3. Buat proyek Pages (hubungkan repositori GitHub, build command `npm run build`, output `dist`) atau jalankan `npm run deploy`.
4. Pada proyek Pages, pastikan **binding D1** bernama `DB` mengarah ke database `ruang-misi-kpk`, dan isi tiga variabel `TEACHER_USERNAME`, `TEACHER_PASSWORD`, `TEACHER_SESSION_SECRET` (jenis Secret). Gunakan kredensial baru dan secret acak minimal 32 karakter. Nama menu di dashboard Cloudflare bisa sedikit berbeda dari urutan ini.
5. Buka `/api/sync` di domain situs. JSON tanpa error berarti API dan database tersambung; `503` berarti binding D1 atau migrasi belum siap.
6. Login sebagai guru dan buka dashboard lebih dulu agar ID kelompok awal dan bank soal tersimpan ke database. Setelah itu siswa dapat masuk dari perangkat lain.

## Pengujian otomatis

`npm test` menjalankan:

- `tests/sync.test.ts`: logika server pada SQLite sungguhan (login guru, hak akses, klaim ID kelompok, perlindungan nilai guru, dan penghapusan sesi yang sedang dikerjakan).
- `tests/logic.test.ts`: validasi identitas kelompok dan data empat kasus Pintu Inovator.

Tes ini memakai SQLite lokal sebagai pengganti D1, jadi belum menggantikan uji sekali jalan di Cloudflare setelah deploy.

## Perilaku penting

- **Identitas wajib.** Nama kelompok, nama sekolah, minimal 3 anggota, dan nama setiap anggota harus terisi sebelum Misi, Presentasi, atau Refleksi dapat dibuka. Kolom kosong ditandai di formulir.
- **Hapus data siswa.** Guru dapat menghapus kelompok kapan saja, termasuk yang sedang mengerjakan. Server mencatat sesi itu sebagai dihapus, melepas ID kelompoknya, dan menolak simpanan lanjutan dari perangkat siswa. Siswa melihat pemberitahuan dan diminta memasukkan ID untuk sesi baru.
- **Klaim ID kelompok atomik.** Jika dua perangkat memasukkan ID yang sama bersamaan, hanya satu yang berhasil.

## Batasan keamanan

Login guru diverifikasi di server dengan token bertanda tangan yang kedaluwarsa setelah 8 jam. Daftar kode ID kelompok dapat dibaca siapa pun yang membuka API publik (diperlukan untuk validasi ID di sisi siswa), jadi perlakukan kode seperti kata sandi kelas dan jangan menyimpan data sensitif siswa yang tidak diperlukan.
