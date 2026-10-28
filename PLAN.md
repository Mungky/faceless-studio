# Faceless Studio — Plan v0.2 (2026-10-27)

Dokumen ini ditulis sebagai **brief untuk builder (AI/orang lain)**. Baca seluruhnya sebelum menulis kode. Keputusan di §1 sudah final, jangan diubah tanpa tanya pemilik.

Tujuan: app pribadi yang mengubah playbook (Arthur, Not Yet, Exhibit Pop) menjadi studio faceless: riset → script/hook → storyboard → VO/musik/footage → render → upload → analytics YouTube.

## 1. Keputusan final
| Area | Keputusan |
|---|---|
| Server | Home server, Docker Compose |
| Render machine | PC worker (laptop pemilik). **Render HyperFrames dan ACE-Step keduanya jalan di worker** |
| Storage binary | Google Drive, kapasitas 400 GB (rencana upgrade 2 TB), akses via rclone |
| Storage teks | Obsidian vault (markdown) |
| LLM | 9Router (self-host, endpoint OpenAI-compatible) |
| VO / SFX | ElevenLabs API langsung |
| Musik | ACE-Step di worker |
| Render video | HyperFrames (HeyGen). Bungkus di lapisan `RenderEngine` agar bisa diganti |
| Orkestrasi | n8n |
| Akses | Browser via Tailscale. SSH hanya admin |
| Bahasa/stack | TypeScript, Node ≥ 22. Web: Next.js. State/queue: PocketBase |

Default yang dipilih (ubah hanya bila pemilik minta): UI Next.js (bukan NocoDB), vault = folder `D:\Faceless Creation\projects` yang sudah ada.

## 2. Arsitektur
```
PC WORKER (laptop, Windows)               HOME SERVER (Docker)
 ├─ worker-agent (Node)             ◄──►   ├─ web      (Next.js UI + API routes)
 │   ├─ job: render  → HyperFrames         ├─ pocketbase (state, job queue, auth)
 │   ├─ job: music   → ACE-Step            ├─ n8n      (jadwal, analytics, webhook)
 │   └─ job: upscale/ffmpeg                ├─ 9router  (LLM gateway)
 ├─ rclone (Drive mount/copy)              ├─ rclone   (Drive)
 └─ Syncthing (vault)                      └─ Syncthing (vault)
        └──── Tailscale (jaringan privat) ────┘
```
Prinsip:
1. **Worker menarik job** (polling/realtime subscribe ke PocketBase). Server tidak pernah menghubungi laptop. Laptop mati = job menunggu `queued`.
2. **Sumber kebenaran:** teks = vault, status/job/metadata = PocketBase, file besar = Drive. DB menyimpan `drive_file_id` + `path`, bukan salinan file.
3. **Semua panggilan berbayar** (ElevenLabs, generator video/gambar) lewat satu service `spend-guard`: tampilkan estimasi kredit, minta konfirmasi UI, catat ke tabel `spend_log`. Tidak ada auto-spend.
4. Rahasia (API key) hanya di `.env` server dan worker, tidak pernah di vault atau git.

## 3. Struktur repo
```
studio/
  apps/web/            Next.js UI + route handler
  apps/worker/         worker-agent (Windows, jalan sebagai service/tray)
  packages/core/       tipe, skema job, spend-guard, RenderEngine interface
  packages/connectors/ elevenlabs, acestep, ninerouter, drive, youtube, higgsfield, flow
  packages/render-hyperframes/  template + adapter
  infra/docker-compose.yml, .env.example, rclone.conf.example
  docs/PLAN.md
```

## 4. Model data (PocketBase collections)
- `channels`: name, handle, niche_id, style_id, youtube_channel_id, oauth_ref
- `niches`: name, rules_md_path (di vault)
- `styles`: name, look_md_path, render_template, voice_id, music_prompt_preset
- `episodes`: channel, title, status(`idea|script|storyboard|audio|footage|render|review|published`), format(`short|long`), vault_path, drive_folder_id, youtube_video_id
- `assets`: episode, kind(`image|video|vo|sfx|bgm|music|render|thumb`), drive_file_id, drive_path, meta(json), source(`elevenlabs|acestep|higgsfield|flow|upload|render`)
- `jobs`: type(`render|music|ffmpeg|vo|image|video`), episode, payload(json), status(`queued|running|done|failed|cancelled`), worker_id, progress, log, result_asset, created/started/finished
- `analytics_snapshots`: video_id, date, metrics(json: views, retention curve, CTR, viewed_vs_swiped, avg_view_duration), source
- `diagnoses`: video_id, snapshot, findings_md, model_used
- `spend_log`: provider, units, est_cost, approved_by, job/asset ref, ts
- `model_routes`: task(`research|script|hook|diagnosis|storyboard_prompt`), 9router model/combos

## 5. Struktur Drive dan vault
Drive: `Faceless/<channel>/<episode-slug>/{stills,clips,vo,sfx,bgm,music,renders,thumb}`. Nama file: `<beat-nn>_<deskripsi>_v<k>.<ext>`.
Vault: `<channel>/<episode-slug>/{riset.md,script.md,storyboard.md,upload-pack.md}`. Playbook yang ada (Arthur.md dst.) dibaca sebagai konfigurasi prompt, bukan ditulis ulang.
Cache lokal worker: `D:\StudioCache` (hapus-aman). Jangan simpan master hanya di cache.

