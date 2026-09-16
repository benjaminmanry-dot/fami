// Shared Roll20 command serializer for the Lilith sheet.
// Classic browser script (loaded before lilith.js); also consumed by the node
// test suite through a CommonJS-style sandbox. Keep it dependency-free.
(function () {
  "use strict";

  const LABEL_MAX = 160;
  const EXPRESSION_MAX = 60;

  // Human-facing text placed inside a Roll20 template card. Braces are removed
  // entirely, which structurally disables {{field}} injection as well as
  // @{...}, %{...}, and ?{...} expansion; bracket pairs disable inline rolls.
  function sanitizeLabel(value) {
    return String(value == null ? "" : value)
      .replace(/[{}]/g, " ")
      .replace(/\[\[|\]\]/g, " ")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, LABEL_MAX);
  }

  // The sheet only ever produces plain dice math: NdM with optional kh/kl
  // keeps, chained with + or - onto more dice or flat numbers.
  const DICE_TERM = /^(?:\d+|\d*d\d+(?:k[hl]\d+)?)$/i;

  function validateRollExpression(expression) {
    const text = String(expression == null ? "" : expression).trim();
    if (!text) return { ok: false, error: "The roll expression is empty." };
    if (text.length > EXPRESSION_MAX) return { ok: false, error: "The roll expression is too long." };
    const terms = text.split(/\s*[+-]\s*/);
    for (const term of terms) {
      if (!DICE_TERM.test(term)) {
        return { ok: false, error: `"${text}" is not a plain dice expression like 2d6+4.` };
      }
    }
    return { ok: true };
  }

  function d20Expression(modifier, mode) {
    const value = Math.trunc(Number(modifier)) || 0;
    const bonus = value >= 0 ? `+${value}` : String(value);
    if (mode === "advantage") return `2d20kh1${bonus}`;
    if (mode === "disadvantage") return `2d20kl1${bonus}`;
    return `1d20${bonus}`;
  }

  // fields: array of [label, part] where part is {roll, suffix?} for an inline
  // roll or {text} (or a plain string) for static card content.
  function buildCard(input) {
    const options = input || {};
    const fields = Array.isArray(options.fields) ? options.fields : [];
    const parts = [];

    for (const entry of fields) {
      if (!Array.isArray(entry)) continue;
      const label = sanitizeLabel(entry[0]);
      const part = entry[1];
      if (!label || part == null) continue;

      if (typeof part === "object" && "roll" in part) {
        const verdict = validateRollExpression(part.roll);
        if (!verdict.ok) return { ok: false, error: `${label}: ${verdict.error}` };
        const suffix = part.suffix ? sanitizeLabel(part.suffix) : "";
        parts.push(`{{${label}=[[${String(part.roll).trim()}]]${suffix ? ` ${suffix}` : ""}}}`);
      } else {
        const text = sanitizeLabel(typeof part === "object" ? part.text : part);
        if (!text) continue;
        parts.push(`{{${label}=${text}}}`);
      }
    }

    const name = sanitizeLabel(options.name) || "Lilith";
    const title = sanitizeLabel(options.title) || "Roll";
    const prefix = options.whisper ? "/w gm " : "";
    const command = `${prefix}&{template:default} {{name=🌸 ${name} • ${title}}}${parts.length ? ` ${parts.join(" ")}` : ""}`;
    return { ok: true, command };
  }

  const api = { sanitizeLabel, validateRollExpression, d20Expression, buildCard };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof self !== "undefined") self.LilithRollSerializer = api;
  else if (typeof window !== "undefined") window.LilithRollSerializer = api;
})();
