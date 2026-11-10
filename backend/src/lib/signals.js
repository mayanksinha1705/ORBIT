// Node 18 has no AbortSignal.any (added in 20.3). Every upstream call used it,
// so on Node 18 STT, TTS and the LLM all failed instantly.
export function withTimeout(signal, ms) {
  const controller = new AbortController();
  const abort = (reason) => controller.abort(reason);
  if (signal?.aborted) abort(signal.reason);
  else signal?.addEventListener("abort", () => abort(signal.reason), { once: true });
  const timer = setTimeout(() => {
    const error = new Error(`Upstream request timed out after ${ms} ms.`);
    error.name = "TimeoutError";
    abort(error);
  }, ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller.signal;
}

// Gnani returns different error envelopes: {error:{message}}, {message}, {detail:{message}}.
export function upstreamMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload.slice(0, 300) || fallback;
  const m = payload?.error?.message ?? payload?.detail?.message ?? payload?.message ??
    (typeof payload?.error === "string" ? payload.error : null) ??
    (typeof payload?.detail === "string" ? payload.detail : null);
  return typeof m === "string" && m ? m.slice(0, 300) : fallback;
}
