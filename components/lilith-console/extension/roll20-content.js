(function () {
  "use strict";

  const protocol = self.LilithBridgeProtocol;
  const STATUS = protocol.STATUS;
  // A retried message with an already-handled requestId is acknowledged
  // without posting the roll a second time.
  const handledRequests = protocol.createRequestDeduper(24);

  const INPUT_SELECTORS = [
    "#textchat-input > textarea",
    "#textchat-input textarea",
    "textarea.ui-autocomplete-input",
    "textarea#chat-input",
    "textarea[aria-label*='chat' i]",
    "textarea[placeholder*='chat' i]",
    "[contenteditable='true'][aria-label*='chat' i]"
  ];

  const BUTTON_SELECTORS = [
    "#textchat-input > button",
    "#textchat-input button[type='submit']",
    "button[aria-label*='send' i]",
    "button[data-testid*='send' i]"
  ];

  function findVisible(selectors) {
    for (const selector of selectors) {
      const elements = [...document.querySelectorAll(selector)];
      const visible = elements.find((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
      if (visible) return visible;
    }
    return null;
  }

  function setInputValue(input, value) {
    input.focus();
    if (input.isContentEditable) {
      input.textContent = value;
    } else {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value");
      if (setter && setter.set) setter.set.call(input, value);
      else input.value = value;
    }
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function postToChat(command) {
    const input = findVisible(INPUT_SELECTORS);
    if (!input) {
      return { ok: false, status: STATUS.CHAT_INPUT_NOT_FOUND, error: "Open Roll20’s Text Chat panel, then try the roll again." };
    }

    try {
      setInputValue(input, command);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const sendButton = findVisible(BUTTON_SELECTORS);
      if (sendButton) {
        sendButton.click();
        return { ok: true, status: STATUS.SENT };
      }

      // No send button: simulate Enter instead. One submission path runs,
      // never both, so a roll cannot be posted twice from here.
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      return { ok: true, status: STATUS.SENT };
    } catch (error) {
      return { ok: false, status: STATUS.SUBMISSION_FAILED, error: (error && error.message) || "Roll20’s chat rejected the command." };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;

    if (message.type === "LILITH_PING") {
      sendResponse({ ok: true, pong: true });
      return false;
    }

    if (message.type !== "LILITH_POST_ROLL" || typeof message.command !== "string") return false;

    if (typeof message.requestId === "string" && handledRequests.seen(message.requestId)) {
      sendResponse({ ok: true, status: STATUS.SENT, duplicate: true });
      return false;
    }

    postToChat(message.command)
      .catch((error) => ({ ok: false, status: STATUS.SUBMISSION_FAILED, error: (error && error.message) || "Roll20’s chat rejected the command." }))
      .then(sendResponse);
    return true;
  });
})();
