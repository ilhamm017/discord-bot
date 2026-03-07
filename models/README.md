# models

Definisi model Sequelize untuk entitas data bot.

## Isi Utama
- Model domain seperti `User`, `Guild`, `Message`, `Queue`, `Reminder`, dll.
- `index.js`: registrasi/asosiasi model.

## Aturan
- Perubahan model berpotensi memengaruhi data existing.
- Sinkronkan perubahan schema dengan mekanisme migrasi/initialization yang dipakai proyek.
