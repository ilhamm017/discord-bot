# Known Issues - Gemma Model Integration

## Issue: Function Response Error dengan Gemma Models

### Deskripsi
Ketika menggunakan Gemma models (gemma-3-1b-it, gemma-3-4b-it, gemma-3-12b-it, gemma-3-27b-it) dalam conversation yang melibatkan tool calls, terjadi error:

```
Google API Error (400): Invalid JSON payload received. Unknown name "response" 
at 'contents[2].parts[0].function_response': Proto field is not repeating, cannot start list.
```

### Root Cause
1. **Gemma models TIDAK support function calling** sama sekali
2. Ketika controller melakukan tool call:
   - AI request tool (misalnya `searchWeb`)
   - Tool dieksekusi dan mengembalikan response
   - Response ditambahkan ke message history sebagai `{role: 'tool', name: 'searchWeb', content: '...'}`
   - Pada turn berikutnya, message history ini di-convert ke Google format menjadi `functionResponse`
   - Gemma model menerima `functionResponse` dalam history dan error karena tidak mengerti format ini

3. **Gemma hanya menerima role user/model**, jadi setiap jejak function call/response harus diubah menjadi teks biasa.

### Fix yang Sudah Diterapkan
- Di `ai/completion.js`, saat model Gemma:
  - `functionCall` / `functionResponse` diubah menjadi teks JSON / deskripsi tool hasil.
  - `systemInstruction` + daftar tools di-inject ke prompt pertama (manual tool calling).
  - Role `function` di-convert ke `user`.
- Hasilnya, Gemma tidak lagi menerima format `functionResponse` yang invalid.

### Dampak
- Tool calling untuk Gemma bersifat **manual**: model harus mengembalikan JSON `{ "type": "tool_call", ... }`.
- Controller akan menangani JSON tersebut dan menjalankan tool (tanpa native function calling).

### Batasan yang Masih Ada
- Gemma tetap **tidak mendukung function calling native**.
- Jika JSON tool_call yang dihasilkan model invalid, dibutuhkan guard (sudah ditambahkan di controller/tool_handler).

### Rekomendasi
- Gunakan Gemini untuk tool calling yang kompleks atau butuh format native.
- Gemma cocok untuk percakapan ringan atau tool calling sederhana via JSON manual.

### Testing (contoh)
- ✅ Query sederhana tanpa tools: **WORKS**
  ```
  > hai
  Response: "Wih, halo juga! Yova yang paling kece di sini..."
  ```

- ✅ Query yang trigger tool calls (manual JSON): **WORKS**
  ```
  > cari informasi politik terbaru
  Response: {"type":"tool_call","name":"searchWeb","arguments":{"query":"..."}}
  ```

---
**Created**: 2026-01-26  
**Status**: Mitigated (manual tool calling via prompt injection)  
**Priority**: Medium (tool-based queries require valid manual JSON tool_call output)
