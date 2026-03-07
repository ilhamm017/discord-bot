# Discord Bot - Quick Reference

## Running the Bot

### Discord Mode (Full Features)
```bash
npm start
# or
node index.js
```

### CLI Mode (Testing/Development)
```bash
npm run cli
# or
node cli.js
```

### Simple CLI (No Tools, Faster)
```bash
node simple_cli.js
```

## Current AI Configuration

### Models
- **Primary**: Gemma models (gemma-3n-e2b-it, gemma-3-4b-it, gemma-3-12b-it, gemma-3-27b-it)
- **Tier System**: Automatic selection based on query complexity
  - Lightweight: gemma-3n-e2b-it, gemma-3-4b-it
  - Balanced: gemma-3-4b-it, gemma-3n-e4b-it  
  - Advanced: gemma-3-12b-it
  - Premium: gemma-3-27b-it

### Known Limitations
⚠️ **Gemma models do NOT support**:
- Function calling / Tool use
- System instructions (prepended to first message instead)

For tool calling features, consider switching to Gemini models (see `docs/KNOWN_ISSUES_GEMMA.md`)

## Configuration

### Required Setup
1. Get API key from [Google AI Studio](https://aistudio.google.com/)
2. Update `config.json`:
   ```json
   {
     "google_api_key": "YOUR_API_KEY_HERE"
   }
   ```

### Model Configuration
Edit `config.json` to change model tiers:
```json
{
  "google_model_tiers": {
    "lightweight": ["gemma-3n-e2b-it", "gemma-3-4b-it"],
    "balanced": ["gemma-3-4b-it", "gemma-3n-e4b-it"],
    "advanced": ["gemma-3-12b-it"],
    "premium": ["gemma-3-27b-it"]
  },
  "google_model_default_tier": "balanced",
  "google_rate_limit_cooldown_ms": 300000
}
```

## Troubleshooting

### CLI hangs or no response
- Check if `google_api_key` is set in `config.json`
- Try `simple_cli.js` instead (bypasses controller)
- Check logs in `logs/` directory

### "Function calling not enabled" error
- This is expected for Gemma models
- Use simple queries without tool requirements
- Or switch to Gemini models in config

### Rate limit errors
- System automatically falls back to lower tier models
- Default cooldown: 5 minutes
- Adjust `google_rate_limit_cooldown_ms` in config

## File Structure
```
discord-bot/
├── cli.js                  # Full CLI with controller
├── simple_cli.js           # Simple CLI without tools
├── index.js                # Main Discord bot entry
├── config.json             # Configuration
├── functions/
│   ├── ai/
│   │   ├── completion.js         # AI API calls
│   │   ├── controller.js         # AI orchestration
│   │   ├── complexity_analyzer.js # Query complexity detection
│   │   └── model_selector.js     # Model selection logic
│   └── adapters/
│       ├── discord.js      # Discord adapter
│       └── cli.js          # CLI adapter
└── docs/
    ├── KNOWN_ISSUES_GEMMA.md
    └── README.md
```

## Development

### Testing AI without Discord
```bash
# Interactive CLI
npm run cli

# Or simple version
node simple_cli.js
```

### Checking Available Models
```bash
node -e "
const c = require('./config.json');
console.log('Tiers:', c.google_model_tiers);
"
```

### Debug Mode
Set environment variable:
```bash
DEBUG=* npm run cli
```

---
Last updated: 2026-01-26
