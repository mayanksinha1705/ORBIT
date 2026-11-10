import { validateAction } from "./actions.js";

const BACKEND = "http://localhost:3000";
const MAX_STEPS = 30;
const activeTasks = new Map();
const openPanels = new Set();
const PANEL_STORAGE_KEY = "paroksh_open_panel_tabs";
const pendingSpeech = new Map();

async function savePanelState(tabId, open) {
  const stored = await chrome.storage.session.get(PANEL_STORAGE_KEY);
  const tabs = new Set(Array.isArray(stored[PANEL_STORAGE_KEY]) ? stored[PANEL_STORAGE_KEY] : []);
  if (open) tabs.add(tabId);
  else tabs.delete(tabId);
  await chrome.storage.session.set({ [PANEL_STORAGE_KEY]: [...tabs] });
}

function emitStatus(tabId, event) {
  if (event.speech) pendingSpeech.set(tabId, event);
  chrome.runtime.sendMessage({ type: "PAROKSH_STATUS", ...event }).catch(() => {});
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "PAROKSH_TOGGLE_PANEL" });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/dom.js", "content/executor.js", "content/panel.js"],
      });
      await chrome.tabs.sendMessage(tab.id, { type: "PAROKSH_TOGGLE_PANEL" });
    } catch (error) {
      console.warn("ORBIT cannot open on this page:", error.message);
    }
  }
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active browser tab.");
  return tab;
}

async function observe(tabId) {
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: "PAROKSH_SNAPSHOT" });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Page is not ready for observation: ${lastError?.message || "content script unavailable"}`);
}

async function captureScreenshot(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId == null) return null;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PAROKSH_SET_PANEL_VISIBILITY", hidden: true }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 80));
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 78 });
  } catch (error) {
    console.warn("PAROKSH screenshot unavailable; continuing with DOM only:", error.message);
    return null;
  } finally {
    await chrome.tabs.sendMessage(tabId, { type: "PAROKSH_SET_PANEL_VISIBILITY", hidden: false }).catch(() => {});
  }
}

async function withDebugger(tabId, callback) {
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    return await callback((method, params) => chrome.debugger.sendCommand({ tabId }, method, params));
  } finally {
    try { await chrome.debugger.detach({ tabId }); } catch {}
  }
}

function actionPoint(action, observation) {
  if (Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y))) {
    return { x: Number(action.x), y: Number(action.y) };
  }
  const item = observation?.elements?.find((element) => element.id === action.element_id);
  if (!item?.rect) return null;
  return {
    x: item.rect.x + item.rect.width / 2,
    y: item.rect.y + item.rect.height / 2,
  };
}

async function executeTrusted(tabId, action, observation) {
  const point = actionPoint(action, observation);
  if (!point) throw new Error("Trusted input requires an element_id or x/y coordinates.");
  return withDebugger(tabId, async (send) => {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1,
    });
    if (action.type === "type") {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await send("Input.insertText", { text: action.value });
      return "Typed using trusted keyboard input.";
    }
    return "Clicked using trusted mouse input.";
  });
}

async function execute(tabId, action, observation) {
  if (action.type === "navigate") { await chrome.tabs.update(tabId, { url: action.url }); await new Promise((resolve) => setTimeout(resolve, 800)); await observe(tabId); return "Navigated."; }
  if (action.type === "go_back") { await chrome.tabs.goBack(tabId); return "Went back."; }
  if (action.type === "go_forward") { await chrome.tabs.goForward(tabId); return "Went forward."; }
  if (action.type === "finish") return action.summary;
  if (["click", "type"].includes(action.type) && (action.x != null || action.y != null || action.element_id)) {
    try { return await executeTrusted(tabId, action, observation); } catch (error) {
      if (!action.element_id) throw error;
    }
  }
  const result = await chrome.tabs.sendMessage(tabId, { type: "PAROKSH_EXECUTE", action });
  if (!result?.ok) throw new Error(result?.error || "Browser action failed.");
  return result.result;
}

function searchUrl(instruction) {
  const match = String(instruction).match(/^\s*(?:please\s+)?search(?:\s+for)?\s+(.+?)\s*$/i);
  return match?.[1] ? `https://www.google.com/search?q=${encodeURIComponent(match[1].trim())}` : null;
}

