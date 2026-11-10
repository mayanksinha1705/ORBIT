# API integration

## Prisma v3.0

The documented REST contract is:

```text
POST https://api.vachana.ai/stt/v3
X-API-Key-ID: <key>
multipart/form-data:
  audio_file
  language_code=indic-auto
  model=prisma-v3.0
  format=transcribe
```

The API accepts WAV, MP3, OGG, FLAC, AAC, and M4A clips up to 30 seconds.
`indic-auto` detects the spoken language from the configured multilingual
Prisma set. ORBIT currently supports English, Hindi, Bengali, Tamil, Telugu,
Marathi, Gujarati, and Kannada, then passes the detected language to Timbre.
The backend forwards the browser recording without exposing the API key to the
extension. Empty transcripts are returned to the UI as an explicit no-speech
result.

## Timbre v2.5

The documented REST endpoint is:

```text
POST https://api.vachana.ai/api/v1/tts/inference
X-API-Key-ID: <key>
Content-Type: application/json
{
  "text": "...",
  "voice": "Nalini",
  "model": "timbre-v2.5",
  "language": "en-IN"
}
```

The response is treated as audio bytes and passed through with its content
type. Playback errors remain a client-side error and do not claim that speech
was generated successfully.

## LM Studio reasoning

Reasoning uses LM Studio's local OpenAI-compatible chat API:

```text
POST http://localhost:1234/v1/chat/completions
{
  "model": "your-loaded-model-id",
  "Authorization": "Bearer <OLLAMA_API_KEY>",
  "stream": false,
  "response_format": { "type": "json_object" },
  "messages": [...]
}
```

The base URL and model are configurable with `LLM_BASE_URL` and
`LLM_MODEL`. The system prompt restricts output to the shared action
vocabulary, and the backend parses and validates the JSON before returning it
to the extension. Model output is never executed as code.
