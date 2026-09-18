declare const __COLLECTOR_E2E__: boolean;

import { sanitizeSourceUrl } from "./capture/source-url";
import type { CaptureDraft, SourceUrlMode } from "./core/types";
import { loadSettings } from "./settings";
import { repository } from "./storage/repository";

type CaptureResponse = { ok: true; draft: CaptureDraft | null } | { ok: false; error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Capture failed.";
}

async function collectFromTab(
  tabId: number,
  language: string,
  sourceUrlMode: SourceUrlMode,
): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });

  const response = await chrome.tabs.sendMessage(tabId, {
    type: "CAPTURE_SELECTION",
  }) as CaptureResponse;

  if (!response?.ok) throw new Error(response?.error ?? "Could not read the current selection.");
  if (!response.draft) throw new Error("Select a word, phrase, or sentence first.");

  await repository.capture({
    ...response.draft,
    language,
    source: {
      ...response.draft.source,
      url: sanitizeSourceUrl(response.draft.source.url, sourceUrlMode),
    },
  });
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

async function captureFromContextMenu(tabId: number): Promise<{ ok: boolean; error?: string }> {
  await chrome.sidePanel.open({ tabId }).catch(() => undefined);

  try {
    const settings = await loadSettings();
    await collectFromTab(tabId, settings.defaultLanguage, settings.sourceUrlMode);
    return { ok: true };
  } catch (error) {
    const message = errorMessage(error);
    chrome.runtime.sendMessage({
      type: "CAPTURE_ERROR",
      error: message,
    }).catch(() => undefined);
    return { ok: false, error: message };
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id;
  if (info.menuItemId !== "collect-selection" || tabId === undefined) return;
  void captureFromContextMenu(tabId);
});

if (__COLLECTOR_E2E__) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "E2E_CONTEXT_MENU_CLICK") return false;

    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false, error: "E2E tab id is missing." });
      return false;
    }

    void captureFromContextMenu(tabId).then(sendResponse);
    return true;
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "COLLECT_ACTIVE_SELECTION") return false;

  void (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error("No active browser tab.");

      const settings = await loadSettings();
      await collectFromTab(
        tab.id,
        message.language ?? settings.defaultLanguage,
        settings.sourceUrlMode,
      );
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: errorMessage(error) });
    }
  })();

  return true;
});
