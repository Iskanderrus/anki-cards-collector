import { repository } from "./storage/repository";
import { loadSettings } from "./settings";
import type { CaptureDraft } from "./core/types";

type CaptureResponse = { ok: true; draft: CaptureDraft | null } | { ok: false; error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Capture failed.";
}

async function collectFromTab(tabId: number, language: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });

  const response = await chrome.tabs.sendMessage(tabId, {
    type: "CAPTURE_SELECTION",
  }) as CaptureResponse;

  if (!response?.ok) throw new Error(response?.error ?? "Could not read the current selection.");
  if (!response.draft) throw new Error("Select a word, phrase, or sentence first.");

  await repository.capture({ ...response.draft, language });
  chrome.runtime.sendMessage({ type: "DATA_CHANGED" }).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "collect-selection",
    title: "Collect for Anki",
    contexts: ["selection"],
  });

  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "collect-selection" || tab.id === undefined) return;

  void (async () => {
    await chrome.sidePanel.open({ tabId: tab.id! }).catch(() => undefined);

    try {
      const settings = await loadSettings();
      await collectFromTab(tab.id!, settings.defaultLanguage);
    } catch (error) {
      chrome.runtime.sendMessage({
        type: "CAPTURE_ERROR",
        error: errorMessage(error),
      }).catch(() => undefined);
    }
  })();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "COLLECT_ACTIVE_SELECTION") return false;

  void (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error("No active browser tab.");

      const settings = await loadSettings();
      await collectFromTab(tab.id, message.language ?? settings.defaultLanguage);
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: errorMessage(error) });
    }
  })();

  return true;
});