## 6. Modul dan perilaku
1. **Analytics** (n8n harian + tombol manual)
   - YouTube Analytics API (retention, CTR, viewed vs swiped, traffic source) + Data API v3 (metadata).
   - OAuth consent screen status **"In production"** (kalau "Testing", refresh token mati tiap 7 hari).
   - Diagnosis: kirim metrik + script episode ke LLM via 9Router, simpan `diagnoses` (titik drop-off, hook lemah, saran). Output harus menyebut timestamp dan kutipan beat script terkait.
2. **Riset**: input niche → kandidat topik + data; simpan ke `riset.md`.
3. **Script & Hook**: prompt diambil dari playbook per channel; keluarkan panjang, skor hook, skor virality. Tampilkan seluruh script sebelum lanjut ke prompt gambar.
4. **Storyboard**: tabel beat (teks VO, prompt still, durasi). Tombol generate per beat lewat connector, lewat spend-guard.
5. **Studio VO**: ElevenLabs (model v3, tag emosi), pratinjau, versi (`_v1,_v2`), simpan ke Drive + `assets`.
6. **Studio Musik**: ACE-Step sebagai job `music` di worker. Parameter: prompt, lirik, durasi, seed. Hasil naik ke Drive.
7. **Library aset**: grid per episode, filter kind, pratinjau, tandai "dipilih".
8. **Render**: job `render` memilih template HyperFrames per style, ambil aset dari Drive (cache lokal), render, upload hasil, set status `review`.
9. **Pengaturan model**: UI untuk `model_routes` + tes koneksi 9Router.
10. **Upload pack**: judul, deskripsi, tag, chapters. Upload ke YouTube **manual** (tidak ada auto-publish).

## 7. Kontrak worker-agent
- Daftar diri ke `workers` (id, hostname, kapabilitas: `render,music,ffmpeg`, gpu info), heartbeat 15 s.
- Ambil job `queued` yang kapabilitasnya cocok, set `running` secara atomik (hindari dua worker mengambil job sama).
- Stream `progress` dan `log` ke job. Gagal → `failed` + log lengkap, tidak retry otomatis lebih dari 1 kali.
- Satu job GPU pada satu waktu (ACE-Step dan render NVENC tidak jalan bersamaan).
- Hasil: upload ke Drive, buat `assets`, isi `result_asset`.

## 8. Fase dan acceptance
| Fase | Pekerjaan | Selesai bila |
|---|---|---|
| 0 Fondasi | Repo, compose (pocketbase, web, n8n, 9router), Tailscale, rclone ke Drive, auth | Dari laptop buka UI via Tailscale, file uji muncul di Drive |
| 1 Analytics | OAuth, ingest 3 channel (`@arthurtrybetter`, `@notyetstory`, Exhibit Pop), dashboard, diagnosis | Satu video punya laporan diagnosis dengan timestamp |
| 2 Pipeline | Board episode, vault sync (Syncthing), Riset + Script/Hook via 9Router | Satu episode ide → script jadi, tersimpan di vault |
| 3 Worker + render | worker-agent, `RenderEngine`, template HyperFrames untuk satu style | Satu Short ter-render dari tombol di UI |
| 4 Audio | VO ElevenLabs + job `music` ACE-Step + spend-guard | VO dan musik tersimpan, terhubung ke episode |
| 5 Storyboard & generate | Konektor gambar/video, library aset | Beat → still → klip dari UI |
| 6 Polish | Upload pack, pengaturan model, backup | Satu episode penuh end-to-end tanpa keluar app |

Fase 1 sengaja pertama: nilai baru tertinggi dan tidak bergantung ke fase lain.

## 9. Risiko dan catatan
- **HyperFrames muda** (versi 0.4.x menurut ringkasan pihak ketiga; Node ≥ 22, FFmpeg). Pin versi, uji render satu template sebelum bangun fitur lain. Remotion tidak terbukti berhenti dirawat; komposisi lama (Arthur01, MvTes) dibiarkan jalan lewat adapter, tidak ditulis ulang.
- **9Router**: hanya LLM, listing pihak ketiga; verifikasi repo `decolua/9router` sebelum dipakai. ElevenLabs/ACE-Step tidak lewat 9Router.
- **Drive 400 GB**: pasang kebijakan arsip (hapus `clips` mentah setelah episode `published` + 30 hari, simpan render akhir dan VO). Upgrade ke 2 TB setelah Fase 3 terbukti.
- **Drive API**: batas laju dan upload besar lambat → pakai rclone (resumable), bukan SDK untuk file besar.
- **Windows worker**: rclone mount butuh WinFsp; lebih aman pakai `rclone copy` ke cache daripada mount.
- **Satu GPU** dipakai ACE-Step dan render: antrean harus serial untuk job GPU.
- **Backup**: PocketBase `pb_data` dicadangkan harian ke Drive; vault sudah tersinkron dua sisi.
- **Keamanan**: hanya bind ke jaringan Tailscale, bukan internet publik.

## 10. Yang belum diketahui (builder jangan menebak, tanya pemilik)
1. Spek home server (OS, RAM, CPU). GPU tidak dibutuhkan di server.
2. Ya/tidak memakai Syncthing untuk vault, atau Obsidian Git.
3. Daftar konektor generate yang dipakai di Fase 5 (Higgsfield, Flow, lainnya) dan kebijakan batas kredit harian.

## Referensi
- HyperFrames: https://github.com/heygen-com/hyperframes
- 9Router: https://github.com/decolua/9router
