(function () {
  const PANEL_ID = "paroksh-voice-panel";
  const PANEL_WIDTH = 390;
  const PANEL_HEIGHT = 465;
  const panelState = { container: null, iframe: null, handle: null, dragging: false, offsetX: 0, offsetY: 0 };

  function togglePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      existing.remove();
      panelState.container = null;
      chrome.runtime.sendMessage({ type: "PAROKSH_PANEL_STATE", open: false });
      return;
    }

    const container = document.createElement("div");
    container.id = PANEL_ID;
    Object.assign(container.style, {
      position: "fixed", top: "68px", right: "24px", width: `${PANEL_WIDTH}px`,
      height: `${PANEL_HEIGHT}px`, zIndex: "2147483647", borderRadius: "18px",
      overflow: "hidden", background: "#0b0e14", boxShadow: "0 24px 70px rgba(0,0,0,.52)",
    });
    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("popup/index.html");
    iframe.title = "ORBIT";
    iframe.allow = "microphone; autoplay";
    Object.assign(iframe.style, {
      width: "100%", height: "100%",
      border: "0",
      display: "block", background: "#0b0e14",
    });
    const handle = document.createElement("div");
    Object.assign(handle.style, {
      position: "absolute", top: "0", left: "0", width: "230px", height: "48px",
      zIndex: "2", cursor: "grab", background: "transparent",
    });
    container.append(iframe, handle);
    document.documentElement.appendChild(container);
    panelState.container = container;
    panelState.iframe = iframe;
    panelState.handle = handle;
    chrome.runtime.sendMessage({ type: "PAROKSH_PANEL_STATE", open: true });

    handle.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      const rect = container.getBoundingClientRect();
      container.style.left = `${rect.left}px`;
      container.style.top = `${rect.top}px`;
      container.style.right = "auto";
      panelState.dragging = true;
      panelState.offsetX = event.clientX - rect.left;
      panelState.offsetY = event.clientY - rect.top;
      iframe.style.pointerEvents = "none";
      handle.style.cursor = "grabbing";
      document.documentElement.style.userSelect = "none";
      document.addEventListener("mousemove", movePanel);
      document.addEventListener("mouseup", stopPanelDrag);
    });
  }

  function movePanel(event) {
    if (!panelState.dragging || !panelState.container) return;
    const left = Math.max(0, Math.min(innerWidth - PANEL_WIDTH, event.clientX - panelState.offsetX));
    const top = Math.max(0, Math.min(innerHeight - PANEL_HEIGHT, event.clientY - panelState.offsetY));
    panelState.container.style.left = `${left}px`;
    panelState.container.style.top = `${top}px`;
  }

  function stopPanelDrag() {
    panelState.dragging = false;
    if (panelState.iframe) panelState.iframe.style.pointerEvents = "auto";
    if (panelState.handle) panelState.handle.style.cursor = "grab";
    document.documentElement.style.userSelect = "";
    document.removeEventListener("mousemove", movePanel);
    document.removeEventListener("mouseup", stopPanelDrag);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== panelState.iframe?.contentWindow || event.data?.type !== "close") return;
    togglePanel();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "PAROKSH_TOGGLE_PANEL") togglePanel();
    if (message?.type === "PAROKSH_RESTORE_PANEL" && !document.getElementById(PANEL_ID)) togglePanel();
    if (message?.type === "PAROKSH_SET_PANEL_VISIBILITY" && panelState.container) {
      panelState.container.style.visibility = message.hidden ? "hidden" : "visible";
    }
  });

  chrome.runtime.sendMessage({ type: "PAROKSH_GET_PANEL_STATE" }, (state) => {
    if (state?.open && !document.getElementById(PANEL_ID)) togglePanel();
  });
})();
