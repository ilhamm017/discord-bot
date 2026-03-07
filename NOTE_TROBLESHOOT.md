# Analisis Permasalahan Deploy (Lokal vs Server)

## Ringkasan
Masalah di server bukan murni karena Docker. Dari log dan konfigurasi, sumber
utama adalah perbedaan lingkungan server vs lokal: reputasi IP (YouTube/Google
memblokir), stabilitas Lavalink, dan permission volume saat proses
berjalan sebagai user non-root di container. Deploy manual terasa lebih mudah
karena akses permission, instalasi paket, dan debugging menjadi lebih langsung.

## Gejala yang terlihat (dari log)
- `HTTP_403` saat streaming via yt-dlp, lalu `STREAM_FALLBACK_FAILED`.
  Ini tipikal blokir YouTube terhadap request dari server/datacenter.
- `ERR_STREAM_PREMATURE_CLOSE` dari `yt-dlp-wrap`, indikasi koneksi diputus
  atau stream dibatalkan oleh sisi YouTube.
- `LAVALINK_VOICE_NOT_CONNECTED` / `WebSocketClosedEvent 4017` berarti koneksi
  voice Lavalink gagal atau ditolak oleh Discord (E2EE/DAVE).
- `YTDLP_EXEC_FAILED` / `YTDLP_FETCH_FAILED` saat eksekusi yt-dlp gagal
  (bisa karena blokir, gagal download binary, atau permission).
- Rate limit Groq muncul terpisah (bukan isu Docker), terkait kuota API.

## Perbandingan lingkungan
### Lokal
- IP rumahan biasanya tidak terlalu diblokir oleh YouTube.
- Lavalink lokal biasanya berjalan stabil jika Java dan plugin sesuai.
- Akses file (cache, logs, download yt-dlp) tidak dibatasi ketat.

### Server
- IP datacenter lebih sering dianggap bot, memicu `HTTP_403`.
- Lingkungan minimal; Lavalink atau plugin YouTube bisa belum siap.
- Jika memakai Docker dengan `user: "1000:1000"`, host volume yang dimiliki
  root dapat membuat write gagal ke `/app/.data` dan `/app/logs`.

## Apakah karena Docker?
Docker bukan akar masalah, tapi bisa memperparah:
- **Permission volume:** Container berjalan sebagai UID 1000, sedangkan folder
  host (`./logs`, `./.data`) mungkin dimiliki root. Ini bisa memblokir penulisan
  (misalnya download yt-dlp ke `.data`).
- **Image/runtime Lavalink:** Jika image tidak rebuild atau versi Lavalink/plugin
  tidak cocok, player bisa gagal connect/play.
- **Isu YouTube:** Blokir `HTTP_403` berasal dari reputasi IP server, bukan
  dari Docker itu sendiri.

## Kenapa deploy manual terasa lebih mudah
- Permission mengikuti user yang menjalankan proses di host (lebih sederhana).
- Upgrade Lavalink/plugin bisa langsung di host tanpa rebuild image bot.
- Debugging koneksi YouTube lebih mudah (test `yt-dlp` langsung di server).

## Rekomendasi pengecekan cepat
- Pastikan Lavalink aktif, plugin YouTube terbaca, dan bot punya permission Connect/Speak.
- Pastikan folder `./.data` dan `./logs` writable oleh UID yang dipakai
  container (atau sesuaikan `user` di docker-compose).
- Uji `yt-dlp` langsung di server; jika tetap 403, gunakan cookies/proxy.
- Pertimbangkan menambahkan opsi cookies pada pemanggilan yt-dlp agar request
  terlihat seperti browser normal.
