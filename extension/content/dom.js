(function () {
  const registry = new Map();
  let generation = 0;
  const selector = "a,button,input,textarea,select,[role='button'],[role='link'],[role='textbox'],[contenteditable='true'],[role='checkbox'],[role='radio'],[role='option'],[role='combobox']";

  function visible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" &&
      rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  }

  function nameOf(element) {
    return element.getAttribute("aria-label") || element.getAttribute("title") ||
      element.getAttribute("placeholder") || element.labels?.[0]?.innerText ||
      element.innerText || element.value || element.getAttribute("name") || "";
  }

  function snapshot() {
    generation += 1;
    registry.clear();
    const elements = [];
    Array.from(document.querySelectorAll(selector)).filter(visible).slice(0, 80).forEach((element, index) => {
      const id = `el_${generation}_${index + 1}`;
      const rect = element.getBoundingClientRect();
      registry.set(id, element);
      elements.push({
        id, type: element.tagName.toLowerCase(), role: element.getAttribute("role") || "",
        name: String(nameOf(element)).replace(/\s+/g, " ").trim().slice(0, 180),
        text: String(element.innerText || "").replace(/\s+/g, " ").trim().slice(0, 180),
        placeholder: element.getAttribute("placeholder") || "",
        value: element.tagName === "INPUT" || element.tagName === "TEXTAREA" ? String(element.value || "").slice(0, 120) : "",
        checked: "checked" in element ? Boolean(element.checked) : undefined,
        disabled: Boolean(element.disabled),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      });
    });
    const visibleText = String(document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 6000);
    return { page: { url: location.href, title: document.title }, elements, visible_text: visibleText, generation };
  }

  window.PAROKSH_DOM = { snapshot, get: (id) => registry.get(id), generation: () => generation };
  new MutationObserver(() => { generation += 1; registry.clear(); }).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
})();

