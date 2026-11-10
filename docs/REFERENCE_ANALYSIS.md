# PAROKSH Reference Analysis

## Audit scope

This report records the Phase 1 read-only audit of the existing reference
project before any implementation work in `PAROKSH-Voice`.

| Item | Result |
|---|---|
| Reference project | `C:\paroksh\paroksh-SIH26171` |
| New project | `C:\paroksh\PAROKSH-Voice` |
| Paths distinct | Yes |
| Reference exists | Yes |
| Reference HEAD | `15c2acdff10399ce88eaeb291a7acb122f7761e9` |
| Reference Git status | Clean; `main...origin/main` |
| New project state at audit start | Existing empty directory |

The reference directory was inspected with read-only commands only. No
reference files, Git metadata, dependencies, or configuration were changed.

## Existing architecture

The reference project is a Chrome Manifest V3 extension with:

- `frontend/manifest.json` defining a module service worker, content scripts,
  active-tab and debugger permissions, and `<all_urls>` host access.
- `frontend/extension-core/background.js` coordinating observation, backend
  reasoning, action validation, navigation, debugger fallbacks, screenshots,
  completion checks, and a capped loop.
- `frontend/extension-core/content.js` injecting and maintaining a draggable
  in-page iframe panel and forwarding content-script requests.
- `frontend/extension-core/action-executor.js` extracting visible interactive
  controls and executing validated DOM actions.
- A React/Vite popup source in `frontend/popup-src`, with a checked-in built
  popup under `frontend/frontend`.
- An Express backend in `backend/server.js` with Ollama-specific modules under
  `backend/ollama`.
- A separate PrivacyShield pipeline under `frontend/privacy-shield`.

## Browser automation findings

### Reuse directly through copying

The following pieces are proven browser-automation candidates:

1. `frontend/extension-core/action-executor.js`
   - Builds a bounded manifest of visible interactive elements.
   - Includes native and ARIA/custom controls.
   - Assigns temporary element identifiers for the current page state.
   - Resolves identifiers against the live DOM immediately before execution.
   - Supports click, type, select, key, hover, and scroll behavior.
   - Exposes `getElementRects`, `verifyCompletion`, and `execute`.
2. The content-script message bridge in
   `frontend/extension-core/content.js`.
   - Routes `GET_ELEMENT_RECTS`, `VERIFY_COMPLETION`, and `EXECUTE_ACTION`
     requests to the executor.
   - Handles page navigation by recreating the panel after the content script
     is reloaded.
3. The browser-facing portions of
   `frontend/extension-core/background.js`.
   - Uses `chrome.tabs.update` for navigation.
   - Uses `chrome.tabs.sendMessage` for controlled DOM actions.
   - Uses debugger commands only for browser-level fallbacks.
   - Has an explicit maximum of 30 loop steps.
   - Verifies completion instead of trusting a model `DONE` response.

These files must be copied into the new project rather than edited in place.
Their model-specific, screenshot-specific, and PrivacyShield-specific parts
must be removed or adapted for the DOM-first design.

### Adapt for the new architecture

- Replace the old uppercase action vocabulary (`CLICK`, `TYPE`, `SELECT`,
  `NAVIGATE`, etc.) with the application-level schema required by PAROKSH
  Voice: `navigate`, `click`, `type`, `scroll`, `extract_text`,
  `select_option`, `wait`, `go_back`, `go_forward`, and `finish`.
- Keep the local element registry and stale-element checks, but make the
  compact DOM snapshot the primary observation payload.
- Preserve cancellation, bounded execution, duplicate-action detection,
  navigation failure handling, and completion verification.
- Rework the background service worker to call the new backend routes for
  Prisma, Ollama Gemma, and Timbre orchestration.
- Rework the panel integration around the new voice-first UI and explicit task
  states.

## DOM extraction findings

The current executor already has useful foundations:

- It filters zero-size, hidden, and off-viewport elements.
- It traverses open shadow roots.
- It considers semantic controls, ARIA roles, labels, placeholders,
  autocomplete values, and nearby field context.
- It caps the visible manifest at 50 elements.
- It resolves an element by its temporary identifier and rechecks the live
  element before acting.

The new project still needs a dedicated DOM snapshot module. It should add
page metadata, headings, visible text, accessible names, roles, element
states, stable current-page identifiers, and mutation/navigation invalidation
without sending the entire DOM to the reasoning model.

## Backend findings

The reference backend is a lightweight Express server:

- `GET /api/health`
- `POST /api/action`
- `POST /api/reply`

