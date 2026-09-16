// Shared validation and routing logic for the Lilith Roll20 bridge.
// Loaded by the service worker (importScripts), by the sheet-bridge content
// script (manifest js array), and by the node test suite through a
// CommonJS-style sandbox. Classic script — no ESM syntax, no chrome.* calls.
(function () {
  "use strict";

  const STATUS = {
    SENT: "sent",
    NO_TAB: "no-roll20-tab",
    TARGET_NOT_READY: "target-not-ready",
    CHAT_INPUT_NOT_FOUND: "chat-input-not-found",
    SUBMISSION_FAILED: "submission-failed",
    INVALID_REQUEST: "invalid-request",
  };

  // Development-only origins allowed to relay rolls through the local bridge.
  // The production runtime is the extension-owned sheet page, which does not
  // use the bridge at all. file:// pages and other localhost ports are not
  // allowed to talk to the extension.
  const ALLOWED_BRIDGE_ORIGINS = ["http://127.0.0.1:4173", "http://localhost:4173"];

  const COMMAND_MAX = 2000;
  // Every legitimate command is a Lilith template card, optionally whispered.
  // Enforcing the shape here means no caller can relay /roll, /api, /fx,
  // whispers to other players, or any other raw chat command.
  const COMMAND_PATTERN = /^(?:\/w gm )?&\{template:default\} \{\{name=/;

  function isAllowedBridgeOrigin(origin) {
    return typeof origin === "string" && ALLOWED_BRIDGE_ORIGINS.indexOf(origin) !== -1;
  }

  // Only pages that are actually a Roll20 game (editor/VTT) may receive rolls —
  // never the homepage, compendium, marketplace, or campaign-details pages.
  function isRoll20GameUrl(url) {
    return typeof url === "string" && /^https:\/\/app\.roll20\.net\/(editor|campaigns\/play\/|vtt|setcampaign)/i.test(url);
  }

  function invalid(error) {
    return { ok: false, status: STATUS.INVALID_REQUEST, error };
  }

  function validateRollRequest(message) {
    if (!message || typeof message !== "object") return invalid("The roll request was empty.");
    if (message.type !== "LILITH_ROLL") return invalid("Unknown message type.");
    if (typeof message.requestId !== "string" || message.requestId.length < 8 || message.requestId.length > 128) {
      return invalid("The roll request is missing a usable requestId.");
    }
    if (typeof message.command !== "string") return invalid("The roll command must be a string.");
    if (message.command.length > COMMAND_MAX) return invalid("The roll command is too long.");
    if (/[\u0000-\u001f\u007f]/.test(message.command)) return invalid("The roll command contains control characters.");
    if (!COMMAND_PATTERN.test(message.command)) return invalid("Only Lilith template cards can be sent to Roll20.");
    return { ok: true };
  }

  // Remembers recently handled requestIds so a retried message cannot post
  // the same roll twice. Oldest ids fall out first.
  function createRequestDeduper(limit) {
    const max = Number(limit) > 0 ? Number(limit) : 24;
    const seen = new Set();
    return {
      seen(requestId) {
        if (seen.has(requestId)) return true;
        seen.add(requestId);
        if (seen.size > max) seen.delete(seen.values().next().value);
        return false;
      },
    };
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out")), ms);
      Promise.resolve(promise).then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    });
  }

  function failure(status, error, request) {
    return { ok: false, status, error, requestId: request && request.requestId };
  }

  // Resolves a safe target tab and posts the request to its content script.
  // deps: getRememberedTabId(), setRememberedTabId(id|null), getTab(id),
  //       queryGameTabs(), ping(tabId), post(tabId, request), pingTimeoutMs?
  async function deliverRoll(deps, request) {
    const verdict = validateRollRequest(request);
    if (!verdict.ok) return { ...verdict, requestId: request && request.requestId };

    const pingTimeoutMs = deps.pingTimeoutMs || 1500;
    const candidates = [];
    const knownIds = new Set();

    let rememberedId = null;
    try { rememberedId = await deps.getRememberedTabId(); } catch (_) {}
    if (rememberedId != null) {
      let remembered = null;
      try { remembered = await deps.getTab(rememberedId); } catch (_) {}
      if (remembered && isRoll20GameUrl(remembered.url)) {
        candidates.push(remembered);
        knownIds.add(remembered.id);
      } else {
        try { await deps.setRememberedTabId(null); } catch (_) {}
      }
    }

    let queried = [];
    try { queried = (await deps.queryGameTabs()) || []; } catch (_) {}
    queried
      .filter((tab) => tab && tab.id != null && isRoll20GameUrl(tab.url) && !knownIds.has(tab.id))
      .sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))
      .forEach((tab) => candidates.push(tab));

    if (!candidates.length) {
      return failure(STATUS.NO_TAB, "Open your Roll20 game in another Chrome tab, then try again.", request);
    }

    let target = null;
    for (const tab of candidates) {
      try {
        const pong = await withTimeout(deps.ping(tab.id), pingTimeoutMs);
        if (pong) { target = tab; break; }
      } catch (_) {
        // This tab has no live content script; try the next candidate.
      }
    }
    if (!target) {
      return failure(STATUS.TARGET_NOT_READY, "Found a Roll20 game tab, but refresh it once so Lilith can connect.", request);
    }

    let response = null;
    try {
      response = await deps.post(target.id, request);
    } catch (_) {
      return failure(STATUS.SUBMISSION_FAILED, "Roll20 did not accept the command. Refresh the game tab and try again.", request);
    }

    if (response && response.ok) {
      try { await deps.setRememberedTabId(target.id); } catch (_) {}
      return {
        ok: true,
        status: STATUS.SENT,
        requestId: request.requestId,
        target: { title: target.title || "", url: target.url || "" },
      };
    }
    return {
      ok: false,
      status: response && typeof response.status === "string" ? response.status : STATUS.SUBMISSION_FAILED,
      error: (response && response.error) || "Roll20 did not accept the command.",
      requestId: request.requestId,
    };
  }

  const api = {
    STATUS,
    ALLOWED_BRIDGE_ORIGINS,
    isAllowedBridgeOrigin,
    isRoll20GameUrl,
    validateRollRequest,
    createRequestDeduper,
    deliverRoll,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof self !== "undefined") self.LilithBridgeProtocol = api;
  else if (typeof window !== "undefined") window.LilithBridgeProtocol = api;
})();
