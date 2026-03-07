# discord

Layer integrasi Discord: menangani client, event, dan command/tool yang berinteraksi langsung dengan API Discord.

## Struktur Singkat
- `client.js`, `index.js`: bootstrap client Discord.
- `events/`: handler event seperti `ready`, `messageCreate`, `interactionCreate`.
- `tools/`: command/tool yang dipanggil dari Discord.
- `player/`: integrasi player Discord (voice, queue, panel, lavalink manager).

## Batas Tanggung Jawab
- Fokus pada transport dan interaksi Discord.
- Business logic utama tetap di `functions/`.
