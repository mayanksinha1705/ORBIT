# Testing

## Automated checks completed

From `C:\paroksh\PAROKSH-Voice\backend`:

```powershell
npm install
```

All dependencies installed with zero reported vulnerabilities. Node syntax
checks passed for all 12 project JavaScript files. With no credentials set,
the backend started and returned:

```json
{"ok":true,"services":{"prisma":false,"ollama":true,"timbre":false}}
```

## Real API checks still required

These require credentials and must not be replaced with mocks for acceptance:

- Prisma English, Hindi, Hinglish, empty audio, timeout, and invalid-key cases.
- Ollama Gemma simple and multi-step planning, invalid JSON, unavailable elements,
  timeout, and finish responses.
- Timbre short/long text, language selection, playback, and failure cases.
- End-to-end voice -> Prisma -> Ollama Gemma -> DOM action -> verification -> Timbre.

The extension must be loaded unpacked in Chrome to test microphone permission,
DOM extraction, navigation, stale elements, cancellation, and consequential
action confirmation.
