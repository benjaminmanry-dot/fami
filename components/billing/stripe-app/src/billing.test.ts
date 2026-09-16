import assert from "node:assert/strict";
import test from "node:test";

import {
  autopayAuthorizedForMode,
  batchKey,
  batchTotalCents,
  calculateFeeCents,
  collectionKey,
  dollarsToCents,
  existingInvoiceAction,
  formatDuration,
  liveSessionCapError,
  livePilotBatchError,
  profileMatchesMode,
  requireLiveSessionCap,
  selectedTotalCents,
} from "./billing.ts";

test("calculates and safeguards a mixed closeout", () => {
  assert.equal(calculateFeeCents(210, 950), 3325);
  assert.equal(calculateFeeCents(120, 950), 1900);
  assert.equal(calculateFeeCents(270, 950), 4275);
  assert.equal(calculateFeeCents(210, 600), 2100);
  assert.equal(calculateFeeCents(1, 950), 16);
  assert.equal(dollarsToCents("9.50"), 950);
  assert.equal(formatDuration(270), "4h 30m");
  assert.equal(
    batchTotalCents([
      { finalCents: 3325, disposition: "charge_now" },
      { finalCents: 1500, disposition: "partial" },
      { finalCents: 3800, disposition: "defer" },
      { finalCents: 3325, disposition: "waive" },
    ]),
    8625,
  );

  const key = collectionKey({
    mode: "test",
    tableId: "tuesday",
    sessionDate: "2026-07-27",
    customerId: "cus_fake",
  });
  assert.equal(
    key,
    "20fates:collect:test:tuesday:2026-07-27:cus_fake:v1",
  );
  assert.equal(
    batchKey({
      mode: "test",
      tableId: "tuesday",
      sessionDate: "2026-07-27",
    }),
    "20fates:batch:test:tuesday:2026-07-27:v1",
  );
  assert.equal(
    selectedTotalCents([
      { selectedForCollection: true, finalCents: 1900 },
      { selectedForCollection: false, finalCents: 3325 },
      { selectedForCollection: true, finalCents: 4275 },
    ]),
    6175,
  );
  assert.equal(existingInvoiceAction(undefined), "create");
  assert.equal(existingInvoiceAction("draft"), "finalize");
  assert.equal(existingInvoiceAction("open"), "pay");
  assert.equal(existingInvoiceAction("paid"), "already_paid");
  assert.equal(existingInvoiceAction("void"), "blocked");
  assert.equal(existingInvoiceAction("uncollectible"), "blocked");
  assert.equal(profileMatchesMode("test", "sandbox"), true);
  assert.equal(profileMatchesMode("live", "sandbox"), false);
  assert.equal(profileMatchesMode("live", "live_pilot"), true);
  assert.equal(
    autopayAuthorizedForMode("live", "authorized", "2026-08-09"),
    true,
  );
  assert.equal(
    autopayAuthorizedForMode("live", "authorized", "2026-02-30"),
    false,
  );
  assert.equal(
    autopayAuthorizedForMode("live", "pending_setup", "2026-08-09"),
    false,
  );
  assert.equal(
    livePilotBatchError("live", []),
    "The live pilot requires exactly one authorized player.",
  );
  assert.equal(livePilotBatchError("live", [3325]), null);
  assert.equal(
    livePilotBatchError("live", [10_001]),
    "The live pilot amount cannot exceed $100.00.",
  );
  assert.equal(
    livePilotBatchError("live", [1900, 1900]),
    "The live pilot requires exactly one authorized player.",
  );
  assert.throws(() => calculateFeeCents(0, 950));
  assert.throws(() => dollarsToCents("9.999"));
  assert.throws(() =>
    collectionKey({
      mode: "test",
      tableId: "bad:table",
      sessionDate: "2026-07-27",
      customerId: "cus_fake",
    }),
  );
});

test("validates the recorded live per-session cap", () => {
  assert.equal(requireLiveSessionCap("3000", "per_session"), 3000);
  assert.equal(liveSessionCapError(3000, 3000, 3000), null);
  assert.equal(
    liveSessionCapError(3001, 3000, 3000),
    "The approved $30.01 exceeds the recorded $30.00 per-session cap; no invoice was created.",
  );

  assert.throws(
    () => requireLiveSessionCap(undefined, "per_session"),
    /missing or malformed/,
  );
  assert.throws(
    () => requireLiveSessionCap("30.00", "per_session"),
    /missing or malformed/,
  );
  assert.throws(
    () => requireLiveSessionCap("0", "per_session"),
    /greater than zero/,
  );
  assert.throws(
    () => requireLiveSessionCap("10001", "per_session"),
    /absolute \$100.00 live safety ceiling/,
  );
  assert.throws(
    () => requireLiveSessionCap("3000", "per_batch"),
    /not explicitly per session/,
  );
  assert.equal(
    liveSessionCapError(2500, 3000, 2500),
    "The recorded per-session cap changed after review; return to editing and review it again before any live payment.",
  );
});
