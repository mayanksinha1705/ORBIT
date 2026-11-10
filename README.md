# ORBIT

ORBIT is a voice-first Chrome browser agent. You speak naturally, ORBIT
understands the request with an OpenRouter model, observes the current page, performs
controlled browser actions, and replies using Gnani Timbre text-to-speech.

ORBIT combines:

- Chrome Manifest V3 extension APIs
- Browser microphone capture with Gnani Prisma speech-to-text
- Compact DOM snapshots for reliable element targeting
- Optional viewport screenshots for visual controls
- OpenRouter model for planning and conversational replies
- Gnani Prisma for server-side speech-to-text integration
- Gnani Timbre for server-side speech synthesis
- Chrome DevTools Protocol input for difficult controls such as canvas editors

## Table of contents

- [How ORBIT works](#how-orbit-works)
- [Repository structure](#repository-structure)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running ORBIT](#running-orbit)
- [Using the extension](#using-the-extension)
- [Conversation and voice replies](#conversation-and-voice-replies)
- [Browser automation](#browser-automation)
- [Screenshots and visual interaction](#screenshots-and-visual-interaction)
- [Supported action types](#supported-action-types)
- [Backend API](#backend-api)
- [Security and privacy](#security-and-privacy)
- [Troubleshooting](#troubleshooting)
- [Testing and validation](#testing-and-validation)
- [Known limitations](#known-limitations)
- [Official references](#official-references)

## How ORBIT works

```text
Microphone
    |
    v
Floating iframe panel
    |
    +-- Gnani Prisma multilingual speech-to-text
    |
    +-- command
            |
            v
      Background service worker
            |
            +-- observe current page
            |      DOM snapshot + optional screenshot
            |
            +-- POST /api/agent/step
            |      Ollama multimodal planner
            |
            +-- validate one safe action
            |
            +-- execute action in the browser
            |
            +-- observe the result and continue
            |
            +-- LLM-generated reply
                   |
                   v
             Timbre WAV audio
                   |
                   v
             Browser playback
```

The background service worker runs an observe-plan-act-verify loop. Each
iteration receives the user instruction, current DOM observation, screenshot
when available, prior action history, and remaining action budget.

The planner returns one JSON action and a `reasoning_summary`. The summary is
the natural-language reply spoken by ORBIT. For conversational requests such
as “hello”, the planner returns a `finish` action with a conversational
summary and no browser action is performed.

The loop is bounded at 30 actions. It stops on cancellation, an explicit
execution error, a completed `finish` action, or budget exhaustion.

## Repository structure

```text
ORBIT/
├── backend/
│   ├── src/
│   │   ├── server.js                 Express API server
│   │   ├── config.js                 Environment configuration
│   │   ├── validation.js              Request and model validation
│   │   ├── services/
│   │   │   ├── prisma.js              Gnani speech-to-text adapter
│   │   │   ├── ollama.js              LLM planner and prompt
│   │   │   └── timbre.js              Gnani text-to-speech adapter
│   │   └── ...
│   ├── package.json
│   └── package-lock.json
├── extension/
│   ├── manifest.json                  Chrome MV3 manifest
│   ├── background.js                  Service worker and action loop
│   ├── content/
│   │   ├── dom.js                     Visible DOM snapshot builder
│   │   ├── executor.js                DOM action executor
│   │   └── panel.js                   Floating iframe and persistence
│   └── popup/
│       ├── index.html                 ORBIT interface
│       ├── popup.js                   Speech, TTS, and status handling
│       └── style.css                  Dark square panel styling
├── shared/
│   └── actions.js                     Shared action vocabulary
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API_INTEGRATION.md
│   ├── REFERENCE_ANALYSIS.md
│   └── TESTING.md
├── .env.example
└── README.md
```

## Requirements

Install the following before running ORBIT:

- Windows, macOS, or Linux
- Node.js 18 or newer
- npm
- Google Chrome
- LM Studio with a loaded open-weight chat model
- Gnani Prisma API access for speech-to-text
- Gnani Timbre API access for text-to-speech

Check Node and npm:

```powershell
node --version
npm --version
```

Open LM Studio, download and load an instruction-tuned open-weight model,
then start its local server. The default server URL is
`http://localhost:1234`.

## Installation

### 1. Install backend dependencies

```powershell
cd backend
npm install
```

### 2. Create the backend environment file

From the repository root:

```powershell
cd backend
Copy-Item ..\.env.example .env
```

Open `backend\.env` and set your own credentials. Never paste credentials into
source files, documentation, screenshots, issues, or chat messages.

### 3. Configure OpenRouter

Set `LLM_PROVIDER=openrouter`, `LLM_BASE_URL=https://openrouter.ai/api/v1`,
`LLM_MODEL` to the OpenRouter model identifier, and `LLM_API_KEY` to your
OpenRouter key. Keep the key only in `backend\.env`.

### 4. Load the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose:

   ```text
   extension
   ```

5. Pin ORBIT to the Chrome toolbar.

After changing extension files, select **Reload** on the ORBIT extension.
Refresh the current webpage if the content script does not update.

## Configuration

The backend reads configuration from `backend\.env`.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Local backend port |
| `ALLOWED_ORIGINS` | `chrome-extension://*` | Allowed browser extension origins |
| `GNANI_BASE_URL` | `https://api.vachana.ai` | Gnani API base URL |
| `GNANI_PRISMA_API_KEY` | empty | Prisma speech-to-text key |
| `GNANI_PRISMA_MODEL` | `prisma-v3.0` | Prisma model |
| `GNANI_PRISMA_LANGUAGE` | `indic-auto` | Automatic multilingual detection |
| `GNANI_SUPPORTED_LANGUAGES` | eight Indian language codes | Supported multilingual set |
| `LLM_PROVIDER` | `openrouter` | Planner provider |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter API URL |
| `LLM_MODEL` | `google/gemma-3-12b-it:free` | Reasoning model |
| `LLM_API_KEY` | empty | OpenRouter bearer token |
| `GNANI_TIMBRE_API_KEY` | empty | Timbre text-to-speech key |
| `GNANI_TIMBRE_MODEL` | `timbre-v2.5` | Timbre model |
| `GNANI_TIMBRE_VOICE` | `Nalini` | Timbre voice |
| `GNANI_TIMBRE_LANGUAGE` | `en-IN` | Default speech language |
| `REQUEST_TIMEOUT_MS` | `60000` | Upstream request timeout |
| `MAX_AUDIO_BYTES` | `12000000` | Maximum incoming audio payload |

Example configuration shape:

```dotenv
PORT=3000
ALLOWED_ORIGINS=chrome-extension://*
GNANI_BASE_URL=https://api.vachana.ai
GNANI_PRISMA_API_KEY=replace-with-your-prisma-key
GNANI_PRISMA_MODEL=prisma-v3.0
GNANI_PRISMA_LANGUAGE=indic-auto
GNANI_SUPPORTED_LANGUAGES=en-IN,hi-IN,bn-IN,ta-IN,te-IN,mr-IN,gu-IN,kn-IN
LLM_PROVIDER=lm-studio
LLM_BASE_URL=http://localhost:1234
LLM_MODEL=replace-with-the-loaded-lm-studio-model-id
LLM_API_KEY=
GNANI_TIMBRE_API_KEY=replace-with-your-timbre-key
GNANI_TIMBRE_MODEL=timbre-v2.5
GNANI_TIMBRE_VOICE=Nalini
GNANI_TIMBRE_LANGUAGE=en-IN
REQUEST_TIMEOUT_MS=60000
MAX_AUDIO_BYTES=12000000
```

Use separate keys for Prisma and Timbre when your Gnani account provides
separate credentials. If a key has ever been exposed, revoke it and generate a
replacement before continuing.

## Running ORBIT

Start the backend from a dedicated terminal:

```powershell
cd backend
npm start
```

Development mode automatically restarts the server after source changes:

```powershell
cd backend
npm run dev
```

Verify the server:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

Expected response shape:

```json
{
  "ok": true,
  "services": {
    "prisma": true,
    "ollama": true,
    "timbre": true
  }
}
```

The terminal running `npm start` must remain open. If the backend stops,
planning and voice replies cannot work.

## Using the extension

1. Open a normal webpage such as `https://www.google.com`.
2. Click the ORBIT toolbar icon.
3. Click the microphone **Speak** button.
4. Allow microphone access if Chrome asks.
5. Speak naturally.
6. Pause briefly so speech recognition submits the command.
7. ORBIT plans and executes the request.
8. The LLM-generated response is synthesized and played through Timbre.

The panel is a draggable, dark, square floating iframe. Its open state is
stored per tab and restored after normal page navigation. The iframe requests
microphone and autoplay permissions.

Examples:

```text
Hello
How are you?
Search Spider-Man movie trailer
Open YouTube and search for a cooking video
Open Google Docs and type this sentence
Scroll down and find the pricing section
Go back
Stop
```

To stop listening, click the cross button. Saying “stop”, “cancel”, or
“abort” requests cancellation of the active browser task.

## Conversation and voice replies

Every utterance is sent through the LLM planner. ORBIT does not use a fixed
“I’ll take care of that” reply.

For conversation:

```text
User: Hello
ORBIT: <LLM-generated conversational answer>
```

For browser work:

```text
User: Search Spider-Man movie trailer
ORBIT: <LLM-generated progress reply>
ORBIT: performs the action
ORBIT: <LLM-generated completion reply>
```

Timbre is requested with a WAV container and linear PCM configuration so the
browser can decode the returned audio. The popup first unlocks Web Audio from
the microphone button interaction, then decodes and plays the generated WAV.
An HTML audio fallback is retained for decode failures.

Voice timing is intentionally adaptive:

- Conversational `finish` responses speak immediately.
- The first action step can speak a concise LLM-generated progress reply.
- Browser execution proceeds after planning.
- Final `finish.summary` is spoken after verification.
- Repeated internal reasoning messages are not all queued for speech.

## Browser automation

### DOM-first actions

The content script observes visible interactive elements and assigns temporary
IDs such as `el_4_12`. Snapshots include:

- Element type and ARIA role
- Accessible name, title, placeholder, and visible text
- Current value
- Checked and disabled state
- Viewport rectangle
- Current snapshot generation

The executor supports controlled clicks, typing, native select changes,
scrolling, text extraction, and waits.

Element IDs are intentionally temporary. After a page mutation, ORBIT obtains
a fresh observation instead of trusting stale IDs.

### Trusted input

For canvas-based or heavily scripted interfaces, ORBIT can use the Chrome
debugger permission and DevTools Protocol commands:

- `Input.dispatchMouseEvent`
- `Input.insertText`

This supports interfaces such as Google Docs where ordinary DOM events may not
be sufficient.

### Search requests

Simple requests matching “search ...” are routed to a complete Google search
URL on the first step, preserving the requested query. For more complex
requests, Ollama plans the sequence and must verify the resulting page before
finishing.

## Screenshots and visual interaction

Before each planning step, ORBIT:

1. Observes the current page DOM.
2. Temporarily hides the floating ORBIT panel.
3. Captures the visible tab as a JPEG.
4. Restores the panel.
5. Sends the screenshot and DOM snapshot to the local Ollama backend.

Screenshots help with:

- Visually located buttons
- YouTube thumbnails and controls
- Advertisement skip buttons
- Canvas editors
- Overlays, modals, and loading states

The screenshot is not redacted by the ORBIT implementation. It can contain
visible page text, account details, messages, or other sensitive information.
Use ORBIT only on pages and tasks where sending the current viewport to your
configured Ollama service is acceptable.

## Supported action types

The shared action vocabulary is defined in `shared/actions.js`.

| Action | Purpose |
|---|---|
| `navigate` | Open a complete HTTP or HTTPS URL |
| `click` | Click an observed element or coordinate |
| `type` | Type into an observed element or coordinate |
| `scroll` | Scroll up or down |
| `extract_text` | Read bounded visible page text |
| `select_option` | Select a value in a native `<select>` |
| `wait` | Wait for a bounded duration |
| `go_back` | Navigate backward |
| `go_forward` | Navigate forward |
| `finish` | Complete the request with a spoken summary |

Actions are validated before execution. The model cannot execute JavaScript,
arbitrary CSS selectors, or unsupported action types.

## Backend API

### `GET /api/health`

Returns configuration status for Prisma, Ollama, and Timbre. It does not
perform an upstream request.

### `POST /api/agent/step`

Plans one action.

Request fields:

```json
{
  "instruction": "search Spider-Man movie trailer",
  "observation": {
    "page": { "url": "https://example.com", "title": "Example" },
    "elements": [],
    "visible_text": "",
    "generation": 1
  },
  "screenshot": "data:image/jpeg;base64,...",
  "history": [],
  "remaining_steps": 30
}
```

Response shape:

```json
{
  "action": {
    "type": "navigate",
    "url": "https://www.google.com/search?q=Spider-Man+movie+trailer"
  },
  "reasoning_summary": "I’ll search for the Spider-Man movie trailer."
}
```

### `POST /api/voice/transcribe`

Accepts an audio request body and forwards it to Gnani Prisma v3.0 with
`language_code=indic-auto`. The response includes the transcript and detected
language.

### `POST /api/voice/synthesize`

Request:

```json
{
  "text": "Hello! How can I help you?"
}
```

The response is WAV audio bytes with an `audio/wav` content type.

## Security and privacy

- Gnani credentials stay in the backend environment.
- `.env` files must never be committed.
- The extension never receives the Gnani API keys.
- The backend does not intentionally persist audio, screenshots, snapshots, or
  task history.
- Screenshots are sent to the configured Ollama service for visual reasoning.
- The extension uses a bounded action vocabulary.
- Browser actions are validated before execution.
- Consequential-action confirmation should be added before enabling purchases,
  message sending, account changes, deletion, or sensitive submissions.
- Do not use ORBIT to bypass CAPTCHAs, login protections, or human-verification
  challenges.

If a credential is exposed:

1. Revoke it immediately in the provider console.
2. Generate a replacement.
3. Update `backend\.env`.
4. Check Git history and logs for accidental exposure.

## Troubleshooting

### The extension does not open

- Confirm the extension is loaded from the `extension` directory.
- Click **Reload** in `chrome://extensions`.
- Refresh the webpage.
- Do not test on `chrome://extensions`, `chrome://settings`, or another
  restricted Chrome page.
- Check the extension service-worker errors in `chrome://extensions`.

### The panel disappears after navigation

- Reload the extension and refresh the page.
- Confirm the panel was opened from the toolbar and not closed manually.
- Check that the content script is allowed on the destination page.
- Some browser-restricted pages do not permit content scripts or iframes.

### The microphone does not work

- Use the Speak button from the ORBIT panel.
- Allow microphone access in Chrome site settings.
- Make sure another application is not exclusively using the microphone.
- Test on a normal HTTPS webpage.
- Reload the extension after changing microphone permissions.

### There is no voice reply

Check the backend first:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

Confirm:

- The backend terminal is still running.
- `timbre` reports `true`.
- The Timbre key is valid.
- Ollama returned a `reasoning_summary`.
- The browser is not muted.
- The ORBIT panel was opened by a user gesture.
- The popup status shows a playback error if audio decoding fails.

The Timbre endpoint must return a WAV-compatible response. ORBIT requests:
`linear_pcm`, `wav`, mono, 48 kHz, and 16-bit samples.

### OpenRouter does not respond

- Confirm the OpenRouter key and model ID are valid.
- Check `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY` in `backend\.env`.
- Check the backend terminal for upstream errors.
- Reduce page complexity and retry.

### The task opens a page but does not complete the request

ORBIT requires verification before returning `finish`. Speak a more specific
request, allow the page to load, and retry. For example:

```text
Search for Spider-Man movie trailer and open the matching result.
```

### Google Docs or canvas typing fails

- Keep the target visible.
- Use a precise instruction identifying the document or field.
- Allow the debugger permission when Chrome asks.
- Retry after the page has fully loaded.

### Port 3000 is already in use

Find the process:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen
```

Stop only the identified process if it belongs to ORBIT, or change `PORT` in
`backend\.env` and update the extension backend URL in `extension/background.js`.

## Testing and validation

### Syntax validation

From the repository root:

```powershell
node --check extension\background.js
node --check extension\content\dom.js
node --check extension\content\executor.js
node --check extension\content\panel.js
node --check extension\popup\popup.js
node --check backend\src\server.js
node --check backend\src\services\ollama.js
node --check backend\src\services\prisma.js
node --check backend\src\services\timbre.js
```

### Backend validation

```powershell
cd backend
npm install
npm start
```

In another terminal:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

### Manual acceptance checklist

- Load the extension unpacked.
- Open the panel on a normal webpage.
- Allow microphone access.
- Say “hello” and verify an LLM-generated voice response.
- Say “search Spider-Man movie trailer”.
- Verify the full query is preserved.
- Test navigation and panel restoration.
- Test clicking a visible button.
- Test typing into a normal input.
- Test Google Docs or another canvas-based editor.
- Test screenshot-based controls.
- Say “stop” during a long task.
- Verify invalid actions are rejected.
- Verify missing API keys produce visible errors.

Additional scenarios are documented in [docs/TESTING.md](docs/TESTING.md).

## Known limitations

- Browser MediaRecorder, microphone, and permission behavior vary by browser
  version and permission state.
- Screenshots may expose sensitive visible content to Ollama.
- The current screenshot pipeline does not perform PrivacyShield/ONNX
  redaction.
- Some pages block content scripts or embedded iframes.
- Complex single-page applications may mutate faster than a snapshot can be
  used; ORBIT re-observes, but retries may still be necessary.
- Consequential-action confirmation is not yet a complete end-user flow.
- Real Prisma, Timbre, Ollama, and full Chrome end-to-end testing require the
  corresponding services, credentials, and browser environment.

## Official references

- Gnani Speech API: https://docs.gnani.ai/api/introduction/introduction
- Gnani Prisma REST: https://docs.gnani.ai/api/STT/speech-to-text
- Gnani Prisma v3.0: https://docs.gnani.ai/api/STT/models/prisma-v3-0
- Gnani Timbre REST: https://docs.gnani.ai/api/TTS/tts-inference
- Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md
- Chrome Extensions documentation:
  https://developer.chrome.com/docs/extensions/
