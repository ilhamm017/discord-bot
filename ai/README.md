# ai

Folder core AI untuk konfigurasi dasar dan orkestrasi perilaku AI.

## Isi Utama
- `completion.js`: gateway ke model (Google/Groq), format pesan, tools wiring.
- `controller.js`: agent loop, parsing output, keputusan tool call/final response.
- `tool_definitions.js`: schema tools yang boleh dipanggil model.
- `tool_handler.js`: dispatcher eksekusi tool ke layer `functions/platform`.
- `persona.js` + `persona/`: identitas, aturan operasional, dan gaya bahasa AI.
- `rate_limiter.js`, `token_calculator.js`, `model_selector.js`: kontrol performa, kuota, dan pemilihan model.
- `complexity_analyzer.js`, `tools_to_text.js`: analisis intent dan helper representasi tools.

## Tujuan
- Menjadi titik tunggal untuk pengaturan dasar AI (persona, tool-calling, policy response, rate limit, dan behavior routing).

## Provider Routing Policy
- Percakapan biasa (tanpa eksekusi tools) diprioritaskan ke Google API.
- Jika request masuk ke jalur eksekusi tools, provider diprioritaskan ke Groq.
- Jika key provider utama tidak tersedia atau provider utama gagal, sistem fallback ke provider yang tersedia.

## Batas Tanggung Jawab
- `discord/tools/ai/` tetap sebagai layer command/tools dari Discord.
- `functions/tools/ai/` tetap untuk business logic fitur AI spesifik.

## Regression Test
- Jalankan `npm run test:intent-routing` untuk memastikan routing intent/provider tetap stabil setelah perubahan regex atau scoring.
