// Only the local Job Tracker pages can use this bridge. No CV answers cross it.
(() => {
  const handoff =
    location.origin === "http://127.0.0.1:3333" &&
    location.pathname === "/form-fill/chrome/open";
  if (handoff) {
    const requestId = new URL(location.href).searchParams.get("requestId");
    chrome.runtime
      .sendMessage({ type: "openRequest", requestId, handoff: true })
      .catch(() => {});
    return;
  }
  window.addEventListener("message", async (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.channel !== "jobtracker-app-request" ||
      !["ping", "openRequest"].includes(event.data.type) ||
      typeof event.data.id !== "string"
    )
      return;
    let result;
    try {
      result = await chrome.runtime.sendMessage({
        type: event.data.type,
        requestId: event.data.requestId,
      });
    } catch {
      result = { ok: false };
    }
    window.postMessage(
      { channel: "jobtracker-extension-response", id: event.data.id, result },
      location.origin,
    );
  });
})();
