# Troubleshooting Notes

## Ringkasan penyebab masalah
- YouTube meminta verifikasi bot, sehingga `play-dl` gagal mengambil metadata dan `yt-dlp` gagal stream tanpa cookies.
- Izin folder `logs/` dan file SQLite di `.data/` tidak sesuai dengan user yang menjalankan bot (`ubuntu`), sehingga muncul error permission.
- Resolver DNS server tidak bisa resolve domain (Temporary failure in name resolution), membuat `yt-dlp` gagal akses YouTube.
- `yt-dlp` butuh JS runtime untuk memecahkan challenge YouTube; tanpa itu format audio tidak tersedia.

## Perbaikan yang dilakukan
- Metadata: mengubah alur agar `yt-dlp` diprioritaskan, `play-dl` info jadi opt-in (env `PLAYDL_INFO=1`).
- Cookies: menambahkan dukungan cookies untuk `yt-dlp` (`YTDLP_COOKIES` atau `.data/cookies.txt`).
- Permission logs: menambah user `ubuntu` ke group `www`, set `logs/` group-writable.
- Permission DB: set `g+w` untuk `.data/bot.db`, `.data/bot.db-wal`, `.data/bot.db-shm`.
- DNS: mengatur `systemd-resolved` memakai DNS publik (1.1.1.1, 8.8.8.8) dan restart service.
- `yt-dlp` runtime/format: menambahkan `--js-runtimes node` dan default format `bestaudio/best`.

## Kenapa Docker gagal, tapi manual jalan
- Container memakai user `1000:1000` sehingga volume `logs/` dan `.data/` sering tidak writable (owner di host berbeda).
- `cookies.txt` pernah dimount `:ro`, sehingga `yt-dlp` gagal menulis cookies dan memutus proses.
- Image awal tidak menginstall `python3`, padahal `yt-dlp` membutuhkan Python.
- Setelah chmod massal, binary `.data/yt-dlp` sempat kehilangan execute bit sehingga `spawn ... EACCES`.
- Ada dua file cookie (`cookie.txt` dan `cookies.txt`) dan salah satunya di-override `yt-dlp`, membuat cookie valid tertimpa.
- Deploy manual jalan karena proses memakai user host (`ubuntu`/`www`) dengan permission yang sudah diset, Python sudah ada, dan path `yt-dlp` serta cookies bisa diakses.

## Lokasi konfigurasi dan file terkait
- Database SQLite: `.data/bot.db` (+ `-wal`, `-shm`)
- Cookies: `.data/cookies.txt` (format Netscape)
- Config DNS: `/etc/systemd/resolved.conf.d/override.conf`
- Perubahan kode:
  - `music/queue.js` (prioritas metadata dan opt-in play-dl)
  - `music/ytdlp.js` (cookies, JS runtime, format)

## Catatan operasional
- Jika kembali error permission, pastikan shell sudah mewarisi group `www` (logout/login atau `newgrp www`).
- Jika YouTube kembali meminta login, perbarui cookies dan restart bot.
- Jika streaming kembali idle, cek `yt-dlp` manual dengan cookies dan runtime `node`.
