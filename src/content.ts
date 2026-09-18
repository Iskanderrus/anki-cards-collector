import { adapterFor } from "./capture/adapters";

declare global {
  interface Window {
    __ankiCardsCollectorLoaded?: boolean;
  }
}

if (!window.__ankiCardsCollectorLoaded) {
  window.__ankiCardsCollectorLoaded = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "CAPTURE_SELECTION") return false;

    const selection = window.getSelection();
    const draft = selection
      ? adapterFor(window.location).capture(selection, window.location, document.title)
      : null;

    sendResponse({ ok: true, draft });
    return false;
  });
}
