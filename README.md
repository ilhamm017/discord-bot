# Yova Discord Bot

Yova adalah bot Discord dengan fitur musik, panel kontrol, favorit lagu, dan AI (Groq) untuk chat maupun perintah yang lebih fleksibel.

## Fitur utama
- Putar musik dari YouTube/YouTube Music (judul atau URL) + playlist.
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

3. Pastikan intent Discord sudah aktif di Developer Portal:
- Message Content Intent (untuk membaca pesan).
- Server Members Intent (untuk info anggota di AI).

4. Jalankan bot:
```bash
npm start
```

Catatan: yt-dlp akan otomatis diunduh ke `.data/yt-dlp` saat pertama kali streaming.

## Daftar perintah
Semua perintah memakai prefix dari `config.json` (contoh `yova`).

### Musik
- `yova play <judul|url>`: putar lagu.
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

Daftar antrian dapat dipilih untuk memutar nomor tertentu.

## Cara kerja singkat
1. **Parsing perintah**: `index.js` membaca pesan yang diawali prefix.
2. **Routing**:
   - Jika command valid → langsung dieksekusi.
   - Jika tidak ditemukan → AI router menentukan balasan atau merutekan ke command.
3. **Streaming musik**:
   - `play` menambah antrian dan menghubungkan bot ke voice channel.
   - Audio stream dibuat via `yt-dlp` (fallback), lalu diputar lewat `@discordjs/voice`.
   - Auto-next, repeat track/playlist, serta auto-skip ketika error.
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

## Catatan penting
- Jika ada error 403 dari YouTube, biasanya berasal dari akses stream yang dibatasi. Coba ulang atau ganti sumber lagu.
- Info anggota server bergantung pada cache dan intent Discord. Jika kosong, aktifkan Server Members Intent.
