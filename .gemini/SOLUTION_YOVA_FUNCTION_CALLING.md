# Solusi Masalah Yova - Function Calling Error

## Masalah
Ketika user bertanya "yova @username tadi bahas apa?", bot mengalami error:
- Model `gemma-3-27b-it` tidak mendukung function calling
- Tools diabaikan
- searchWeb error: fetch failed
- Agent menghasilkan respons kosong

## Penyebab
1. **Model Gemma tidak mendukung function calling** - Semua model di `google_model_tiers` menggunakan Gemma, yang tidak mendukung tools/function calling
2. **Query kompleks memerlukan tools** - Pertanyaan tentang riwayat percakapan memerlukan function calling untuk mengakses database/memory
3. **searchWeb error** - Kemungkinan masalah network atau DuckDuckGo blocking

## Solusi

### 1. Update Model Tiers di config.json

Ganti model Gemma dengan model **Gemini** yang mendukung function calling:

```json
{
  "google_api_key": "YOUR_API_KEY",
  "google_model_tiers": {
    "lightweight": ["gemini-2.0-flash-exp", "gemini-1.5-flash"],
    "balanced": ["gemini-2.0-flash-exp", "gemini-1.5-flash"],
    "advanced": ["gemini-1.5-pro"],
    "premium": ["gemini-1.5-pro", "gemini-2.0-flash-exp"]
  },
  "google_rate_limit_cooldown_ms": 300000
}
```

**Penjelasan:**
- `gemini-2.0-flash-exp` - Model terbaru, cepat, dan mendukung function calling
- `gemini-1.5-flash` - Model cepat dan efisien untuk query sederhana
- `gemini-1.5-pro` - Model premium untuk query kompleks

### 2. Model yang Mendukung Function Calling

✅ **Mendukung Function Calling:**
- `gemini-1.5-pro`
- `gemini-1.5-flash`
- `gemini-2.0-flash-exp`
- `gemini-exp-1206`

❌ **TIDAK Mendukung Function Calling:**
- `gemma-3-1b-it`
- `gemma-3-4b-it`
- `gemma-3-12b-it`
- `gemma-3-27b-it`
- `gemma-3n-e2b-it`
- `gemma-3n-e4b-it`

### 3. Alternatif: Deteksi Tools dan Paksa Gemini

Jika Anda ingin tetap menggunakan Gemma untuk query sederhana, tambahkan logika untuk memaksa menggunakan Gemini ketika ada tools:

**Edit `functions/ai/complexity_analyzer.js`:**

```javascript
function analyzeComplexity(prompt, options = {}) {
    let score = 0;

    // ... kode existing ...

    // FORCE premium tier if tools are present (requires Gemini)
    if (Array.isArray(options.tools) && options.tools.length > 0) {
        logger.info('Tools detected, forcing premium tier (Gemini required)');
        return 'premium'; // Ensure Gemini is used
    }

    // ... rest of code ...
}
```

**Edit `functions/ai/model_selector.js`:**

```javascript
function selectModel(tier, config = null, requiresFunctionCalling = false) {
    if (!config) {
        config = getConfig();
    }

    const tiers = config.google_model_tiers || {
        lightweight: ["gemini-1.5-flash"],
        balanced: ["gemini-2.0-flash-exp"],
        advanced: ["gemini-1.5-pro"],
        premium: ["gemini-1.5-pro", "gemini-2.0-flash-exp"]
    };

    // If function calling is required, ensure we use Gemini models
    if (requiresFunctionCalling) {
        const geminiModels = tiers.premium || ["gemini-1.5-pro"];
        logger.info('Function calling required, using Gemini models');
        return geminiModels[0];
    }

    // ... rest of code ...
}
```

### 4. Fix searchWeb Error (Optional)

Error `fetch failed` pada searchWeb kemungkinan karena:
- Network timeout
- DuckDuckGo blocking bot requests
- SSL/TLS issues

**Tambahkan timeout dan error handling:**

```javascript
async function searchWeb(query, maxResults = 5, safeSearch = true) {
    try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            logger.warn(`DuckDuckGo returned status ${response.status}`);
            return [];
        }

        // ... rest of code ...
    } catch (error) {
        if (error.name === 'AbortError') {
            logger.error('searchWeb timeout after 10s');
        } else {
            logger.error(`Error in searchWeb: ${error.message}`);
        }
        return [];
    }
}
```

## Langkah-langkah Implementasi

1. **Update config.json** dengan model Gemini
2. **Restart bot** untuk memuat konfigurasi baru
3. **Test** dengan query yang memerlukan function calling:
   - "yova @username tadi bahas apa?"
   - "yova cari informasi tentang bitcoin"
   - "yova ingatkan saya besok jam 10"

## Verifikasi

Setelah update, log seharusnya menunjukkan:
```
[2026-01-26 21:04:23] info: Query complexity tier: premium
[2026-01-26 21:04:23] info: Attempt 1/3: Using model gemini-1.5-pro
[2026-01-26 21:04:24] info: Function calling enabled with 5 tools
[2026-01-26 21:04:25] info: Tool called: getUserMemory
[2026-01-26 21:04:26] info: Response generated successfully
```

## Catatan Penting

- **Gemini models lebih mahal** daripada Gemma, tapi mendukung function calling
- **Gemini 2.0 Flash Exp** adalah model terbaru dan paling cepat
- **Rate limits** mungkin berbeda untuk setiap model
- Pastikan **GOOGLE_API_KEY** Anda memiliki akses ke model Gemini

## Referensi

- [Google AI Gemini API Docs](https://ai.google.dev/gemini-api/docs)
- [Function Calling Guide](https://ai.google.dev/gemini-api/docs/function-calling)
- [Model Comparison](https://ai.google.dev/gemini-api/docs/models/gemini)
