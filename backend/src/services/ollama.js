import { config } from "../config.js";
import { validateModelResponse } from "../validation.js";
import { withTimeout, upstreamMessage } from "../lib/signals.js";

const SYSTEM_PROMPT = `You are ORBIT, a browser automation planner.
Return exactly one JSON object with this shape:
{"action":{"type":"navigate","url":"https://example.com"},"reasoning_summary":"A concise, natural-language reply to speak aloud."}
For a finish action, always include the same reply in action.summary:
{"action":{"type":"finish","summary":"..."},"reasoning_summary":"..."}

Allowed action types are navigate, click, type, scroll, extract_text,
select_option, wait, go_back, go_forward, and finish.
Never return JavaScript, CSS selectors, arbitrary code, markdown, or actions
outside that list. Use element_id values from the current observation only.
For navigate, always provide a complete http:// or https:// URL in the url
field; never use value, target, or element_id for navigation.
For canvas-based editors such as Google Docs, use click or type with numeric
x and y coordinates when no usable DOM element exists. For visible page
controls, prefer element_id; coordinates are also allowed when needed.
Treat the screenshot as the current visual source of truth and use the DOM
observation as supporting metadata. If the screenshot shows a loading state,
overlay, cookie banner, modal, or popup blocking the target, handle that first
and wait for the next observation before interacting with the underlying page.
For visually positioned controls, use coordinates from the screenshot viewport;
do not guess coordinates for an element that is not visible.
The reasoning_summary is spoken to the user on every turn. Make it a concise,
natural assistant reply grounded in the current instruction, screenshot,
observation, and action; never use a generic or hard-coded acknowledgement.
Handle every kind of utterance through your own reasoning, including greetings,
thanks, casual conversation, questions, page questions, and browser commands.
For utterances that do not require changing the browser, do not interact with
the page. Return a finish action whose summary is the natural answer.
Use finish only when the observed browser state verifies the user's objective.
For multi-step requests, complete each step in order and never finish after
only navigating. For YouTube requests such as "play", "watch", or "open a
video", first ensure search results for the requested title are visible, then
click the matching visible video result or thumbnail, wait for the watch page
to load, and only finish after the video page or playback state is visible.
After typing into a search field, click the search button or press the
site's submit control; typing alone is never task completion.
For a request that says "search" followed by a query, prefer a navigate
action directly to https://www.google.com/search?q=<encoded query>, then
verify that the results page is visible. Do not navigate to Google or YouTube
without the requested query.
Reply in the same language and script the user spoke (Hindi in Devanagari,
English in English, and so on). You speak with a female voice, so always use
feminine first-person grammar in gendered languages: in Hindi say "मैं कर रही
हूँ", "मैं करूँगी", "मैंने खोल दिया", never "कर रहा हूँ" or "करूँगा"; use the
equivalent feminine forms in Marathi, Gujarati, Bengali, Tamil, Telugu and
Kannada. Keep the spoken reply to one or two short sentences.
For consequential actions such as purchases, sending messages, account changes,
deletion, or sensitive submissions, return a finish summary requesting user
confirmation instead of executing the action.`;

function modelForOllamaEndpoint() {
  const isDirectCloud = /(^|:\/\/)ollama\.com(?:\/|$)/i.test(config.ollamaBaseUrl);
  return isDirectCloud ? config.ollamaModel.replace(/-cloud$/i, "") : config.ollamaModel;
}

