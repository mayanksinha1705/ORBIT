import crypto from "node:crypto";
import { assertConfigured, config } from "../config.js";
import { withTimeout, upstreamMessage } from "../lib/signals.js";

export async function transcribeAudio({ buffer, filename, contentType, languageCode = config.prismaLanguage, signal }) {
  assertConfigured("GNANI_PRISMA_API_KEY", config.prismaKey);
  if (!buffer?.length) {
    const error = new Error("Audio payload is empty.");
    error.statusCode = 400;
    throw error;
  }
  const form = new FormData();
  form.append("audio_file", new Blob([buffer], { type: contentType || "audio/webm" }), filename || "recording.webm");
  form.append("language_code", languageCode);
  form.append("model", config.prismaModel);
  form.append("format", "transcribe");
  const response = await fetch(`${config.gnaniBaseUrl}/stt/v3`, {
    method: "POST",
    headers: {
      "X-API-Key-ID": config.prismaKey,
      "X-API-Request-ID": crypto.randomUUID(),
    },
    body: form,
    signal: withTimeout(signal, config.timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const error = new Error(`Prisma ${response.status}: ${upstreamMessage(payload, "request failed")}`);
    error.statusCode = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw error;
  }
  const transcript = typeof payload.transcript === "string" ? payload.transcript.trim() : "";
  return {
    transcript,
    languageCode: payload.detected_language_code || payload.language_code || (languageCode === "indic-auto" ? "en-IN" : languageCode),
    requestId: payload.request_id || null,
    model: payload.model || config.prismaModel,
  };
}
