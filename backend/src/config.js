import process from "node:process";

const numberEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const config = Object.freeze({
  port: numberEnv("PORT", 3000),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "chrome-extension://*")
    .split(",").map((value) => value.trim()).filter(Boolean),
  gnaniBaseUrl: process.env.GNANI_BASE_URL || "https://api.vachana.ai",
  prismaKey: process.env.GNANI_PRISMA_API_KEY || "",
  prismaModel: process.env.GNANI_PRISMA_MODEL || "prisma-v3.0",
  prismaLanguage: process.env.GNANI_PRISMA_LANGUAGE || "indic-auto",
  llmProvider: (process.env.LLM_PROVIDER || "openrouter").toLowerCase(),
  llmBaseUrl: process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
  llmModel: process.env.LLM_MODEL || "google/gemma-4-31b-it",
  llmApiKey: process.env.LLM_API_KEY || "",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "gemma4:31b-cloud",
  ollamaApiKey: process.env.OLLAMA_API_KEY || "",
  timbreKey: process.env.GNANI_TIMBRE_API_KEY || "",
  timbreModel: process.env.GNANI_TIMBRE_MODEL || "timbre-v2.5",
  timbreVoice: process.env.GNANI_TIMBRE_VOICE || "Nalini",
  timbreLanguage: process.env.GNANI_TIMBRE_LANGUAGE || "en-IN",
  supportedLanguages: (process.env.GNANI_SUPPORTED_LANGUAGES ||
    "en-IN,hi-IN,bn-IN,ta-IN,te-IN,mr-IN,gu-IN,kn-IN").split(",").map((value) => value.trim()).filter(Boolean),
  timeoutMs: numberEnv("REQUEST_TIMEOUT_MS", 60000),
  maxAudioBytes: numberEnv("MAX_AUDIO_BYTES", 12000000),
});

export function assertConfigured(name, value) {
  if (!value) {
    const error = new Error(`${name} is not configured.`);
    error.statusCode = 503;
    throw error;
  }
}