function getRequest() {
  if (config.llmProvider === "lm-studio" || config.llmProvider === "openrouter") {
    const baseUrl = config.llmBaseUrl.replace(/\/+$/, "");
    return {
      url: `${baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`}/chat/completions`,
      headers: {
        "Content-Type": "application/json",
        ...(config.llmApiKey ? { Authorization: `Bearer ${config.llmApiKey}` } : {}),
        ...(config.llmProvider === "openrouter" ? {
          "HTTP-Referer": "https://github.com/mayanksinha1705/paroksh-privacy-shield-SIH26171",
          "X-Title": "ORBIT",
        } : {}),
      },
      body: {
        model: config.llmModel,
        stream: false,
        response_format: { type: "json_object" },
        temperature: 0.1,
        // Gemma 4 is a thinking model: with max_tokens=300 the budget was spent
        // on hidden reasoning and "content" came back empty.
        max_tokens: 1024,
        ...(config.llmProvider === "openrouter" ? { reasoning: { enabled: false } } : {}),
      },
    };
  }
  return {
    url: `${config.ollamaBaseUrl.replace(/\/+$/, "")}/api/chat`,
    headers: {
      "Content-Type": "application/json",
      ...(config.ollamaApiKey ? { Authorization: `Bearer ${config.ollamaApiKey}` } : {}),
    },
    body: {
      model: modelForOllamaEndpoint(),
      stream: false,
      format: "json",
      options: { temperature: 0.1, num_predict: 300 },
    },
  };
}

function parseModelJson(content) {
  if (Array.isArray(content)) content = content.map((part) => part?.text || "").join("");
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LLM returned an empty response (a thinking model may have used all tokens on reasoning).");
  }
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Models sometimes wrap the object in prose; grab the outermost {...}.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
    }
    throw new Error(`LLM returned invalid JSON: ${cleaned.slice(0, 120)}`);
  }
}

function normalizeModelResponse(response) {
  const action = response?.action;
  if (!action || typeof action !== "object") return response;
  if (action.type === "type" && typeof action.value !== "string") {
    const candidate = [action.text, action.query, action.input].find((value) => typeof value === "string");
    if (candidate != null) return { ...response, action: { ...action, value: candidate } };
  }
  if (action.type === "finish" && typeof action.summary !== "string" &&
      typeof response.reasoning_summary === "string" && response.reasoning_summary.trim()) {
    return {
      ...response,
      action: { ...action, summary: response.reasoning_summary.trim() },
    };
  }
  if (action.type !== "navigate" || typeof action.url === "string") return response;
  const candidate = [action.value, action.target].find((value) =>
    typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim())
  );
  return candidate
    ? { ...response, action: { ...action, url: candidate.trim() } }
    : response;
}

export async function planNextAction(input, signal) {
  const userMessage = {
    role: "user",
    content: JSON.stringify({ ...input, screenshot: undefined }),
  };
  if (typeof input?.screenshot === "string" && input.screenshot.length > 0) {
    userMessage.images = [input.screenshot.replace(/^data:image\/[^;]+;base64,/i, "")];
  }
  const request = getRequest();
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    userMessage,
  ];
  if ((config.llmProvider === "lm-studio" || config.llmProvider === "openrouter") &&
      userMessage.images) {
    userMessage.content = [
      { type: "text", text: userMessage.content },
      ...userMessage.images.map((image) => ({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${image}` },
      })),
    ];
    delete userMessage.images;
  }
  const signalForCall = withTimeout(signal, config.timeoutMs);
  const call = (body) => fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({ ...body, messages }),
    signal: signalForCall,
  });
  let response = await call(request.body);
  let payload = await response.json().catch(() => null);
  // Some OpenRouter providers reject response_format / reasoning params: retry bare.
  if (response.status === 400 || response.status === 404) {
    const { response_format, reasoning, ...bare } = request.body;
    const retry = await call(bare);
    if (retry.ok) { response = retry; payload = await retry.json().catch(() => null); }
  }
  if (!response.ok) {
    const error = new Error(`LLM ${response.status}: ${upstreamMessage(payload, "request failed")}`);
    error.statusCode = 502;
    throw error;
  }
  if (payload?.error) {
    const error = new Error(`LLM error: ${upstreamMessage(payload, "unknown")}`);
    error.statusCode = 502;
    throw error;
  }
  const content = config.llmProvider === "lm-studio" || config.llmProvider === "openrouter"
    ? payload?.choices?.[0]?.message?.content
    : payload?.message?.content;
  const modelOutput = normalizeModelResponse(parseModelJson(content));
  return validateModelResponse(modelOutput);
}