async function runTask(tabId, instruction, send, language) {
  const task = { cancelled: false };
  activeTasks.set(tabId, task);
  let objective = instruction;
  const history = [];
  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (task.cancelled) throw new Error("Task cancelled.");
      send({ state: "reading", step });
      const observation = await observe(tabId);
      const screenshot = await captureScreenshot(tabId);
      send({ state: "planning", step, observation });
      const response = await fetch(`${BACKEND}/api/agent/step`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: objective, observation, screenshot, history, remaining_steps: MAX_STEPS - step })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Agent planning failed.");
      const directSearch = step === 0 ? searchUrl(instruction) : null;
      if (directSearch && body.action?.type !== "finish") {
        body.action = { type: "navigate", url: directSearch };
      }
      const validation = validateAction(body.action);
      if (!validation.valid) throw new Error(validation.error);
      const spokenReply = body.reasoning_summary.trim();
      if (body.action.type === "finish") {
        send({ state: "completed", summary: body.action.summary, speech: body.action.summary || spokenReply, language });
        return body.action.summary;
      }
      if (step === 0) {
        send({ state: "speaking", step, speech: spokenReply, language });
      }
      send({ state: "executing", step, action: body.action });
      const result = await execute(tabId, body.action, observation);
      history.push({ action: body.action, result });
      if (history.length > 12) history.shift();
      send({ state: "verifying", step, result });
    }
    throw new Error("Execution budget exhausted.");
  } finally {
    activeTasks.delete(tabId);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PAROKSH_PANEL_STATE") {
    const tabId = _sender.tab?.id;
    if (tabId != null) {
      if (message.open) openPanels.add(tabId);
      else openPanels.delete(tabId);
      savePanelState(tabId, Boolean(message.open)).catch((error) =>
        console.warn("PAROKSH panel state could not be saved:", error.message));
    }
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "PAROKSH_GET_PANEL_STATE") {
    const tabId = _sender.tab?.id;
    if (tabId == null) {
      sendResponse({ open: false });
      return false;
    }
    if (openPanels.has(tabId)) {
      sendResponse({ open: true });
      return false;
    }
    chrome.storage.session.get(PANEL_STORAGE_KEY).then((stored) => {
      const open = Array.isArray(stored[PANEL_STORAGE_KEY]) && stored[PANEL_STORAGE_KEY].includes(tabId);
      if (open) openPanels.add(tabId);
      sendResponse({ open });
    }).catch(() => sendResponse({ open: false }));
    return true;
  }
  if (message.type === "PAROKSH_START") {
    activeTab().then((tab) => {
      runTask(tab.id, message.instruction, (event) => emitStatus(tab.id, event), message.language).catch((error) =>
        emitStatus(tab.id, { state: "failed", error: error.message }));
      sendResponse({ ok: true });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "PAROKSH_CANCEL") {
    activeTab().then((tab) => { const task = activeTasks.get(tab.id); if (task) task.cancelled = true; sendResponse({ ok: true }); });
    return true;
  }
  if (message.type === "PAROKSH_PANEL_READY") {
    const tabId = _sender.tab?.id;
    const event = tabId == null ? null : pendingSpeech.get(tabId);
    if (tabId != null && event) {
      pendingSpeech.delete(tabId);
      chrome.tabs.sendMessage(tabId, { type: "PAROKSH_STATUS", ...event }).catch(() => {});
    }
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "PAROKSH_TRANSCRIBE") {
    fetch(`${BACKEND}/api/voice/transcribe`, { method: "POST", headers: { "Content-Type": message.contentType, "X-Audio-Filename": message.filename, "X-Language-Code": message.languageCode || "indic-auto" }, body: Uint8Array.from(atob(message.audioBase64), (c) => c.charCodeAt(0)) })
      .then(async (response) => ({ ok: response.ok, body: await response.json().catch(() => ({ error: `Backend returned HTTP ${response.status}` })) }))
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, body: { error: `Backend unavailable: ${error.message}` } }));
    return true;
  }
  if (message.type === "PAROKSH_SYNTHESIZE") {
    fetch(`${BACKEND}/api/voice/synthesize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: message.text, language: message.language, voice: message.voice }) })
      .then(async (response) => {
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = "";
        if (response.ok) for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return {
          ok: response.ok,
          contentType: response.headers.get("content-type"),
          audioBase64: response.ok ? btoa(binary) : "",
          error: response.ok ? null : new TextDecoder().decode(bytes).slice(0, 300),
        };
      }).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete" || !openPanels.has(tabId)) return;
  setTimeout(() => chrome.tabs.sendMessage(tabId, { type: "PAROKSH_RESTORE_PANEL" }).catch(() => {}), 250);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  openPanels.delete(tabId);
  pendingSpeech.delete(tabId);
  savePanelState(tabId, false).catch(() => {});
});
