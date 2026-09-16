import { type ReactNode, useEffect, useMemo, useState } from "react";
import Stripe from "stripe";
import {
  Box,
  Button,
  ContextView,
  DateField,
  Divider,
  FullPageView,
  Select,
  Spinner,
  Switch,
  TextField,
} from "@stripe/ui-extension-sdk/ui";
import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import {
  createHttpClient,
  STRIPE_API_KEY,
} from "@stripe/ui-extension-sdk/http_client";

import {
  autopayAuthorizedForMode,
  batchKey,
  calculateFeeCents,
  collectionKey,
  dollarsToCents,
  existingInvoiceAction,
  formatDollars,
  formatDuration,
  isIsoCalendarDate,
  livePilotBatchError,
  liveSessionCapError,
  profileMatchesMode,
  requireLiveSessionCap,
  selectedTotalCents,
  type Disposition,
  type StripeMode,
} from "../billing";

const stripe = new Stripe(STRIPE_API_KEY, {
  httpClient: createHttpClient(),
});

type TableProfile = {
  stripeId: string;
  tableId: string;
  name: string;
  schedule: string;
};

type PlayerRow = {
  customerId: string;
  name: string;
  email: string;
  tableIds: string[];
  rateInput: string;
  rateCents: number;
  cadence: string;
  profileStatus: string;
  autopayStatus: string;
  autopayAuthorizedAt: string;
  attendance: "present" | "absent";
  disposition: Disposition;
  calculatedCents: number;
  finalInput: string;
  finalCents: number;
  selectedForCollection: boolean;
  paymentMethodId: string | null;
  paymentMethodType: string | null;
  paymentLabel: string;
  profileError?: string;
  setupUrl?: string;
  invoiceId?: string;
  collectionStatus?: "paid" | "recovered" | "failed";
};

type ApprovedCharge = {
  closeoutId: string;
  customerId: string;
  name: string;
  email: string;
  attendance: "present" | "absent";
  rateCents: number;
  calculatedCents: number;
  finalCents: number;
  sessionCapCents: number | null;
  paymentMethodId: string;
  paymentLabel: string;
};

type ApprovedBatch = {
  batchId: string;
  mode: StripeMode;
  tableStripeId: string;
  tableId: string;
  tableName: string;
  sessionDate: string;
  durationMinutes: number;
  approvedBy: string;
  charges: ApprovedCharge[];
};

type CollectionResult = {
  status: "paid" | "recovered" | "failed";
  message: string;
  invoiceId?: string;
};

