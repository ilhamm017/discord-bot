# Yova Discord Bot (V2 Modular)

Yova adalah bot Discord canggih yang dibangun dengan arsitektur modular, fitur musik performa tinggi menggunakan `yt-dlp`, dan integrasi AI (Groq) untuk interaksi yang lebih natural.

## 🏗️ Arsitektur Baru
Bot ini telah direfaktor untuk memisahkan tanggung jawab kode:
- **`discord/tools/`**: Antarmuka perintah (Interaction Layer).
- **`ai/`**: Core AI engine (controller, completion, tool-calling, persona).
- **`functions/platform/`**: Logika inti interaksi API platform (Discord).
- **`functions/tools/`**: Logika bisnis "Pure" (Music engine, AI logic) yang platform-agnostic.
- **`models/`**: Integrasi database (Sequelize/SQLite).

## ✨ Fitur Utama
- **Musik Pro**: Putar dari YouTube/Spotify. Dilengkapi **Panel Kontrol Interaktif** dan sistem antrian yang persisten (tidak hilang saat bot restart).
- **Engine Audio Lavalink-Only**: Playback difokuskan penuh ke Lavalink untuk konsistensi behavior queue dan panel.
- **AI Router**: Bot memahami bahasa manusia. Anda bisa memerintah bot secara natural tanpa menghafal prefix.
- **Moderasi Lengkap**: Fitur Ban, Timeout, dan Role Management yang terintegrasi dengan audit log.
- **Persona Unik**: Fitur `ucapkan` yang memungkinkan bot meniru gaya bicara member lain lewat AI.
- **Smart Summary**: Merangkum percakapan panjang di channel agar Anda tetap *up-to-date*.

## 🚀 Instalasi & Konfigurasi

1. **Install Dependency**:
   ```bash
   npm install
   ```

2. **Konfigurasi `config.json`**:
   ```json
   {
     "token": "DISCORD_BOT_TOKEN",
     "prefix": "yova",
     "groq_api_key": "GROQ_API_KEY",
     "groq_model": "llama-3.3-70b-versatile"
   }
   ```
   *Lihat `config.json.example` (jika ada) untuk opsi lengkap seperti fitur memori AI dan limit pencarian.*

3. **Pastikan Privileged Intents Aktif** di Discord Developer Portal:
   - Message Content Intent
   - Server Members Intent

4. **Jalankan Bot**:
   ```bash
   npm start
   ```

## 🐳 Docker Compose

Repo ini sudah punya `docker-compose.yml` untuk menjalankan:
- bot Yova
- panel web config di `http://127.0.0.1:3210`
- Lavalink internal yang memang otomatis dinyalakan oleh `index.js`

1. Pastikan `config.json` sudah berisi token bot dan konfigurasi dasar.
2. Opsional: set env penting sebelum start:

```bash
export CONFIG_WEB_TOKEN=rahasia-panel
export GOOGLE_API_KEY=...
export GROQ_API_KEY=...
export SPOTIFY_CLIENT_ID=...
export SPOTIFY_CLIENT_SECRET=...
```

3. Build dan jalankan:

```bash
docker compose up -d --build
```

Catatan:
- Compose ini memakai satu container aplikasi agar tombol restart Lavalink dari panel web tetap berfungsi.
- Binary Lavalink dan Java tidak lagi perlu disimpan di repo; image Docker akan mengunduh Lavalink saat build dan memakai Java dari image.
- Compose hanya bind-mount file runtime penting seperti `config.json`, `.data/`, `database.sqlite`, log, dan `lavalink/application.yml`, jadi binary Lavalink bawaan image tidak ketimpa mount host.
- Jika ingin mengunci panel web, set env `CONFIG_WEB_TOKEN` sebelum menjalankan compose.
- Setelah ada perubahan kode bot, rebuild image dengan `docker compose up -d --build`.

Perintah operasional:

```bash
docker compose logs -f yova
docker compose restart yova
docker compose down
docker compose up -d --build
```

Setelah container aktif:
- bot akan berjalan otomatis
- panel config bisa dibuka di `http://127.0.0.1:3210`
- jika `CONFIG_WEB_TOKEN` aktif, kirim header `x-config-token` dari browser client / request yang kamu pakai

Untuk melihat log realtime:

```bash
docker compose logs -f yova
```

## 🌐 Panel Konfigurasi Web (Opsional)

Untuk edit `config.json` lebih cepat (API key, prefix, parameter AI, dll), jalankan:

```bash
npm run config:web
```

Lalu buka:

```text
http://127.0.0.1:3210
```

