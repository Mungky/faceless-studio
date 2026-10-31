# Channel, Studio, dan FYP

Versi ini mengganti halaman utama lama dengan tiga tujuan: Channel, Studio, FYP.
File playbook asal dan proyek video lama tetap dipertahankan.

## Menggunakan app

1. Buka Channel untuk memilih akun. Profil, subscriber, total views, dan banner berasal
   dari data YouTube tersimpan. Nilai yang belum tersedia ditampilkan sebagai tanda pisah.
2. Dalam channel tersedia Analytics, Produksi, Laporan agent, dan Pengaturan. Kalender
   Analytics berisi tanggal upload/publikasi yang benar-benar tercatat. Target produksi
   ditampilkan terpisah di tab Produksi.
3. Pilih template default dan beberapa jam target di Pengaturan channel. Pemilihan
   template lain pada satu episode tidak mengganti default channel.
4. Di Studio, gunakan Riset otomatis, Punya ide, atau Naskah sendiri. Naskah manual
   disimpan persis, lalu menunggu review. Unggah naskah menerima Markdown atau teks.
5. Tombol Edit template menyimpan isi versi baru di database. Episode yang sudah ada
   menyimpan snapshot template, arahan, dan isi playbook sebelumnya.
6. Editor episode menampilkan lima tahap serta percakapan arahan. Simpan perubahan
   sebelum berpindah tahap. Riwayat memulihkan versi lama ke editor sebelum disimpan.
7. Tahap storyboard menghasilkan beat dari naskah yang disetujui. Buat komposisi animasi,
   antrekan frame asli di PC render, review frame, lalu antrekan render. Versi komposisi
   dan sumber naskah diperiksa sebelum pekerjaan berjalan.
8. FYP menelusuri kompetitor manual, channel serupa, dan niche. Simpan referensi untuk
   evaluasi berikutnya. Views yang belum diverifikasi tetap kosong. Isi sumber dapat
   dibaca melalui Obscura yang terhubung.
9. Evaluasi video tersedia untuk seluruh upload, termasuk video tanpa episode Studio.
   Laporan membedakan fakta, hipotesis, rekomendasi, serta keterbatasan. Bila bukti cukup
   dan model evaluasi tersedia, usulan perubahan template disiapkan untuk disetujui.

## Koneksi dan proses otomatis

API Google dan koneksi setiap akun berada dalam Pengaturan channel. Pengaturan model
dan batas biaya digunakan bersama oleh semua channel. SearXNG dan Obscura merupakan
layanan server; status konfigurasinya ditampilkan di pengaturan.

- SEARXNG_URL harus mendukung /search?format=json. Aktifkan format JSON di SearXNG.
- OBSCURA_MCP_URL menunjuk bridge MCP HTTP yang dikonfigurasi operator. App melakukan
  initialize dan tools/list, lalu memakai OBSCURA_READ_TOOL (default browse_page)
  dengan URL dan format yang benar-benar didukung. App tidak memasang bridge otomatis.
- Rute research gratis yang dikonfirmasi diperlukan untuk riset terjadwal. Model
  berbayar tetap memakai estimasi dan persetujuan. Evaluasi otomatis memakai rute
  diagnosis gratis; jika belum tersedia, laporan berbasis bukti tetap tersedia.
- Rute composition menghasilkan kode animasi lengkap dari template yang dikunci.
  Kode disimpan per versi di database, tanpa menimpa proyek render lama.
- PocketBase memicu /api/automation/tick setiap lima menit. STUDIO_WEB_INTERNAL_URL
  digunakan dari container PocketBase menuju web; jika kosong memakai APP_URL.
  Kedua proses harus memakai AUTOMATION_TOKEN yang sama.
- STUDIO_AUTOMATION_DISABLED=1 menghentikan pemicu otomatis saat preview/pengujian.
- Antrean menyimpan kunci per channel/tanggal/jam lokal. Klaim database bersifat atomik.
  Proses yang terputus ditandai blocked, tanpa mengulang permintaan provider ambigu.
- Sinkronisasi harian memproses upload publik secara bertahap, mengutamakan yang belum
  memiliki laporan. API dapat membatasi atau menunda metrik tertentu.

Server menjalankan riset, naskah, sinkronisasi, dan evaluasi. Worker Windows menarik
pekerjaan berat: frame storyboard, audio/media yang didukung, animasi, render, dan QC.
Drive perlu dikonfigurasi agar cache bukan satu-satunya salinan hasil. PC offline
meninggalkan pekerjaan di antrean. Publikasi tetap dilakukan secara manual.

## Validasi

npm run typecheck; npm test; npm run test:integration; npm run build.
npm run test:workspace menjalankan browser terpisah dan database/vault fixture sementara.
npm run test:code-render mengambil dua frame komposisi berbeda lalu memverifikasi render
1080×1920, 24 fps, dan durasi dengan ffprobe. Pengujian ini tidak memakai provider berbayar.

Pengujian model, OAuth akun nyata, kualitas gaya Arthur/Not Yet/Briking Nius dari model,
Obscura deployment, dan Drive antar-PC memerlukan layanan tersebut benar-benar terhubung.
Hasil fixture tidak menjadi data produksi atau klaim kualitas video dari model.
