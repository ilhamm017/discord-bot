# Yova Discord Bot (V2 Modular)

Yova adalah bot Discord canggih yang dibangun dengan arsitektur modular, fitur musik performa tinggi menggunakan `yt-dlp`, dan integrasi AI (Groq) untuk interaksi yang lebih natural.

## 🏗️ Arsitektur Baru
Bot ini telah direfaktor untuk memisahkan tanggung jawab kode:
- **`discord/tools/`**: Antarmuka perintah (Interaction Layer).
- **`functions/platform/`**: Logika inti interaksi API platform (Discord).
- **`functions/tools/`**: Logika bisnis "Pure" (Music engine, AI logic) yang platform-agnostic.
- **`models/`**: Integrasi database (Sequelize/SQLite).

## ✨ Fitur Utama
- **Musik Pro**: Putar dari YouTube/Spotify. Dilengkapi **Panel Kontrol Interaktif** dan sistem antrian yang persisten (tidak hilang saat bot restart).
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
- `discord/`: Berisi client, event handler, dan tools khusus Discord.
- `functions/`: Inti dari semua logika bot (Platform & Tools).
- `models/`: Definisi tabel database (SQLite).
- `storage/`: Konfigurasi database.
- `utils/`: Utility umum (Logger, AI Client, Formatting).
- `.data/`: Lokasi penyimpanan database dan binary `yt-dlp`.
- `logs/`: File log harian.

## 📝 Catatan
- **yt-dlp**: Akan otomatis diunduh ke folder `.data/` saat pertama kali fitur musik digunakan.
- **Link Spotify**: Spotify digunakan sebagai metadata; bot akan mencari audio yang paling cocok di YouTube untuk diputar.
- **AI Context**: Menggunakan pesan terbaru di channel sebagai referensi (konfigurasi di `config.json`).
