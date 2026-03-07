# functions

Pusat business logic bot yang bersifat platform-agnostic.

## Struktur Singkat
- `music/`: logika pencarian/operasi musik.
- `tools/`: implementasi fitur per domain (music, ai, member logic, dll).
- `adapters/`: adapter untuk penghubung ke interface (CLI/Discord).
- `utils/`: util internal untuk layer functions.

## Catatan AI
- Core AI sudah dipindah ke folder root `ai/` agar konfigurasi dasar AI terpusat.

## Aturan
- Letakkan logika inti di sini, bukan di layer transport (`discord/`).
- Buat modul per domain agar mudah diuji dan dipelihara.
