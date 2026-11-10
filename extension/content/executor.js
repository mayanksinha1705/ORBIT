(function () {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function element(action) {
    const target = window.PAROKSH_DOM?.get(action.element_id);
    if (!target) throw new Error("Element is stale or no longer exists; observe the page again.");
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw new Error("Target element is not visible.");
    if (target.disabled) throw new Error("Target element is disabled.");
    return target;
  }
  async function execute(action) {
    if (action.type === "click") { element(action).click(); return "Clicked element."; }
    if (action.type === "type") {
      const target = element(action);
      target.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set ||
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(target, action.value); else target.value = action.value;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return "Typed value.";
    }
    if (action.type === "select_option") {
      const target = element(action);
      if (target.tagName !== "SELECT") throw new Error("select_option requires a native select element.");
      const option = Array.from(target.options).find((item) => item.value === action.value || item.text.trim() === action.value.trim());
      if (!option) throw new Error("Requested option is unavailable.");
      target.value = option.value;
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return "Selected option.";
    }
    if (action.type === "scroll") { scrollBy({ top: action.direction === "up" ? -500 : 500, behavior: "auto" }); await sleep(250); return "Scrolled page."; }
    if (action.type === "extract_text") return document.body?.innerText?.slice(0, 8000) || "";
    if (action.type === "wait") { await sleep(action.ms); return "Wait completed."; }
    throw new Error(`Unsupported content action: ${action.type}`);
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "PAROKSH_SNAPSHOT") { sendResponse(window.PAROKSH_DOM.snapshot()); return false; }
    if (message.type === "PAROKSH_EXECUTE") { execute(message.action).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message })); return true; }
    return false;
  });
})();

