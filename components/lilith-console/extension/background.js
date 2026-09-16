importScripts("bridge-protocol.js");

const protocol = self.LilithBridgeProtocol;
const SHEET_PAGE = "sheet.html";
const REMEMBERED_KEY = "lilith-remembered-roll20-tab";

// chrome.storage.session survives service-worker restarts; the variable is a
// fallback for the rare environments where session storage is unavailable.
let rememberedTabIdFallback = null;

async function getRememberedTabId() {
  try {
    const data = await chrome.storage.session.get(REMEMBERED_KEY);
    return data[REMEMBERED_KEY] != null ? data[REMEMBERED_KEY] : rememberedTabIdFallback;
  } catch (_) {
    return rememberedTabIdFallback;
  }
}

async function setRememberedTabId(tabId) {
  rememberedTabIdFallback = tabId;
  try {
    if (tabId == null) await chrome.storage.session.remove(REMEMBERED_KEY);
    else await chrome.storage.session.set({ [REMEMBERED_KEY]: tabId });
  } catch (_) {
    // In-memory fallback already updated.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL(SHEET_PAGE) });
});

chrome.action.onClicked.addListener(async () => {
  const sheetUrl = chrome.runtime.getURL(SHEET_PAGE);
  const matches = await chrome.tabs.query({});
  const existing = matches.find((tab) => tab.url === sheetUrl);
  if (existing && existing.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: sheetUrl });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (protocol.isRoll20GameUrl(tab.url)) await setRememberedTabId(tabId);
  } catch (_) {
    // A tab can disappear between activation and lookup.
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active && protocol.isRoll20GameUrl(tab.url)) {
    setRememberedTabId(tabId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await getRememberedTabId()) === tabId) await setRememberedTabId(null);
});

const deliveryDeps = {
  getRememberedTabId,
  setRememberedTabId,
  getTab: (tabId) => chrome.tabs.get(tabId),
  queryGameTabs: () => chrome.tabs.query({ url: "https://app.roll20.net/*" }),
  ping: async (tabId) => {
    const reply = await chrome.tabs.sendMessage(tabId, { type: "LILITH_PING" });
    return Boolean(reply && reply.ok);
  },
  post: (tabId, request) =>
    chrome.tabs.sendMessage(tabId, {
      type: "LILITH_POST_ROLL",
      command: request.command,
      requestId: request.requestId,
    }),
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "LILITH_ROLL") return false;

  // Messages relayed by a content script carry sender.tab. Only the exact
  // development preview origins may use that path; the production sheet is an
  // extension page (no sender.tab) and is always allowed.
  if (sender.tab) {
    let origin = "";
    try { origin = new URL(sender.url || "").origin; } catch (_) {}
    if (!protocol.isAllowedBridgeOrigin(origin)) {
      sendResponse({
        ok: false,
        status: protocol.STATUS.INVALID_REQUEST,
        error: "This page is not allowed to send rolls to Roll20.",
        requestId: message.requestId,
      });
      return false;
    }
  }

  protocol
    .deliverRoll(deliveryDeps, message)
    .catch((error) => ({
      ok: false,
      status: protocol.STATUS.SUBMISSION_FAILED,
      error: (error && error.message) || "The extension could not route the roll.",
      requestId: message.requestId,
    }))
    .then(sendResponse);
  return true;
});
