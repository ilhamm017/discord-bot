# config

Folder ini disiapkan untuk konfigurasi modular tambahan (jika nanti konfigurasi dipisah dari `config.json`).

## Status Saat Ini
- Tersedia panel web konfigurasi di `config/web/`.
- Panel sekarang bisa mengelola `config.json`, upload `cookies.txt`, dan subset field penting dari `lavalink/application.yml`.

## Rekomendasi Penggunaan
- Simpan konfigurasi per domain (misalnya `music.json`, `ai.json`) bila struktur config membesar.
- Hindari menyimpan secret langsung di file yang di-commit.

## Menjalankan Panel Web
```bash
npm run config:web
```

Lalu buka `http://127.0.0.1:3210`.

## Fitur Lavalink di Panel
- Baca/simpan field Lavalink penting dari `lavalink/application.yml`.
- Tombol restart Lavalink langsung dari panel web.
- Simpan YAML membuat backup `application.backup.<timestamp>.yml`.

Opsional keamanan token:
```bash
CONFIG_WEB_TOKEN=rahasia npm run config:web
```

Jika token aktif, request simpan harus kirim header `x-config-token`.
