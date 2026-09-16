export type Disposition =
  | "charge_now"
  | "monthly"
  | "defer"
  | "partial"
  | "waive";

export type StripeMode = "test" | "live";

export const LIVE_PILOT_MAX_CENTS = 10_000;

export function requireLiveSessionCap(
  value: string | undefined,
  scope: string | undefined,
): number {
  if (scope !== "per_session") {
    throw new Error(
      "The live billing cap is not explicitly per session; no invoice was created.",
    );
  }
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(
      "The live per-session cap is missing or malformed; no invoice was created.",
    );
  }
  const capCents = Number(value);
  if (!Number.isSafeInteger(capCents)) {
    throw new Error(
      "The live per-session cap is missing or malformed; no invoice was created.",
    );
  }
  if (capCents < 1) {
    throw new Error(
      "The live per-session cap must be greater than zero; no invoice was created.",
    );
  }
  if (capCents > LIVE_PILOT_MAX_CENTS) {
    throw new Error(
      "The live per-session cap exceeds the absolute $100.00 live safety ceiling; no invoice was created.",
    );
  }
  return capCents;
}

export function liveSessionCapError(
  finalCents: number,
  reviewedCapCents: number,
  currentCapCents: number,
): string | null {
  if (currentCapCents !== reviewedCapCents) {
    return "The recorded per-session cap changed after review; return to editing and review it again before any live payment.";
  }
  if (finalCents > currentCapCents) {
    return `The approved $${formatDollars(finalCents)} exceeds the recorded $${formatDollars(currentCapCents)} per-session cap; no invoice was created.`;
  }
  return null;
}

export function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
}

export function profileMatchesMode(
  mode: StripeMode,
  profileStatus: string,
): boolean {
  return profileStatus === (mode === "test" ? "sandbox" : "live_pilot");
}

export function autopayAuthorizedForMode(
  mode: StripeMode,
  autopayStatus: string,
  authorizedAt: string,
): boolean {
  return mode === "test"
    ? autopayStatus === "authorized_test"
    : autopayStatus === "authorized" && isIsoCalendarDate(authorizedAt);
}

export function livePilotBatchError(
  mode: StripeMode,
  finalAmounts: number[],
): string | null {
  if (mode !== "live") return null;
  if (finalAmounts.length !== 1) {
    return "The live pilot requires exactly one authorized player.";
  }
  if (finalAmounts[0] > LIVE_PILOT_MAX_CENTS) {
    return "The live pilot amount cannot exceed $100.00.";
  }
  return null;
}

export function requireWholeMinutes(value: string | number): number {
  const minutes = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) {
    throw new Error("Duration must be a whole number of minutes between 1 and 1440.");
  }
  return minutes;
}

export function requireCents(value: string | number, label = "Amount"): number {
  const cents = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(cents) || cents < 0 || cents > 1_000_000) {
    throw new Error(`${label} must be a whole number of cents from 0 to 1,000,000.`);
  }
  return cents;
}

export function calculateFeeCents(
  durationMinutes: number,
  hourlyRateCents: number,
): number {
  return Math.round(
    (requireWholeMinutes(durationMinutes) *
      requireCents(hourlyRateCents, "Hourly rate")) /
      60,
  );
}

export function dollarsToCents(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter a dollar amount with no more than two decimal places.");
  }
  return requireCents(Math.round(Number(normalized) * 100));
}

export function formatDollars(cents: number): string {
  return (requireCents(cents) / 100).toFixed(2);
}

export function formatDuration(minutes: number): string {
  const safeMinutes = requireWholeMinutes(minutes);
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return `${hours}h ${remainder}m`;
}

export function batchTotalCents(
  rows: Array<{ finalCents: number; disposition: Disposition }>,
): number {
  return rows.reduce(
    (total, row) =>
      total + (row.disposition === "waive" ? 0 : requireCents(row.finalCents)),
    0,
  );
}

export function selectedTotalCents(
  rows: Array<{ selectedForCollection: boolean; finalCents: number }>,
): number {
  return rows.reduce(
    (total, row) =>
      total +
      (row.selectedForCollection ? requireCents(row.finalCents) : 0),
    0,
  );
}

function requireIdentifier(value: string, label: string): string {
  if (!value || value.includes(":")) {
    throw new Error(`${label} must be present and cannot contain colons.`);
  }
  return value;
}

export function collectionKey(parts: {
  mode: "test" | "live";
  tableId: string;
  sessionDate: string;
  customerId: string;
  revision?: number;
}): string {
  const values = [
    "20fates",
    "collect",
    parts.mode,
    requireIdentifier(parts.tableId, "Table ID"),
    requireIdentifier(parts.sessionDate, "Session date"),
    requireIdentifier(parts.customerId, "Customer ID"),
    `v${parts.revision ?? 1}`,
  ];
  const revision = parts.revision ?? 1;
  if (!Number.isInteger(revision) || revision < 1 || revision > 999) {
    throw new Error("Revision must be a whole number from 1 to 999.");
  }
  return values.join(":");
}

export function batchKey(parts: {
  mode: "test" | "live";
  tableId: string;
  sessionDate: string;
  revision?: number;
}): string {
  const revision = parts.revision ?? 1;
  if (!Number.isInteger(revision) || revision < 1 || revision > 999) {
    throw new Error("Revision must be a whole number from 1 to 999.");
  }
  return [
    "20fates",
    "batch",
    parts.mode,
    requireIdentifier(parts.tableId, "Table ID"),
    requireIdentifier(parts.sessionDate, "Session date"),
    `v${revision}`,
  ].join(":");
}

export type ExistingInvoiceAction =
  | "create"
  | "finalize"
  | "pay"
  | "already_paid"
  | "blocked";

export function existingInvoiceAction(
  status: string | null | undefined,
): ExistingInvoiceAction {
  if (!status) return "create";
  if (status === "draft") return "finalize";
  if (status === "open") return "pay";
  if (status === "paid") return "already_paid";
  return "blocked";
}
