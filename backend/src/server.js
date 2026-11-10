import "dotenv/config";
import express from "express";
import { config } from "./config.js";
import { validatePlanRequest, requireString } from "./validation.js";
import { transcribeAudio } from "./services/prisma.js";
import { planNextAction } from "./services/ollama.js";
import { synthesizeSpeech } from "./services/timbre.js";

const app = express();
app.use(express.json({ limit: "12mb" }));

const requestCounts = new Map();
function rateLimit(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const current = requestCounts.get(key);
  if (!current || now - current.started > 60000) {
    requestCounts.set(key, { started: now, count: 1 });
    return next();
  }
  current.count += 1;
  if (current.count > 120) return res.status(429).json({ error: "Rate limit exceeded." });
  next();
}
app.use(rateLimit);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin) ||
      config.allowedOrigins.some((allowed) => allowed.endsWith("*") && origin.startsWith(allowed.slice(0, -1))))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Audio-Filename, X-Language-Code");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function requestAbort(req) {
  const controller = new AbortController();
  req.on("close", () => { if (!req.complete) controller.abort(); });
  return controller.signal;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    services: {
      prisma: Boolean(config.prismaKey),
      ollama: config.llmProvider === "lm-studio"
        ? Boolean(config.llmBaseUrl && config.llmModel)
        : config.llmProvider === "openrouter"
          ? Boolean(config.llmBaseUrl && config.llmModel && config.llmApiKey)
        : Boolean(config.ollamaBaseUrl && config.ollamaModel && config.ollamaApiKey),
      timbre: Boolean(config.timbreKey),
    },
  });
});

app.post("/api/voice/transcribe", (req, res) => {
  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size <= config.maxAudioBytes) chunks.push(chunk);
  });
  req.on("end", async () => {
    try {
      if (size > config.maxAudioBytes) return res.status(413).json({ error: "Audio payload is too large." });
      const result = await transcribeAudio({
        buffer: Buffer.concat(chunks),
        filename: req.headers["x-audio-filename"] || "recording.webm",
        contentType: req.headers["content-type"] || "audio/webm",
        languageCode: req.headers["x-language-code"] || config.prismaLanguage,
        signal: requestAbort(req),
      });
      res.json(result);
    } catch (error) {
      console.error("[transcribe]", error.message);
      res.status(error.statusCode || 502).json({ error: error.message });
    }
  });
});

app.post("/api/agent/step", async (req, res) => {
  try {
    const body = validatePlanRequest(req.body || {});
    res.json(await planNextAction(body, requestAbort(req)));
  } catch (error) {
    console.error("[agent/step]", error.message);
    res.status(error.statusCode || 502).json({ error: error.message });
  }
});

app.post("/api/voice/synthesize", async (req, res) => {
  try {
    const text = requireString(req.body?.text, "text", 4000);
    const result = await synthesizeSpeech({ text, language: req.body.language, voice: req.body.voice, signal: requestAbort(req) });
    res.setHeader("Content-Type", result.contentType);
    res.send(result.audio);
  } catch (error) {
    console.error("[synthesize]", error.message);
    res.status(error.statusCode || 502).json({ error: error.message });
  }
});

app.listen(config.port, () => console.log(`ORBIT backend listening on http://localhost:${config.port}`));
