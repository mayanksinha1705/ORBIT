import crypto from "node:crypto";
import { assertConfigured, config } from "../config.js";
import { withTimeout, upstreamMessage } from "../lib/signals.js";

function supportedLanguage(language) {
  const candidate = String(language || "").trim();
  return config.supportedLanguages.includes(candidate) ? candidate : config.timbreLanguage;
}

function audioContentType(audio, reportedType) {
  const type = String(reportedType || "").split(";")[0].toLowerCase();
  if (type && type !== "application/octet-stream") return type;
  if (audio.subarray(0, 4).toString("ascii") === "RIFF") return "audio/wav";
  if (audio.subarray(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (audio.subarray(0, 4).toString("ascii") === "fLaC") return "audio/flac";
  if (audio.length >= 2 && audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0) return "audio/mpeg";
  return "audio/wav";
}

export async function synthesizeSpeech({ text, language, voice, signal }) {
  assertConfigured("GNANI_TIMBRE_API_KEY", config.timbreKey);
  const response = await fetch(`${config.gnaniBaseUrl}/api/v1/tts/inference`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key-ID": config.timbreKey,
      "X-API-Request-ID": crypto.randomUUID(),
    },
    body: JSON.stringify({
      text,
      voice: voice || config.timbreVoice,
      model: config.timbreModel,
      language: supportedLanguage(language),
      speed: 1,
      audio_config: {
        encoding: "linear_pcm",
        container: "wav",
        num_channels: 1,
        sample_rate: 48000,
        sample_width: 2,
      },
    }),
    signal: withTimeout(signal, config.timeoutMs),
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let parsed = raw;
    try { parsed = JSON.parse(raw); } catch {}
    const error = new Error(`Timbre ${response.status}: ${upstreamMessage(parsed, "request failed")}`);
    error.statusCode = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw error;
  }
  const audio = Buffer.from(await response.arrayBuffer());
  return { audio, contentType: audioContentType(audio, response.headers.get("content-type")) };
}
