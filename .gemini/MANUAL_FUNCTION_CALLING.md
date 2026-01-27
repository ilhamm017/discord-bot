# Manual Function Calling untuk Model Gemma

## Masalah
Model Gemma dari Google tidak mendukung native function calling di API mereka, berbeda dengan model Gemini. Namun, bot Discord kita memerlukan function calling untuk mengakses tools seperti:
- `getRecentMessages` - untuk melihat riwayat chat
- `searchWeb` - untuk mencari informasi di internet
- `getUserMemory` - untuk mengakses memori user
- Dan 40+ tools lainnya

## Solusi: Manual Function Calling via Prompt Injection

Kami mengimplementasikan workaround dengan cara:

### 1. **Inject Tool Descriptions ke System Prompt**
Alih-alih mengirim tools dalam format native API, kita inject deskripsi tools sebagai teks ke dalam system prompt.

**File:** `functions/ai/tools_to_text.js`
```javascript
function convertToolsToTextDescription(tools) {
    // Converts tools array to human-readable text description
    // Example output:
    // --- getRecentMessages ---
    // Description: Fetch the most recent messages from a Discord text channel
    // Parameters:
    //   - channelId (REQUIRED): string - Discord channel ID
    //   - limit (optional): integer - Maximum number of items [default: 20]
}
```

### 2. **Model Returns JSON Format**
Model Gemma akan membaca deskripsi tools dan merespons dengan JSON:
```json
{
  "type": "tool_call",
  "name": "getRecentMessages",
  "arguments": {
    "channelId": "123456789",
    "limit": 10
  }
}
```

### 3. **Parser di Controller**
Controller sudah memiliki parser untuk format JSON ini:

**File:** `functions/ai/controller.js` (line 95-116)
```javascript
function parseAgentResponse(content) {
    const json = JSON.parse(content);
    if (['tool_call', 'clarify', 'final'].includes(json.type)) {
        return json;
    }
}
```

### 4. **Convert Tool Messages ke Text**
Ketika ada tool calls/responses dalam conversation history, kita convert ke format text untuk Gemma:

**File:** `functions/ai/completion.js` (line 217-253)
```javascript
// Convert function calls to text
if (part.functionCall) {
    return {
        text: JSON.stringify({
            type: "tool_call",
            name: part.functionCall.name,
            arguments: part.functionCall.args
        })
    };
}

// Convert function responses to text
if (part.functionResponse) {
    return {
        text: `Tool "${part.functionResponse.name}" returned: ${JSON.stringify(part.functionResponse.response)}`
    };
}
```

## Flow Diagram

```
User: "yova @username tadi bahas apa?"
    ↓
[Controller] Detects need for tools
    ↓
[Completion] Checks model type
    ↓
Is Gemma? → YES
    ↓
[tools_to_text] Convert tools to text description
    ↓
[Completion] Inject into system prompt
    ↓
Send to Gemma API (no native tools, just text)
    ↓
Gemma reads prompt, understands available tools
    ↓
Gemma returns: {"type": "tool_call", "name": "getRecentMessages", ...}
    ↓
[Controller] Parses JSON response
    ↓
[tool_handler] Executes getRecentMessages()
    ↓
[Controller] Sends result back to Gemma as text
    ↓
Gemma returns: {"type": "final", "message": "Tadi @username bahas tentang..."}
    ↓
User receives answer
```

## Keuntungan

1. ✅ **Tetap bisa pakai Gemma** (gratis/murah)
2. ✅ **Tidak perlu Gemini** (lebih mahal)
3. ✅ **Function calling tetap berfungsi** (via workaround)
4. ✅ **Semua tools tetap bisa digunakan** (40+ tools)
5. ✅ **Backward compatible** (Gemini tetap pakai native function calling)

## File yang Dimodifikasi

1. **`functions/ai/tools_to_text.js`** (BARU)
   - Utility untuk convert tools ke text description

2. **`functions/ai/completion.js`**
   - Import `convertToolsToTextDescription`
   - Deteksi model Gemma
   - Inject tools ke system prompt untuk Gemma
   - Convert tool messages ke text format

3. **`functions/ai/controller.js`** (TIDAK DIUBAH)
   - Sudah support parsing JSON format `{"type": "tool_call", ...}`
   - Sudah handle tool execution

## Testing

### Test 1: Query dengan Tool Calling
```
User: yova @username tadi bahas apa?
Expected: Bot menggunakan getRecentMessages untuk cek history
```

### Test 2: Query dengan Web Search
```
User: yova cari harga bitcoin terkini
Expected: Bot menggunakan searchWeb untuk cari info
```

### Test 3: Query tanpa Tools
```
User: yova halo apa kabar?
Expected: Bot langsung jawab tanpa tool calling
```

## Logs yang Diharapkan

Sebelum (ERROR):
```
[2026-01-26 21:04:23] info: Query complexity tier: premium
[2026-01-26 21:04:23] info: Attempt 1/3: Using model gemma-3-27b-it
[2026-01-26 21:04:23] warn: Model gemma-3-27b-it does not support function calling. Tools will be ignored.
[2026-01-26 21:04:33] warn: Agent produced empty reply.
```

Sesudah (SUCCESS):
```
[2026-01-26 21:14:23] info: Query complexity tier: premium
[2026-01-26 21:14:23] info: Attempt 1/3: Using model gemma-3-27b-it
[2026-01-26 21:14:23] warn: Model gemma-3-27b-it does not support systemInstruction. System prompt will be prepended to first message instead.
[2026-01-26 21:14:23] info: Model gemma-3-27b-it does not support native function calling. Using manual tool calling via prompt injection.
[2026-01-26 21:14:25] info: Tool called: getRecentMessages
[2026-01-26 21:14:26] info: Response generated successfully
```

## Troubleshooting

### Problem: Model tidak memanggil tools
**Solution:** Periksa apakah tools description ter-inject dengan benar ke system prompt. Tambahkan debug log untuk melihat prompt yang dikirim.

### Problem: Model return format salah
**Solution:** Model mungkin perlu lebih banyak contoh. Tambahkan few-shot examples ke system prompt.

### Problem: Tools description terlalu panjang
**Solution:** Filter tools berdasarkan relevance atau summarize descriptions.

## Catatan Penting

- **Gemma lebih lambat** dalam memahami tools dibanding Gemini (karena via text, bukan native)
- **Token usage lebih tinggi** (karena tools description di-inject ke setiap request)
- **Akurasi mungkin lebih rendah** (tergantung kemampuan model memahami instruksi)
- **Tetap lebih murah** daripada pakai Gemini untuk semua request

## Referensi

- [Google Gemma Models](https://ai.google.dev/gemma)
- [Gemini Function Calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Prompt Engineering for Tool Use](https://www.promptingguide.ai/techniques/tool_use)