Catatan:
- Panel ini membaca/menulis langsung ke `config.json`.
- Setiap simpan akan membuat file backup `config.backup.<timestamp>.json`.
- Banyak modul bot membaca config saat startup, jadi **restart bot** setelah perubahan penting.
- Opsional keamanan token:
  - `CONFIG_WEB_TOKEN=rahasia npm run config:web`
  - Saat aktif, panel harus kirim header `x-config-token`.

## 🛠️ Daftar Perintah (Prefix: `yova`)

### 🛡️ Moderasi & General
- `yova ping`: Cek latensi bot.
- `yova memberinfo [@member]`: Detail info profil dan role member.
- `yova addrole <role> @member`: Tambah role ke member.
- `yova removerole <role> @member`: Hapus role dari member.
- `yova ban @member [alasan]`: Ban member dari server.
- `yova timeout @member <menit>`: Kasih timeout ke member.

### 🎵 Musik
- `yova play <judul|url>`: Putar lagu (YouTube/Spotify). Menampilkan menu pilihan jika mencari judul.
- `yova play kesukaanku`: Putar playlist lagu terfavorit di server.
- `yova kontrol`: Tampilkan panel kontrol musik (tombol Play/Pause/Skip/Stop/Shuffle).
- `yova queue`: Lihat antrian lagu.
- `yova restore`: Pulihkan antrian terakhir dari database.
- `yova join | leave`: Masuk atau keluar dari voice channel.

### 🤖 AI
- `yova <pesan bebas>`: Chat dengan AI atau perintah natural.
- `yova ringkas [n]`: Rangkum `n` pesan terakhir di channel.
- `yova ucapkan <pesan> @member`: Kirim pesan AI dengan meniru gaya bicara `@member`.
- `yova panggil aku <nama>`: Simpan nama panggilan Anda untuk AI.

## 📂 Struktur Folder
- `ai/`: Inti engine AI (completion, controller, persona, tool-calling).
- `discord/`: Berisi client, event handler, dan tools khusus Discord.
- `functions/`: Logika platform + domain tools non-core AI.
- `models/`: Definisi tabel database (SQLite).
- `storage/`: Konfigurasi database.
- `utils/`: Utility umum (Logger, AI Client, Formatting).
- `.data/`: Lokasi penyimpanan database dan binary `yt-dlp`.
- `logs/`: File log harian.

## 🗺️ Mapping Folder Root
| Folder | Fungsi | Catatan |
|---|---|---|
| `.data/` | Data runtime lokal: DB SQLite internal dan binary `yt-dlp`. | Jangan commit isi folder ini ke Git.
| `.gemini/` | Catatan implementasi lama/eksperimen AI dan manual integrasi. | Bersifat dokumentasi internal.
| `ai/` | Core engine AI: completion, controller, tool schema/handler, persona, limiter. | Pusat konfigurasi dasar perilaku AI.
| `config/` | Modul konfigurasi tambahan + panel web editor untuk `config.json`. | Jalankan `npm run config:web` untuk akses UI konfigurasi.
| `discord/` | Layer integrasi Discord (client, events, tools command Discord). | Fokus ke I/O Discord, bukan business logic murni.
| `docs/` | Dokumentasi operasional dan referensi fitur bot. | Aman untuk onboarding cepat.
| `functions/` | Business logic platform dan domain tools (music, moderation, adapter, dll). | Tempat utama pengembangan fitur non-core AI.
| `lavalink/` | Komponen server audio Lavalink (jar, plugin, JRE, log lokal). | Dipakai untuk playback musik yang stabil.
| `logs/` | Log aplikasi bot (`combined`, `error`, dst). | Bisa dibersihkan berkala.
| `models/` | Definisi model Sequelize (schema domain bot). | Perubahan berdampak ke data/persistensi.
| `node_modules/` | Dependency hasil `npm install`. | Auto-generated, jangan edit manual.
| `storage/` | Inisialisasi koneksi DB dan helper persistensi level storage. | Dipakai model/fitur yang butuh database.
| `utils/` | Utility lintas modul (logger, helper AI/client, helper umum). | Hindari menaruh business logic besar di sini.

Setiap folder root penting sekarang punya `README.md` lokal untuk penjelasan cepat saat maintenance.

## 📝 Catatan
- **yt-dlp**: Akan otomatis diunduh ke folder `.data/` saat pertama kali fitur musik digunakan.
- **Link Spotify**: Spotify digunakan sebagai metadata; bot akan mencari audio yang paling cocok di YouTube untuk diputar.
- **AI Context**: Menggunakan pesan terbaru di channel sebagai referensi (konfigurasi di `config.json`).