It accepts a large JSON body because the old workflow sends screenshots and
calls Ollama through `backend/ollama/ollama.js` and `ollama2.js`. It has no
Gnani integration, no environment-backed Gnani credentials, and permissive
default CORS. It is therefore useful as a structural reference only.

The new backend should not copy the Ollama modules or their fallback behavior.
It should provide independent service modules for:

- Prisma transcription.
- Ollama Gemma planning/step reasoning.
- Timbre synthesis.

All upstream endpoint, authentication, request, response, model, and media
format details must be verified from official Gnani documentation before
implementation. No endpoint or successful API response should be invented.

## Model and asset audit

The reference PrivacyShield assets are unrelated to the new product scope:

| Asset | Size | Observed purpose |
|---|---:|---|
| `frontend/privacy-shield/model.onnx` | 238,262,058 bytes | BERT-style NER pipeline used for sensitive-entity detection |
| `frontend/privacy-shield/retinaface_r50.onnx` | 109,110,500 bytes | Face detection used by screenshot redaction |
| `frontend/privacy-shield/vendor/onnxruntime-web/*` | ~11 MB WASM runtime | Runs the local ONNX models |
| `frontend/privacy-shield/tessdata/eng.traineddata` | 4,113,088 bytes | English OCR data |
| `frontend/privacy-shield/tessdata/hin.traineddata` | 1,122,751 bytes | Hindi OCR data |
| `frontend/privacy-shield/vendor/tesseract-core/*` | ~5.7 MB WASM | Browser OCR runtime |

`frontend/privacy-shield/pipeline.js` loads `model.onnx` for NER, Tesseract
for OCR, and `retinaface_r50.onnx` for faces. `offscreen.js` combines those
results with DOM-sensitive rectangles and paints screenshot redactions.
Because the new requirements explicitly exclude PrivacyShield, PII detection,
PII redaction, screenshot processing, and local vision models, none of these
large model assets should be copied.

## Component classification

| Reference component | Classification | Reason |
|---|---|---|
| `frontend/extension-core/action-executor.js` | Adapt | Strong DOM action implementation; remove PrivacyShield assumptions and align action schema |
| `frontend/extension-core/content.js` | Adapt | Useful panel and message bridge; replace panel contract for new UI |
| `frontend/extension-core/background.js` | Adapt | Useful browser loop and Chrome API usage; replace Ollama/screenshot orchestration |
| `frontend/manifest.json` | Adapt | MV3 baseline is useful; remove PrivacyShield resources and add only required permissions |
| `frontend/popup-src/src/*` | Adapt selectively | Reuse React/Vite patterns and suitable UI primitives, not the old product flow wholesale |
| `frontend/frontend/*` | Exclude from source reuse | Generated build output; rebuild the new extension from its own source |
| `backend/server.js` | Adapt structurally | Express routing and abort handling are useful; replace routes, security, and upstream clients |
| `backend/ollama/*` | Exclude | The reference Ollama modules are screenshot-oriented and should not be copied wholesale |
| `frontend/privacy-shield/*` | Exclude | Explicitly out of scope for PAROKSH Voice |
| `backend/temp/*` | Exclude | Generated redacted screenshots and privacy-specific temporary data |
| `README.md` | Exclude as product documentation | It describes the old PrivacyShield/Ollama product and must not be copied as-is |

## Minimum initial file set

The new project can begin with:

```text
PAROKSH-Voice/
├── extension/
│   ├── manifest.json
│   ├── background/
│   ├── content/
│   ├── dom/
│   └── automation/
├── backend/
│   └── src/
│       ├── routes/
│       ├── services/
│       ├── agent/
│       ├── middleware/
│       └── config/
├── shared/
│   ├── schemas/
│   ├── types/
│   └── constants/
├── docs/
├── .env.example
├── .gitignore
└── README.md
```

Only the selected browser automation code should be copied after its contracts
are adapted. No source file or asset has been copied during this audit.

## Open blockers and validation requirements

1. Gnani official API documentation and challenge credentials are required
   for real Prisma and Timbre calls. Ollama must have the configured Gemma
   model available.
2. Real API tests must be kept separate from mock unit tests.
3. Browser workflows require a Chrome test environment with the extension
   loaded and a reachable backend.
4. The new project must be initialized as an independent Git repository only
   inside `PAROKSH-Voice`; the reference repository must remain untouched.

## Phase 1 conclusion

The reference project provides reusable MV3 browser-control patterns, but its
core perception and reasoning path is screenshot/PrivacyShield/Ollama based.
PAROKSH Voice should retain the local controlled executor and browser message
bridge, while replacing perception with compact DOM snapshots and replacing
Ollama Gemma for reasoning alongside the verified Gnani Prisma and Timbre
integrations.
