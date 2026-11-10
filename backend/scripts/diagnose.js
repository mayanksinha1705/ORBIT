// Run: npm run diagnose   -> live-tests STT, LLM and TTS with your real .env
import "dotenv/config";
import { config } from "../src/config.js";
import { transcribeAudio } from "../src/services/prisma.js";
import { synthesizeSpeech } from "../src/services/timbre.js";
import { planNextAction } from "../src/services/ollama.js";

const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => console.log(`  ❌ ${m}`);
console.log(`Node ${process.version}`);
let failures = 0;
async function step(name, fn) {
  console.log(`\n[${name}]`);
  try { await fn(); } catch (e) { failures++; bad(e.message); }
}

await step("TTS  Gnani Timbre", async () => {
  const r = await synthesizeSpeech({ text: "Hello from Orbit." });
  if (r.audio.length < 1000) throw new Error(`audio too small (${r.audio.length} bytes)`);
  ok(`${r.contentType}, ${r.audio.length} bytes`);
  globalThis.__wav = r.audio;
});

await step("STT  Gnani Prisma (round-trips the TTS audio)", async () => {
  if (!globalThis.__wav) throw new Error("skipped: TTS failed, no audio to send");
  const r = await transcribeAudio({
    buffer: globalThis.__wav, filename: "test.wav", contentType: "audio/wav", languageCode: "indic-auto",
  });
  ok(`transcript: "${r.transcript}" (${r.languageCode})`);
});

await step(`LLM  ${config.llmProvider} / ${config.llmModel}`, async () => {
  const r = await planNextAction({
    instruction: "hello", remaining_steps: 30, history: [],
    observation: { page: { url: "https://example.com", title: "Example" }, elements: [], visible_text: "", generation: 1 },
  });
  ok(`action=${r.action.type}, reply="${r.reasoning_summary}"`);
});

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll good.");
process.exit(failures ? 1 : 0);
