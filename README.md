# Yova Discord Bot

Yova adalah bot Discord dengan fitur musik, panel kontrol, favorit lagu, dan AI (Groq) untuk chat maupun perintah yang lebih fleksibel.

## Fitur utama
- Putar musik dari YouTube/YouTube Music (judul atau URL) + playlist. Pencarian judul menampilkan pilihan YT/Spotify.
- Panel kontrol dengan tombol (prev/pause/next/stop/leave/shuffle/repeat/refresh) dan daftar antrian yang bisa dipilih.
- Queue otomatis tersimpan ke SQLite agar tidak hilang saat crash, dengan restore manual.
- Favorit global (1 server): lagu yang sering diputar naik ke atas dan bisa diputar lewat `yova play kesukaanku`.
- AI chat dan perintah fleksibel: `yova <pesan bebas>` bisa dijawab AI atau dirutekan ke perintah yang sesuai.
- Logging ke console + file log harian.

## Instalasi & konfigurasi
1. Install dependency:
```bash
npm install
```

2. Isi `config.json` (contoh):
```json
{
  "token": "DISCORD_BOT_TOKEN",
  "prefix": "yova",
  "groq_api_key": "GROQ_API_KEY",
  "groq_model": "llama-3.1-8b-instant",
  "groq_model_fallbacks": [
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-120b",
    "moonshotai/kimi-k2-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "qwen/qwen3-32b",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "openai/gpt-oss-20b",
    "groq/compound",
    "groq/compound-mini",
    "llama-3.1-8b-instant"
  ],
  "groq_context_messages": 6
}
```

Opsional:
- `default_voice_channel`: nama atau ID voice channel default untuk perintah `join`.
- `spotify_client_id`: Spotify Client ID (untuk resolve metadata).
- `spotify_client_secret`: Spotify Client Secret.
- `ytdlp_cookies_path`: path file cookies YouTube (untuk mengurangi "Sign in to confirm you’re not a bot").
- `search_results_limit_youtube`: jumlah hasil YouTube saat cari judul.
- `search_results_limit_spotify`: jumlah hasil Spotify saat cari judul.
- `search_select_ttl_ms`: durasi menu pilihan hasil pencarian (ms).
- `typing_delay_enabled`: aktifkan efek mengetik sebelum bot membalas.
- `typing_delay_min_ms` / `typing_delay_max_ms`: rentang delay dasar efek mengetik.
- `typing_delay_per_char_ms`: tambahan delay per karakter.
- `ai_memory_enabled`: simpan memori otomatis (preferensi ringan dari chat).
- `ai_memory_max_items`: jumlah memori yang dimasukkan ke prompt.
- `ai_memory_ttl_days`: umur maksimal memori dalam hari (0 = tidak kedaluwarsa).
- `guild_members_fetch_mode`: mode fetch member untuk AI context (`sample`, `full`, `off`).
- `guild_members_fetch_cooldown_ms`: jeda fetch member agar tidak terlalu sering.
- `channel_summary_message_limit`: jumlah pesan default untuk `ringkas`.
- `channel_summary_message_max_limit`: batas maksimal pesan yang bisa diringkas.
- `channel_summary_max_chars_per_message`: batas panjang per pesan untuk ringkasan.

3. Pastikan intent Discord sudah aktif di Developer Portal:
- Message Content Intent (untuk membaca pesan).
- Server Members Intent (untuk info anggota di AI).

4. Jalankan bot:
```bash
npm start
```

## Docker (opsional)
Pastikan `config.json` sudah terisi di host.

```bash
docker compose up -d --build
```

Data persisten:
- `./.data` untuk SQLite dan yt-dlp cache
- `./logs` untuk log harian

Cookies YouTube (opsional):
- Export cookies ke `cookies.txt`, mount ke container.
- Set `ytdlp_cookies_path` ke `/app/cookies.txt`.

Catatan: yt-dlp akan otomatis diunduh ke `.data/yt-dlp` saat pertama kali streaming.

## Daftar perintah
Semua perintah memakai prefix dari `config.json` (contoh `yova`).