function localIsoDate(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const today = localIsoDate();

function CloseoutShell({
  drawer,
  children,
}: {
  drawer: boolean;
  children: ReactNode;
}) {
  return drawer ? (
    <ContextView title="20Fates table closeout">{children}</ContextView>
  ) : (
    <FullPageView>{children}</FullPageView>
  );
}

function paymentLabel(method: Stripe.PaymentMethod | null): string {
  if (!method) return "No saved method";
  if (method.card) return `Card •••• ${method.card.last4}`;
  if (method.us_bank_account) {
    return `Bank •••• ${method.us_bank_account.last4}`;
  }
  return method.type.replaceAll("_", " ");
}

function dispositionLabel(value: Disposition): string {
  return {
    charge_now: "Charge after final confirmation",
    monthly: "Add to monthly statement",
    defer: "Defer",
    partial: "Partially collect",
    waive: "Waive",
  }[value];
}

function invoiceCustomerId(invoice: Stripe.Invoice): string | null {
  if (typeof invoice.customer === "string") return invoice.customer;
  return invoice.customer?.id || null;
}

export function Closeout({
  context,
  drawer = false,
}: {
  context: ExtensionContextValue;
  drawer?: boolean;
}) {
  const [tables, setTables] = useState<TableProfile[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [selectedTableId, setSelectedTableId] = useState("");
  const [sessionDate, setSessionDate] = useState(today);
  const [durationInput, setDurationInput] = useState("240");
  const [sessionOccurred, setSessionOccurred] = useState(true);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [approvedBatch, setApprovedBatch] = useState<ApprovedBatch | null>(null);
  const [collectionAttempted, setCollectionAttempted] = useState(false);
  const [collectionResults, setCollectionResults] = useState<
    Record<string, CollectionResult>
  >({});
  const [liveConfirmation, setLiveConfirmation] = useState("");

  const durationMinutes = Number(durationInput);
  const roster = useMemo(
    () => players.filter((player) => player.tableIds.includes(selectedTableId)),
    [players, selectedTableId],
  );
  const selectedTable = tables.find(
    (table) => table.tableId === selectedTableId,
  );
  const selectedRoster = roster.filter((row) => row.selectedForCollection);
  const collectionTotalCents = selectedTotalCents(roster);
  const reviewLocked = approvedBatch !== null;
  const isTestMode = context.environment.mode === "test";
  const mode: StripeMode = isTestMode ? "test" : "live";

  useEffect(() => {
    const load = async () => {
      try {
        const [productPage, customerPage] = await Promise.all([
          stripe.products.list({ active: true, limit: 100 }),
          stripe.customers.list({ limit: 100 }),
        ]);

        const loadedTables = productPage.data
          .filter(
            (product) =>
              product.metadata["20fates_table_id"] &&
              (isTestMode ||
                product.metadata.billing_status === "live_pilot"),
          )
          .map((product) => ({
            stripeId: product.id,
            tableId: product.metadata["20fates_table_id"],
            name: product.name,
            schedule: product.metadata.schedule_label || "",
          }));

        const customerProfiles = customerPage.data.filter(
          (customer): customer is Stripe.Customer =>
            !customer.deleted &&
            Boolean(customer.metadata["20fates_player_id"]) &&
            profileMatchesMode(mode, customer.metadata.profile_status || ""),
        );

        const loadedPlayers = await Promise.all(
          customerProfiles.map(async (customer): Promise<PlayerRow> => {
            const defaultMethod =
              typeof customer.invoice_settings.default_payment_method ===
              "string"
                ? customer.invoice_settings.default_payment_method
                : customer.invoice_settings.default_payment_method?.id || null;
            let method: Stripe.PaymentMethod | null = null;
            if (defaultMethod) {
              try {
                method = await stripe.paymentMethods.retrieve(defaultMethod);
              } catch {
                method = null;
              }
            }
            const parsedRate = Number(customer.metadata.hourly_rate_cents);
            const rateIsValid =
              Number.isInteger(parsedRate) &&
              parsedRate > 0 &&
              parsedRate <= 1_000_000;
            const rateCents = rateIsValid ? parsedRate : 0;
            const calculatedCents = calculateFeeCents(240, rateCents);
            const cadence = customer.metadata.billing_cadence || "weekly";
            const profileStatus = customer.metadata.profile_status || "";
            const autopayStatus = customer.metadata.autopay_status || "";
            const autopayAuthorizedAt =
              customer.metadata.autopay_authorized_at || "";
            const disposition: Disposition =
              cadence === "monthly"
                ? "monthly"
                : cadence === "manual"
                  ? "defer"
                  : "charge_now";

            return {
              customerId: customer.id,
              name: customer.name || customer.email || customer.id,
              email: customer.email || "",
              tableIds: (customer.metadata.active_table_ids || "")
                .split(",")
                .map((id) => id.trim())
                .filter(Boolean),
              rateInput: formatDollars(rateCents),
              rateCents,
              cadence,
              profileStatus,
              autopayStatus,
              autopayAuthorizedAt,
              attendance: "present",
              disposition,
              calculatedCents,
              finalInput: formatDollars(calculatedCents),
              finalCents: calculatedCents,
              selectedForCollection:
                cadence === "weekly" &&
                method?.type === "card" &&
                autopayAuthorizedForMode(
                  mode,
                  autopayStatus,
                  autopayAuthorizedAt,
                ),
              paymentMethodId: defaultMethod,
              paymentMethodType: method?.type || null,
              paymentLabel: paymentLabel(method),
              profileError: rateIsValid
                ? undefined
                : "Set a valid agreed hourly rate before creating a billing record.",
            };
          }),
        );

        setTables(loadedTables);
        setPlayers(loadedPlayers);
        setSelectedTableId(loadedTables[0]?.tableId || "");
        if (!isTestMode && (!loadedTables.length || !loadedPlayers.length)) {
          setMessage(
            "Live pilot installed and inactive. No authorized live-pilot table and player are configured.",
          );
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not load Stripe data.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [context.environment.mode]);

  const updatePlayer = (
    customerId: string,
    update: (row: PlayerRow) => PlayerRow,
  ) => {
    setPlayers((current) =>
      current.map((row) => (row.customerId === customerId ? update(row) : row)),
    );
  };

  const changeDuration = (value: string) => {
    setDurationInput(value);
    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return;

    setPlayers((current) =>
      current.map((row) => {
        const nextCalculated = calculateFeeCents(minutes, row.rateCents);
        const finalFollowsCalculation = row.finalCents === row.calculatedCents;
        return {
          ...row,
          calculatedCents: nextCalculated,
          finalCents: finalFollowsCalculation ? nextCalculated : row.finalCents,
          finalInput: finalFollowsCalculation
            ? formatDollars(nextCalculated)
            : row.finalInput,
        };
      }),
    );
  };

  const saveProfile = async (row: PlayerRow) => {
    if (!profileMatchesMode(mode, row.profileStatus)) {
      setMessage("This billing profile is not available in the current Stripe mode.");
      return;
    }

    try {
      const rateCents = dollarsToCents(row.rateInput);
      if (rateCents < 1) {
        throw new Error("The agreed hourly rate must be greater than zero.");
      }
      await stripe.customers.update(row.customerId, {
        metadata: {
          hourly_rate_cents: String(rateCents),
          billing_cadence: row.cadence,
          rate_effective_date: today,
        },
      });
      updatePlayer(row.customerId, (current) => {
        const calculatedCents = calculateFeeCents(durationMinutes, rateCents);
        return {
          ...current,
          rateCents,
          calculatedCents,
          finalCents: calculatedCents,
          finalInput: formatDollars(calculatedCents),
          profileError: undefined,
        };
      });
      setMessage(`${row.name}'s billing profile was saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Profile save failed.");
    }
  };

  const createSetupLink = async (row: PlayerRow) => {
    if (!profileMatchesMode(mode, row.profileStatus)) {
      setMessage("This billing profile is not available in the current Stripe mode.");
      return;
    }
    if (
      mode === "live" &&
      !["pending_setup", "authorized"].includes(row.autopayStatus)
    ) {
      setMessage(
        "Live setup requires a pilot profile marked pending_setup or authorized.",
      );
      return;
    }

    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "setup",
          customer: row.customerId,
          payment_method_types: ["card"],
          success_url:
            "https://20fates.com/billing/setup-complete/?session_id={CHECKOUT_SESSION_ID}",
          cancel_url: "https://20fates.com/billing/terms/?setup=cancelled",
          metadata: {
            source: "20fates_closeout_app",
            player_id: row.customerId,
            mode,
          },
        },
        { idempotencyKey: `20fates:setup:${mode}:${row.customerId}` },
      );
      updatePlayer(row.customerId, (current) => ({
        ...current,
        setupUrl: session.url || undefined,
      }));
      setMessage(
        `Stripe created a ${isTestMode ? "sandbox" : "live"} setup link for ${row.name}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Setup-link creation failed.");
    }
  };

  const prepareCollectionReview = async () => {
    if (!sessionOccurred) {
      setMessage("A session that did not occur cannot create ordinary charges.");
      return;
    }
    if (!selectedTable || !isIsoCalendarDate(sessionDate)) {
      setMessage("Choose a table and a valid session date.");
      return;
    }
    if (
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > 1440
    ) {
      setMessage("Enter the actual duration as whole minutes.");
      return;
    }
    if (!selectedRoster.length) {
      setMessage("Select at least one weekly player with a saved default card.");
      return;
    }

    try {
      let charges = selectedRoster.map((row): ApprovedCharge => {
        if (row.profileError || row.rateCents < 1) {
          throw new Error(`${row.name} needs a valid billing profile.`);
        }
        if (row.cadence !== "weekly" || row.disposition !== "charge_now") {
          throw new Error(
            `${row.name} must use weekly cadence and Charge after final confirmation.`,
          );
        }
        if (!row.paymentMethodId || row.paymentMethodType !== "card") {
          throw new Error(`${row.name} needs a saved default card.`);
        }
        if (
          !profileMatchesMode(mode, row.profileStatus) ||
          !autopayAuthorizedForMode(
            mode,
            row.autopayStatus,
            row.autopayAuthorizedAt,
          )
        ) {
          throw new Error(`${row.name} is not authorized for ${mode} collection.`);
        }
        const finalCents = dollarsToCents(row.finalInput);
        if (finalCents < 1) {
          throw new Error(`${row.name}'s approved amount must be positive.`);
        }
        return {
          closeoutId: collectionKey({
            mode,
            tableId: selectedTable.tableId,
            sessionDate,
            customerId: row.customerId,
          }),
          customerId: row.customerId,
          name: row.name,
          email: row.email,
          attendance: row.attendance,
          rateCents: row.rateCents,
          calculatedCents: row.calculatedCents,
          finalCents,
          sessionCapCents: null,
          paymentMethodId: row.paymentMethodId,
          paymentLabel: row.paymentLabel,
        };
      });

      const pilotError = livePilotBatchError(
        mode,
        charges.map((charge) => charge.finalCents),
      );
      if (pilotError) throw new Error(pilotError);

      if (mode === "live") {
        const currentCustomers = await Promise.all(
          charges.map((charge) => stripe.customers.retrieve(charge.customerId)),
        );
        charges = charges.map((charge, index) => {
          const customer = currentCustomers[index];
          if (
            !customer ||
            customer.deleted ||
            !profileMatchesMode("live", customer.metadata.profile_status || "") ||
            !autopayAuthorizedForMode(
              "live",
              customer.metadata.autopay_status || "",
              customer.metadata.autopay_authorized_at || "",
            )
          ) {
            throw new Error(
              "The recorded cap cannot be verified for an authorized live-pilot profile; no review was created.",
            );
          }
          const sessionCapCents = requireLiveSessionCap(
            customer.metadata.session_fee_cap_cents,
            customer.metadata.session_fee_cap_scope,
          );
          const capError = liveSessionCapError(
            charge.finalCents,
            sessionCapCents,
            sessionCapCents,
          );
          if (capError) throw new Error(capError);
          return {
            ...charge,
            sessionCapCents,
          };
        });
      }

      setApprovedBatch({
        batchId: batchKey({
          mode,
          tableId: selectedTable.tableId,
          sessionDate,
        }),
        mode,
        tableStripeId: selectedTable.stripeId,
        tableId: selectedTable.tableId,
        tableName: selectedTable.name,
        sessionDate,
        durationMinutes,
        approvedBy: context.userContext.id || "stripe_dashboard_user",
        charges,
      });
      setCollectionAttempted(false);
      setCollectionResults({});
      setLiveConfirmation("");
      setMessage(
        `Review frozen. Check every player and amount before the final ${isTestMode ? "sandbox" : "live"} confirmation.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review could not be prepared.");
    }
  };

  const findExistingInvoice = async (
    charge: ApprovedCharge,
  ): Promise<Stripe.Invoice | null> => {
    const matches: Stripe.Invoice[] = [];
    let startingAfter: string | undefined;
    do {
      const page = await stripe.invoices.list({
        customer: charge.customerId,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      matches.push(
        ...page.data.filter(
          (invoice) => invoice.metadata?.closeout_id === charge.closeoutId,
        ),
      );
      if (matches.length > 1) break;
      startingAfter = page.has_more
        ? page.data[page.data.length - 1]?.id
        : undefined;
    } while (startingAfter);

    if (matches.length > 1) {
      throw new Error(
        `Stripe contains multiple invoices for ${charge.closeoutId}. Stop and inspect them manually.`,
      );
    }
    return matches[0] || null;
  };

  const validateExistingInvoice = (
    invoice: Stripe.Invoice,
    batch: ApprovedBatch,
    charge: ApprovedCharge,
  ) => {
    if (invoiceCustomerId(invoice) !== charge.customerId) {
      throw new Error("Recovered invoice belongs to a different Stripe customer.");
    }
    const expected: Record<string, string> = {
      closeout_id: charge.closeoutId,
      batch_id: batch.batchId,
      table_id: batch.tableId,
      session_date: batch.sessionDate,
      duration_minutes: String(batch.durationMinutes),
      final_amount_cents: String(charge.finalCents),
      payment_method_id: charge.paymentMethodId,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (invoice.metadata?.[key] !== value) {
        throw new Error(
          `Recovered invoice ${invoice.id} does not match the approved ${key}.`,
        );
      }
    }
  };

  const ensureInvoiceLine = async (
    invoice: Stripe.Invoice,
    batch: ApprovedBatch,
    charge: ApprovedCharge,
  ) => {
    const linePage = await stripe.invoices.listLineItems(invoice.id, {
      limit: 100,
    });
    const matchingLines = linePage.data.filter(
      (line) => line.metadata.closeout_id === charge.closeoutId,
    );
    if (matchingLines.length > 1) {
      throw new Error(`Invoice ${invoice.id} contains duplicate closeout lines.`);
    }
    if (matchingLines.length === 1) {
      if (matchingLines[0].amount !== charge.finalCents) {
        throw new Error(`Invoice ${invoice.id} has the wrong line amount.`);
      }
      return;
    }
    if (invoice.status !== "draft") {
      throw new Error(`Invoice ${invoice.id} is missing its closeout line.`);
    }
    await stripe.invoiceItems.create(
      {
        customer: charge.customerId,
        invoice: invoice.id,
        amount: charge.finalCents,
        currency: "usd",
        description: `${batch.tableName} — ${batch.sessionDate} — ${formatDuration(
          batch.durationMinutes,
        )} at $${formatDollars(charge.rateCents)}/hour`,
        metadata: {
          closeout_id: charge.closeoutId,
          batch_id: batch.batchId,
          session_date: batch.sessionDate,
          duration_minutes: String(batch.durationMinutes),
          hourly_rate_cents: String(charge.rateCents),
          calculated_amount_cents: String(charge.calculatedCents),
          final_amount_cents: String(charge.finalCents),
          disposition: "charge_now",
        },
      },
      { idempotencyKey: `${charge.closeoutId}:line` },
    );
  };

  const collectApprovedCharge = async (
    batch: ApprovedBatch,
    charge: ApprovedCharge,
  ): Promise<CollectionResult> => {
    if (batch.mode === "live") {
      const pilotError = livePilotBatchError("live", [charge.finalCents]);
      if (pilotError) throw new Error(pilotError);

      const [customer, product] = await Promise.all([
        stripe.customers.retrieve(charge.customerId),
        stripe.products.retrieve(batch.tableStripeId),
      ]);
      if (
        customer.deleted ||
        !profileMatchesMode("live", customer.metadata.profile_status || "") ||
        !autopayAuthorizedForMode(
          "live",
          customer.metadata.autopay_status || "",
          customer.metadata.autopay_authorized_at || "",
        )
      ) {
        throw new Error(
          "Live authorization is missing or was revoked; no invoice was created.",
        );
      }
      const currentDefaultMethod =
        typeof customer.invoice_settings.default_payment_method === "string"
          ? customer.invoice_settings.default_payment_method
          : customer.invoice_settings.default_payment_method?.id || null;
      if (currentDefaultMethod !== charge.paymentMethodId) {
        throw new Error(
          "The live default payment method changed after review; no invoice was created.",
        );
      }
      if (
        product.metadata["20fates_table_id"] !== batch.tableId ||
        product.metadata.billing_status !== "live_pilot"
      ) {
        throw new Error(
          "The live-pilot table is not authorized; no invoice was created.",
        );
      }
      if (charge.sessionCapCents === null) {
        throw new Error(
          "The live per-session cap was not reviewed; no invoice was created.",
        );
      }
      const currentCapCents = requireLiveSessionCap(
        customer.metadata.session_fee_cap_cents,
        customer.metadata.session_fee_cap_scope,
      );
      const capError = liveSessionCapError(
        charge.finalCents,
        charge.sessionCapCents,
        currentCapCents,
      );
      if (capError) throw new Error(capError);
    }

    let invoice = await findExistingInvoice(charge);
    const recovered = Boolean(invoice);
    if (invoice) {
      validateExistingInvoice(invoice, batch, charge);
    } else {
      invoice = await stripe.invoices.create(
        {
          customer: charge.customerId,
          auto_advance: false,
          collection_method: "charge_automatically",
          default_payment_method: charge.paymentMethodId,
          metadata: {
            closeout_id: charge.closeoutId,
            batch_id: batch.batchId,
            approved_revision: "1",
            mode: batch.mode,
            table_id: batch.tableId,
            session_date: batch.sessionDate,
            duration_minutes: String(batch.durationMinutes),
            attendance: charge.attendance,
            disposition: "charge_now",
            calculated_amount_cents: String(charge.calculatedCents),
            final_amount_cents: String(charge.finalCents),
            payment_method_id: charge.paymentMethodId,
            approved_by: batch.approvedBy,
            source: "20fates_closeout_app",
          },
        },
        { idempotencyKey: `${charge.closeoutId}:invoice` },
      );
    }
    validateExistingInvoice(invoice, batch, charge);

    const initialAction = existingInvoiceAction(invoice.status);
    if (initialAction === "already_paid") {
      if (invoice.total !== charge.finalCents) {
        throw new Error(`Paid invoice ${invoice.id} has the wrong total.`);
      }
      return {
        status: "recovered",
        invoiceId: invoice.id,
        message: "Already paid; no second charge was attempted.",
      };
    }
    if (initialAction === "blocked") {
      throw new Error(
        `Invoice ${invoice.id} is ${invoice.status || "in an unknown state"}; no payment was attempted.`,
      );
    }

    if (invoice.status === "draft") {
      await ensureInvoiceLine(invoice, batch, charge);
      invoice = await stripe.invoices.finalizeInvoice(
        invoice.id,
        { auto_advance: false },
        { idempotencyKey: `${charge.closeoutId}:finalize` },
      );
    }

    if (invoice.total !== charge.finalCents) {
      throw new Error(
        `Invoice ${invoice.id} total is $${formatDollars(invoice.total)} instead of the approved $${formatDollars(charge.finalCents)}.`,
      );
    }
    if (invoice.status === "paid") {
      return {
        status: "recovered",
        invoiceId: invoice.id,
        message: "Already paid; no second charge was attempted.",
      };
    }
    if (invoice.status !== "open") {
      throw new Error(
        `Invoice ${invoice.id} did not reach an open, payable state.`,
      );
    }
    if (invoice.amount_due !== charge.finalCents) {
      throw new Error(
        `Invoice ${invoice.id} amount due differs from the approved amount; no payment was attempted.`,
      );
    }

    const paidInvoice = await stripe.invoices.pay(
      invoice.id,
      {
        off_session: true,
        payment_method: charge.paymentMethodId,
      },
      { idempotencyKey: `${charge.closeoutId}:pay` },
    );
    if (paidInvoice.status !== "paid") {
      throw new Error(`Stripe did not mark invoice ${invoice.id} paid.`);
    }
    return {
      status: recovered ? "recovered" : "paid",
      invoiceId: paidInvoice.id,
      message: recovered
        ? `Recovered the existing invoice and completed its ${batch.mode} payment.`
        : `${batch.mode === "test" ? "Test" : "Live"} payment succeeded.`,
    };
  };

  const collectApprovedBatch = async () => {
    if (!approvedBatch || collectionAttempted || working) return;
    const pilotError = livePilotBatchError(
      approvedBatch.mode,
      approvedBatch.charges.map((charge) => charge.finalCents),
    );
    if (pilotError) {
      setMessage(pilotError);
      return;
    }
    if (approvedBatch.mode === "live" && liveConfirmation !== "CHARGE") {
      setMessage("Type CHARGE exactly before attempting a live payment.");
      return;
    }

    setWorking(true);
    setCollectionAttempted(true);
    setCollectionResults({});
    setMessage(
      `Attempting the approved Stripe ${approvedBatch.mode} payment once…`,
    );
    let succeeded = 0;
    let failed = 0;

    for (const charge of approvedBatch.charges) {
      try {
        const result = await collectApprovedCharge(approvedBatch, charge);
        succeeded += 1;
        setCollectionResults((current) => ({
          ...current,
          [charge.customerId]: result,
        }));
        updatePlayer(charge.customerId, (current) => ({
          ...current,
          invoiceId: result.invoiceId,
          collectionStatus: result.status,
        }));
      } catch (error) {
        failed += 1;
        const result: CollectionResult = {
          status: "failed",
          message:
            error instanceof Error ? error.message : "Payment failed safely.",
        };
        setCollectionResults((current) => ({
          ...current,
          [charge.customerId]: result,
        }));
        updatePlayer(charge.customerId, (current) => ({
          ...current,
          collectionStatus: "failed",
        }));
      }
    }

    setMessage(
      `${succeeded} ${approvedBatch.mode} payment${succeeded === 1 ? "" : "s"} succeeded or were safely recovered; ${failed} failed. Stripe will not retry them automatically.`,
    );
    setWorking(false);
  };

  const returnToEditing = () => {
    setApprovedBatch(null);
    setCollectionAttempted(false);
    setCollectionResults({});
    setLiveConfirmation("");
    setMessage(
      `Review unlocked. Any paid Stripe ${mode} invoice remains authoritative.`,
    );
  };

  if (loading) {
    return (
      <CloseoutShell drawer={drawer}>
        <Spinner />
      </CloseoutShell>
    );
  }

  return (
    <CloseoutShell drawer={drawer}>
      <Box css={{ stack: "y", gap: "large" }}>
        <Box css={{ stack: "y", gap: "small" }}>
          <Box css={{ font: "heading" }}>Close out a completed session</Box>
          <Box
            css={{
              color: isTestMode ? "secondary" : "critical",
              fontWeight: isTestMode ? undefined : "bold",
            }}
          >
            {isTestMode
              ? "Stripe sandbox mode. Final confirmation can create, finalize, and pay test invoices. It cannot move live money."
              : "LIVE MODE — real money. Only an explicitly authorized live-pilot profile can be reviewed, and collection requires a separate typed confirmation."}
          </Box>
          {message ? (
            <Box
              css={{
                backgroundColor: "container",
                padding: "medium",
                borderRadius: "medium",
              }}
            >
              {message}
            </Box>
          ) : null}
        </Box>

        <Box
          css={{
            stack: drawer ? "y" : "x",
            gap: "medium",
            wrap: drawer ? undefined : "wrap",
          }}
        >
          <Select
            name="table"
            label="Campaign table"
            value={selectedTableId}
            disabled={reviewLocked}
            onChange={(event) => setSelectedTableId(event.target.value)}
          >
            {tables.map((table) => (
              <option key={table.tableId} value={table.tableId}>
                {table.name} — {table.schedule}
              </option>
            ))}
          </Select>
          <DateField
            label="Session date"
            value={sessionDate}
            disabled={reviewLocked}
            onChange={setSessionDate}
          />
          <TextField
            label="Actual duration in minutes"
            type="number"
            value={durationInput}
            disabled={reviewLocked}
            description={
              Number.isInteger(durationMinutes) &&
              durationMinutes > 0 &&
              durationMinutes <= 1440
                ? formatDuration(durationMinutes)
                : "Enter whole minutes"
            }
            onChange={(event) => changeDuration(event.target.value)}
          />
          <Switch
            label="Session occurred"
            checked={sessionOccurred}
            disabled={reviewLocked}
            onChange={(event) => setSessionOccurred(event.target.checked)}
          />
        </Box>

        <Divider />

        <Box css={{ stack: "y", gap: "large" }}>
          {!roster.length ? (
            <Box css={{ color: "secondary" }}>
              {isTestMode
                ? "No 20Fates players are assigned to this table."
                : "No authorized live-pilot player is assigned to an approved live-pilot table. The app is inactive."}
            </Box>
          ) : null}
          {roster.map((row) => (
            <Box
              key={row.customerId}
              css={{
                backgroundColor: "container",
                borderRadius: "medium",
                padding: "large",
                stack: "y",
                gap: "medium",
              }}
            >
              <Box
                css={{
                  stack: drawer ? "y" : "x",
                  gap: "medium",
                  distribute: drawer ? undefined : "space-between",
                }}
              >
                <Box css={{ stack: "y", gap: "xsmall" }}>
                  <Box css={{ fontWeight: "bold" }}>{row.name}</Box>
                  <Box css={{ color: "secondary" }}>
                    {row.email} · {row.paymentLabel}
                  </Box>
                </Box>
                {row.invoiceId ? (
                  <Box css={{ color: "success" }}>
                    {row.collectionStatus === "recovered" ? "Recovered" : "Paid"}{" "}
                    {row.invoiceId}
                  </Box>
                ) : null}
              </Box>

              <Box
                css={{
                  stack: drawer ? "y" : "x",
                  gap: "medium",
                  wrap: drawer ? undefined : "wrap",
                }}
              >
                <TextField
                  label="Agreed hourly rate"
                  type="number"
                  value={row.rateInput}
                  disabled={reviewLocked}
                  description="Private to this player"
                  onChange={(event) =>
                    updatePlayer(row.customerId, (current) => ({
                      ...current,
                      rateInput: event.target.value,
                    }))
                  }
                />
                <Select
                  name={`cadence-${row.customerId}`}
                  label="Normal cadence"
                  value={row.cadence}
                  disabled={reviewLocked}
                  onChange={(event) =>
                    updatePlayer(row.customerId, (current) => ({
                      ...current,
                      cadence: event.target.value,
                      selectedForCollection:
                        event.target.value === "weekly" &&
                        current.disposition === "charge_now" &&
                        current.paymentMethodType === "card" &&
                        autopayAuthorizedForMode(
                          mode,
                          current.autopayStatus,
                          current.autopayAuthorizedAt,
                        ),
                    }))
                  }
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="manual">Manual</option>
                </Select>
                <Button
                  disabled={reviewLocked}
                  onPress={() => void saveProfile(row)}
                >
                  Save profile
                </Button>
                <Button
                  disabled={reviewLocked}
                  onPress={() => void createSetupLink(row)}
                >
                  Create {isTestMode ? "sandbox" : "live"} setup link
                </Button>
                {row.setupUrl ? (
                  <Button href={row.setupUrl} target="_blank">
                    Open Stripe setup
                  </Button>
                ) : null}
              </Box>
              {row.profileError ? (
                <Box css={{ color: "critical" }}>{row.profileError}</Box>
              ) : null}

              <Switch
                label="Include in this weekly card collection"
                checked={row.selectedForCollection}
                disabled={
                  reviewLocked ||
                  row.cadence !== "weekly" ||
                  row.disposition !== "charge_now" ||
                  row.paymentMethodType !== "card" ||
                  !autopayAuthorizedForMode(
                    mode,
                    row.autopayStatus,
                    row.autopayAuthorizedAt,
                  )
                }
                onChange={(event) =>
                  updatePlayer(row.customerId, (current) => ({
                    ...current,
                    selectedForCollection: event.target.checked,
                  }))
                }
              />
              {row.paymentMethodType !== "card" ? (
                <Box css={{ color: "secondary" }}>
                  This pilot requires a saved card set as the customer's default
                  invoice payment method.
                </Box>
              ) : null}

              <Box
                css={{
                  stack: drawer ? "y" : "x",
                  gap: "medium",
                  wrap: drawer ? undefined : "wrap",
                }}
              >
                <Select
                  name={`attendance-${row.customerId}`}
                  label="Attendance"
                  value={row.attendance}
                  disabled={reviewLocked}
                  onChange={(event) =>
                    updatePlayer(row.customerId, (current) => ({
                      ...current,
                      attendance: event.target.value as "present" | "absent",
                    }))
                  }
                >
                  <option value="present">Present</option>
                  <option value="absent">Absent, reserved seat</option>
                </Select>
                <Select
                  name={`disposition-${row.customerId}`}
                  label="Disposition"
                  value={row.disposition}
                  disabled={reviewLocked}
                  onChange={(event) => {
                    const disposition = event.target.value as Disposition;
                    updatePlayer(row.customerId, (current) => ({
                      ...current,
                      disposition,
                      selectedForCollection:
                        disposition === "charge_now" &&
                        current.cadence === "weekly" &&
                        current.paymentMethodType === "card" &&
                        autopayAuthorizedForMode(
                          mode,
                          current.autopayStatus,
                          current.autopayAuthorizedAt,
                        ),
                      finalCents:
                        disposition === "waive" ? 0 : current.calculatedCents,
                      finalInput:
                        disposition === "waive"
                          ? "0.00"
                          : formatDollars(current.calculatedCents),
                    }));
                  }}
                >
                  {(
                    [
                      "charge_now",
                      "monthly",
                      "defer",
                      "partial",
                      "waive",
                    ] as Disposition[]
                  ).map((value) => (
                    <option key={value} value={value}>
                      {dispositionLabel(value)}
                    </option>
                  ))}
                </Select>
                <TextField
                  label="Calculated"
                  value={`$${formatDollars(row.calculatedCents)}`}
                  readOnly
                />
                <TextField
                  label="Approved final amount"
                  type="number"
                  value={row.finalInput}
                  disabled={reviewLocked || row.disposition === "waive"}
                  onChange={(event) =>
                    updatePlayer(row.customerId, (current) => {
                      const value = event.target.value;
                      try {
                        return {
                          ...current,
                          finalInput: value,
                          finalCents: dollarsToCents(value),
                        };
                      } catch {
                        return { ...current, finalInput: value };
                      }
                    })
                  }
                />
              </Box>
              {collectionResults[row.customerId] ? (
                <Box
                  css={{
                    color:
                      collectionResults[row.customerId].status === "failed"
                        ? "critical"
                        : "success",
                  }}
                >
                  {collectionResults[row.customerId].message}
                </Box>
              ) : null}
            </Box>
          ))}
        </Box>

        <Divider />

        <Box
          css={{
            backgroundColor: "container",
            borderRadius: "medium",
            padding: "large",
            stack: "y",
            gap: "medium",
          }}
        >
          {approvedBatch ? (
            <>
              <Box css={{ font: "heading" }}>
                Final {approvedBatch.mode === "test" ? "sandbox" : "live"} confirmation
              </Box>
              <Box>
                {approvedBatch.tableName} · {approvedBatch.sessionDate} ·{" "}
                {formatDuration(approvedBatch.durationMinutes)}
              </Box>
              <Box css={{ fontWeight: "bold" }}>
                {approvedBatch.charges.length} selected player
                {approvedBatch.charges.length === 1 ? "" : "s"} · $
                {formatDollars(
                  approvedBatch.charges.reduce(
                    (total, charge) => total + charge.finalCents,
                    0,
                  ),
                )}
              </Box>
              {approvedBatch.mode === "live" ? (
                <Box css={{ fontWeight: "bold" }}>
                  Recorded per-session cap: $
                  {formatDollars(approvedBatch.charges[0].sessionCapCents!)}.
                  Stripe will reread this cap before any invoice write.
                </Box>
              ) : null}
              {approvedBatch.charges.map((charge) => (
                <Box key={`approved-${charge.customerId}`}>
                  {charge.name}: ${formatDollars(charge.finalCents)} ·{" "}
                  {charge.paymentLabel}
                  {collectionResults[charge.customerId]
                    ? ` · ${collectionResults[charge.customerId].message}`
                    : ""}
                </Box>
              ))}
              <Box css={{ color: "critical", fontWeight: "bold" }}>
                {approvedBatch.mode === "test"
                  ? "Confirming will finalize these invoices and attempt each test card once. It will not include any unselected player."
                  : "LIVE: Confirming will create and finalize one invoice, then charge the authorized saved card once. No unselected player is included."}
              </Box>
              {approvedBatch.mode === "live" ? (
                <TextField
                  label="Type CHARGE to enable the live payment"
                  value={liveConfirmation}
                  disabled={working || collectionAttempted}
                  onChange={(event) => setLiveConfirmation(event.target.value)}
                />
              ) : null}
              <Button
                type="primary"
                disabled={
                  working ||
                  collectionAttempted ||
                  (approvedBatch.mode === "live" && liveConfirmation !== "CHARGE")
                }
                onPress={() => void collectApprovedBatch()}
              >
                {working
                  ? `Collecting approved ${approvedBatch.mode} payment…`
                  : collectionAttempted
                    ? `${approvedBatch.mode === "test" ? "Sandbox" : "Live"} collection attempted`
                    : `Confirm ${approvedBatch.mode === "test" ? "sandbox" : "live"} collection`}
              </Button>
              <Button disabled={working} onPress={returnToEditing}>
                {collectionAttempted ? "Return to editing" : "Cancel final review"}
              </Button>
            </>
          ) : (
            <>
              <Box css={{ font: "heading" }}>Review selected weekly charges</Box>
              <Box>
                {selectedRoster.length} selected player
                {selectedRoster.length === 1 ? "" : "s"} · $
                {formatDollars(collectionTotalCents)}
              </Box>
              {roster.map((row) => (
                <Box key={`review-${row.customerId}`}>
                  {row.selectedForCollection ? "Include" : "Skip"} · {row.name} ·{" "}
                  {dispositionLabel(row.disposition)} · $
                  {formatDollars(row.finalCents)} · {row.paymentLabel}
                </Box>
              ))}
              <Button
                type="primary"
                disabled={working || !sessionOccurred || !selectedRoster.length}
                onPress={() => void prepareCollectionReview()}
              >
                Review selected charges
              </Button>
              <Box css={{ color: "secondary" }}>
                This first step only freezes a review. No Stripe invoice is
                created and no payment is attempted until the separate final
                confirmation{isTestMode ? "." : " and the word CHARGE is typed."}
              </Box>
            </>
          )}
        </Box>
      </Box>
    </CloseoutShell>
  );
}
