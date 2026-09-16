(function () {
  "use strict";

  const protocol = window.LilithBridgeProtocol;

  // The manifest already restricts this script to the development preview
  // origins; this check is defense in depth if those matches ever widen.
  if (!protocol.isAllowedBridgeOrigin(location.origin)) return;

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.source !== "lilith-sheet" || message.type !== "LILITH_ROLL") return;

    const respond = (response) => {
      window.postMessage(
        { source: "lilith-extension", type: "LILITH_ROLL_RESULT", requestId: message.requestId, response },
        location.origin
      );
    };

    const request = { type: "LILITH_ROLL", command: message.command, requestId: message.requestId };
    const verdict = protocol.validateRollRequest(request);
    if (!verdict.ok) {
      respond({ ...verdict, requestId: message.requestId });
      return;
    }

    chrome.runtime
      .sendMessage(request)
      .then((response) => respond(response || { ok: false, status: protocol.STATUS.SUBMISSION_FAILED, error: "The extension did not answer." }))
      .catch((error) => respond({ ok: false, status: protocol.STATUS.TARGET_NOT_READY, error: (error && error.message) || "Lilith’s Chrome bridge is unavailable." }));
  });
})();