### Musik
- `yova play <judul|url>`: cari lagu dan pilih hasil (YT/Spotify), atau putar langsung jika URL.
- `yova play <spotify url>`: putar lagu/playlist/album Spotify (dipetakan ke YouTube).
- `yova play kesukaanku`: putar daftar favorit global (>= 5 kali diputar).
- `yova join <nama_channel|@user|default>`: bot masuk ke voice channel.
- `yova pause`: pause/resume.
- `yova skip` / `yova next`: lewati lagu.
- `yova sebelumnya`: kembali ke lagu sebelumnya.
- `yova stop`: stop dan kosongkan antrian.
- `yova leave`: keluar dari voice channel.
- `yova kontrol`: tampilkan panel kontrol musik.
- `yova restore`: restore antrian dari database (tanpa auto-play).

### Favorit
- `yova kesukaanku`: lihat daftar favorit.
- `yova kesukaanku hapus <nomor|url>`: hapus favorit dari daftar.

### AI
- `yova ucapkan <pesan> @user`: buat pesan otomatis untuk target.
- `yova panggil aku <nama>`: simpan panggilan untuk kamu (dipakai AI).
- `yova <pesan bebas>`: AI chat atau AI merutekan ke perintah yang diizinkan.
- `yova jelaskan dirimu`: tampilkan ringkasan fitur bot.
- `yova ringkas [n]` / `yova rangkum [n]`: ringkas chat terbaru di channel.
- `yova member awal|baru|daftar|jumlah [n]`: info member server.
- `yova cek member ...`: alias untuk `member`.

Perintah yang bisa dirutekan AI: `play`, `pause`, `skip`, `next`, `sebelumnya`, `stop`, `leave`, `kontrol`, `kesukaanku`, `restore`, `ucapkan`.

## Panel kontrol musik
Panel menampilkan info lagu (judul, durasi, requester, status repeat) dan daftar antrian.
Kontrol tombol:
- Prev, Pause/Resume, Next
- Stop, Leave
- Shuffle
- Repeat lagu (loop track)
- Repeat playlist (loop all)
- Refresh panel

Daftar antrian dapat dipilih untuk memutar nomor tertentu. Jika antrian panjang, gunakan tombol Queue Prev/Next untuk pindah halaman.

## Cara kerja singkat
1. **Parsing perintah**: `index.js` membaca pesan yang diawali prefix.
2. **Routing**:
   - Jika command valid → langsung dieksekusi.
   - Jika tidak ditemukan → AI router menentukan balasan atau merutekan ke command.
3. **Streaming musik**:
   - `play` menambah antrian dan menghubungkan bot ke voice channel.
   - Audio stream dibuat via `yt-dlp` (fallback), lalu diputar lewat `@discordjs/voice`.
   - Auto-next, repeat track/playlist, serta auto-skip ketika error.
   - Link Spotify hanya dipakai sebagai metadata, playback tetap dari YouTube.
4. **Persistence**:
   - Queue dan state tersimpan di SQLite (`.data/bot.db`).
   - `restore` memuat antrian kembali tanpa langsung memutar.
5. **Favorit**:
   - Setiap lagu yang sukses diputar akan menaikkan hitungan.
   - Lagu dengan jumlah putar >= 5 muncul di `kesukaanku`.
6. **AI**:
   - `ucapkan` mengambil konteks singkat dari target untuk meniru gaya.
   - Panggilan user bisa disimpan agar AI memanggil nama tertentu.
   - Chat AI bisa membalas pertanyaan atau menjalankan command tertentu.
   - Fallback model otomatis kalau rate limit/overload (atur di `groq_model_fallbacks`).
   - AI hanya punya data member dari cache (tergantung intent).

## Logging
Log ada di console dan file `logs/bot-YYYY-MM-DD.log`.
Pengaturan:
- `LOG_LEVEL=debug|info|warn|error`
- `LOG_TO_FILE=true|false`

## Struktur folder singkat
- `commands/`: semua command bot.
- `music/`: queue, panel, voice, dan streaming.
- `storage/`: SQLite persistence.
- `utils/`: logger, Groq, AI chat.
- `docs/BOT_HELP.md`: ringkasan fitur untuk ditampilkan di chat.

## Catatan penting
- Jika ada error 403 dari YouTube, biasanya berasal dari akses stream yang dibatasi. Coba ulang atau ganti sumber lagu.
- Info anggota server bergantung pada cache dan intent Discord. Jika kosong, aktifkan Server Members Intent.
- Spotify tidak bisa diputar langsung (DRM). Bot memakai judul/artis Spotify untuk mencari lagu di YouTube.
