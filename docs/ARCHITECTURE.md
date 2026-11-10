# Architecture

```text
Microphone
   |
Extension popup -- POST /api/voice/transcribe --> Prisma
   |
   v
Background observe-plan-act-verify loop
   |                         ^
   | compact DOM snapshot + viewport screenshot
   |                         | controlled action result
   v                         |
Content DOM extractor --> Content executor
   |
   +-- POST /api/agent/step --> Ollama Gemma (multimodal)
   |
   +-- POST /api/voice/synthesize --> Timbre --> audio playback
```

The content script is the authority for page state and action execution.
Ollama receives a bounded DOM observation and the current viewport screenshot.
The screenshot is captured with the floating panel hidden, then the panel is
restored. Element IDs are scoped to a current snapshot generation and are
rejected when stale. The background loop stops after 30 actions, on
cancellation, or on an explicit execution error.

The backend keeps Gnani credentials server-side and does not persist audio,
screenshots, page snapshots, or task history. Screenshots are forwarded to the
configured Ollama service for the current reasoning step and may contain
visible page content. The current UI reports states from actual lifecycle
events rather than presenting simulated progress.
