"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, button, Card, field, Label, secondary } from "./Phase4Shared";
import { authFetch } from "@/lib/auth-client";
import { AuthenticatedDownload } from "./AuthenticatedDownload";
import {
  bookingSchedule,
  parseMajorMoney,
  type BookingFileInput,
  type PaymentPlan,
} from "@/lib/plot-booking";
import type { plotDetails } from "@/server/modules/plot-maps/bookings.service";
import {
  bookingInputSchema,
  bookingTermsError,
  bookingOfficeDate,
} from "@/lib/plot-booking-validation";
import styles from "./PlotBookingPanel.module.css";
type Details = ReturnType<typeof plotDetails>;
type Options = {
  clients: { id: string; name: string; phone: string }[];
  agents: { id: string; name: string }[];
  defaultAgentId: string;
};
const officeToday = bookingOfficeDate;
function localTime(ms: number) {
  const d = new Date(ms);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
const amount = (value: number, currency: string) =>
  `${currency} ${(value / 100).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function PlotBookingDialog({
  plotId,
  number,
  dialogId,
  viewMapId,
  onClose,
  onChanged,
}: {
  plotId: string;
  number: string;
  dialogId: string;
  viewMapId: string;
  onClose: () => void;
  onChanged: (p: Details["plot"]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  function close() {
    dialog.current?.close();
    onClose();
  }
  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    heading.current?.focus();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      id={dialogId}
      data-plot-booking="true"
      className={styles.dialog}
      aria-label={`Plot ${number} information`}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const d = dialog.current;
        if (!d) return;
        const items = [
          ...d.querySelectorAll<HTMLElement>(
            "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex='-1'])",
          ),
        ].filter(
          (n) =>
            n.getClientRects().length > 0 && !n.closest("fieldset[disabled]"),
        );
        const first = items[0],
          last = items[items.length - 1];
        if (!first) {
          e.preventDefault();
          heading.current?.focus();
        } else if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === heading.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 ref={heading} tabIndex={-1} className="text-xl font-bold">
          Plot {number}
        </h2>
        <button
          type="button"
          className={secondary}
          aria-label="Close plot information"
          onClick={close}
        >
          Close
        </button>
      </div>
      <PlotBookingPanel
        plotId={plotId}
        viewMapId={viewMapId}
        onChanged={onChanged}
      />
    </dialog>
  );
}
export function PlotBookingPanel({
  plotId,
  viewMapId,
  onChanged,
}: {
  plotId: string;
  viewMapId?: string;
  onChanged?: (p: Details["plot"]) => void;
}) {
  const [details, setDetails] = useState<Details | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<Options>({
      clients: [],
      agents: [],
      defaultAgentId: "",
    }),
    [query, setQuery] = useState(""),
    [clientMode, setClientMode] = useState("existing"),
    [clientId, setClientId] = useState(""),
    [agentId, setAgentId] = useState("");
  const [kind, setKind] = useState<"reserve" | "book">("reserve"),
    [token, setToken] = useState("0"),
    [planKind, setPlanKind] = useState<"full" | "installment">("full"),
    [down, setDown] = useState("0"),
    [installments, setInstallments] = useState(12),
    [firstDue, setFirstDue] = useState(""),
    [bookingDate, setBookingDate] = useState(officeToday),
    [expiry, setExpiry] = useState(() => localTime(Date.now() + 86400000)),
    [files, setFiles] = useState<BookingFileInput[]>([]),
    [fileBusy, setFileBusy] = useState(false),
    [reason, setReason] = useState(""),
    [extension, setExtension] = useState(() =>
      localTime(Date.now() + 2 * 86400000),
    );
  const panelRef = useRef<HTMLDivElement>(null);
  const key = useRef(crypto.randomUUID()),
    generation = useRef(0),
    live = useRef(true),
    changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    live.current = true;
    const g = ++generation.current;
    setLoading(true);
    setError("");
    Promise.all([
      api<Details>(`plots/${plotId}`),
      api<Options>(`plots/${plotId}/booking-options`),
    ])
      .then(([d, o]) => {
        if (g !== generation.current || !live.current) return;
        setDetails(d);
        changed.current?.(d.plot);
        setOptions(o);
        setAgentId(o.defaultAgentId);
        setDown(
          d.plot.priceMinor === null
            ? "0"
            : (d.plot.priceMinor / 100).toFixed(2),
        );
      })
      .catch((e) => {
        if (g === generation.current && live.current) setError(e.message);
      })
      .finally(() => {
        if (g === generation.current && live.current) setLoading(false);
      });
    return () => {
      live.current = false;
      generation.current++;
    };
  }, [plotId]);
  useEffect(() => {
    if (query.trim().length < 2) {
      setOptions((o) => ({ ...o, clients: [] }));
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      api<Options>(
        `plots/${plotId}/booking-options?q=${encodeURIComponent(query.trim())}`,
      )
        .then((o) => {
          if (current) setOptions(o);
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, plotId]);
  useEffect(() => {
    const d = panelRef.current?.closest("dialog");
    if (d && (busy || fileBusy || document.activeElement === document.body))
      d.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    if (d && (message || error)) d.scrollTop = 0;
  }, [busy, fileBusy, message, error]);
  function accept(d: Details) {
    if (!live.current) return;
    setDetails(d);
    changed.current?.(d.plot);
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!details || busy || fileBusy) return;
    setError("");
    setMessage("");
    const form = e.currentTarget,
      f = new FormData(form);
    setBusy(true);
    try {
      const total = details.plot.priceMinor;
      if (total === null || total <= 0)
        throw new Error("Publish a positive total plot price before booking.");
      const plan: PaymentPlan = {
        kind: planKind,
        downPaymentMinor: planKind === "full" ? total : parseMajorMoney(down),
        installments: planKind === "full" ? 0 : installments,
        firstDueDate: planKind === "full" ? "" : firstDue,
      };
      bookingSchedule(total, parseMajorMoney(token), bookingDate, plan);
      const body = {
        requestKey: key.current,
        expectedMapId: viewMapId || details.plot.mapId,
        expectedPriceMinor: total,
        currency: details.plot.currency,
        ...(clientMode === "existing"
          ? { clientId }
          : {
              newClient: {
                fullName: String(f.get("fullName") || ""),
                phone: String(f.get("phone") || ""),
                cnic: String(f.get("cnic") || ""),
                email: String(f.get("email") || ""),
                address: String(f.get("address") || ""),
              },
            }),
        agentId,
        bookingType: kind,
        tokenAmountMinor: parseMajorMoney(token),
        bookingDate,
        expiryDate: kind === "reserve" ? new Date(expiry).toISOString() : null,
        paymentPlan: plan,
        notes: String(f.get("notes") || ""),
        files,
      };
      const parsed = bookingInputSchema.safeParse(body);
      if (!parsed.success)
        throw new Error(
          parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        );
      const termError = bookingTermsError(parsed.data);
      if (termError) throw new Error(termError.message);
      const response = await authFetch(`/api/v1/plots/${plotId}/bookings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        }),
        result = await response.json();
      if (response.status === 409) {
        try {
          accept(await api<Details>(`plots/${plotId}`));
        } catch {
          /* Keep original conflict message if refresh also fails. */
        }
      }
      throwIfError(response, result);
      accept(result);
      setMessage(
        "Booking saved. Confirmation PDF and unpaid token invoice issued; no payment was recorded.",
      );
      setFiles([]);
    } catch (e) {
      if (live.current)
        setError(e instanceof Error ? e.message : "Could not save booking.");
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function action(bookingId: string, revision: number, act: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const d = await api<Details>(`plots/${plotId}/bookings`, "PATCH", {
        bookingId,
        revision,
        action: act,
        reason,
        ...(act === "extend"
          ? { expiryDate: new Date(extension).toISOString() }
          : {}),
      });
      accept(d);
      setMessage(`Booking ${act} saved.`);
      setReason("");
      if (act === "cancel") {
        key.current = crypto.randomUUID();
      }
    } catch (e) {
      if (live.current) setError((e as Error).message);
      try {
        accept(await api<Details>(`plots/${plotId}`));
      } catch {
        /* Retain actionable mutation failure. */
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function readFiles(
    list: FileList | null,
    category: BookingFileInput["category"],
  ) {
    if (!list?.length) return;
    setFileBusy(true);
    setError("");
    setFiles((old) => old.filter((f) => f.category !== category));
    try {
      const file = list[0];
      if (
        file.size > 2 * 1024 * 1024 ||
        !["application/pdf", "image/png", "image/jpeg"].includes(file.type)
      )
        throw new Error("Use a PDF, PNG or JPEG no larger than 2 MiB.");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read attachment."));
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.readAsDataURL(file);
      });
      if (live.current)
        setFiles((old) => [
          ...old.filter((f) => f.category !== category),
          {
            name: file.name,
            category,
            mimeType: file.type as BookingFileInput["mimeType"],
            base64,
          },
        ]);
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      if (live.current) setFileBusy(false);
    }
  }
  let schedule: ReturnType<typeof bookingSchedule> = [],
    scheduleError = "";
  if (details?.plot.priceMinor && details.plot.status === "available") {
    try {
      schedule = bookingSchedule(
        details.plot.priceMinor,
        parseMajorMoney(token),
        bookingDate,
        {
          kind: planKind,
          downPaymentMinor:
            planKind === "full"
              ? details.plot.priceMinor
              : parseMajorMoney(down),
          installments: planKind === "full" ? 0 : installments,
          firstDueDate: planKind === "full" ? "" : firstDue,
        },
      );
    } catch (e) {
      scheduleError = (e as Error).message;
    }
  }
  if (loading) return <p role="status">Loading private plot details…</p>;
  return (
    <div ref={panelRef} className="space-y-5">
      {details && viewMapId && details.plot.mapId !== viewMapId && (
        <p role="alert">
          Publication changed. Close this panel and refresh the published map
          before booking.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-emerald-900"
        >
          {message}
        </p>
      )}
      {details && (
        <>
          <div className="rounded-xl bg-slate-50 p-3 space-y-1">
            <h3 className="font-bold">
              {details.plot.projectName} · Plot {details.plot.number}
            </h3>
            <p data-testid="plot-detail-status">
              Status: {details.plot.status}
            </p>
            <p>
              Price:{" "}
              {details.plot.priceMinor === null
                ? "Not set"
                : amount(details.plot.priceMinor, details.plot.currency)}
            </p>
            <p>
              Block / phase: {String(details.plot.block || "Not set")} /{" "}
              {String(details.plot.phase || "Not set")}
            </p>
            <Link
              className="text-emerald-800 underline"
              href={`/plots/${encodeURIComponent(plotId)}`}
            >
              Full plot page & activity
            </Link>
          </div>
          {["sold", "resale"].includes(details.plot.status) && (
            <p>
              Catalogue and authorized booking history only. Sale/ownership
              records, resale contacts and transactions remain Phase E.
            </p>
          )}
          {details.plot.status === "blocked" && (
            <p>
              Blocked: booking is not permitted. No separate block reason has
              been recorded in the current review model.
            </p>
          )}
          {!details.canWrite && (
            <p>
              Read-only: booking writes require leads, invoices and documents
              write permissions.
            </p>
          )}
          {details.plot.status === "available" &&
            (!viewMapId || details.plot.mapId === viewMapId) &&
            details.canWrite &&
            (!details.plot.priceMinor ? (
              <p role="status">
                Publish a positive total price in Review & publish before
                booking.
              </p>
            ) : (
              <form
                onSubmit={submit}
                className="space-y-4"
                aria-label="Plot booking form"
              >
                <h3 className="text-lg font-bold">Reserve / book this plot</h3>
                <p className="text-sm">
                  Plot and price are locked to the current publication. A
                  requested token is an unpaid invoice, not a cash receipt.
                </p>
                <fieldset
                  disabled={busy || fileBusy}
                  className="space-y-4 min-w-0"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Label name="Client mode">
                      <select
                        className={field}
                        value={clientMode}
                        onChange={(e) => setClientMode(e.target.value)}
                      >
                        <option value="existing">Search existing client</option>
                        <option value="new">Create new client</option>
                      </select>
                    </Label>
                    <Label name="Assigned agent">
                      <select
                        required
                        className={field}
                        value={agentId}
                        onChange={(e) => setAgentId(e.target.value)}
                      >
                        <option value="">Choose agent</option>
                        {options.agents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </Label>
                  </div>
                  {clientMode === "existing" ? (
                    <>
                      <Label name="Search clients by name or phone">
                        <input
                          className={field}
                          maxLength={100}
                          value={query}
                          onChange={(e) => {
                            setQuery(e.target.value);
                            setClientId("");
                          }}
                        />
                      </Label>
                      <Label name="Existing client">
                        <select
                          className={field}
                          required
                          value={clientId}
                          onChange={(e) => setClientId(e.target.value)}
                        >
                          <option value="">
                            {query.length < 2
                              ? "Enter at least two characters"
                              : "Choose matching client"}
                          </option>
                          {options.clients.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} · {c.phone}
                            </option>
                          ))}
                        </select>
                      </Label>
                      <p className="text-xs">
                        Up to 30 matches. No match? Select Create new client.
                      </p>
                    </>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Label name="Client full name">
                        <input
                          required
                          minLength={2}
                          maxLength={150}
                          name="fullName"
                          className={field}
                        />
                      </Label>
                      <Label name="Client phone">
                        <input
                          required
                          type="tel"
                          minLength={7}
                          maxLength={30}
                          name="phone"
                          className={field}
                        />
                      </Label>
                      <Label name="Client CNIC / ID (optional)">
                        <input maxLength={40} name="cnic" className={field} />
                      </Label>
                      <Label name="Client email (optional)">
                        <input
                          type="email"
                          maxLength={254}
                          name="email"
                          className={field}
                        />
                      </Label>
                      <Label name="Client address (optional)">
                        <textarea
                          maxLength={500}
                          name="address"
                          className={field}
                        />
                      </Label>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Label name="Booking type">
                      <select
                        className={field}
                        value={kind}
                        onChange={(e) => setKind(e.target.value as typeof kind)}
                      >
                        <option value="reserve">Reserve (pending hold)</option>
                        <option value="book">Book (confirmed)</option>
                      </select>
                    </Label>
                    <Label name={`Token requested (${details.plot.currency})`}>
                      <input
                        required
                        inputMode="decimal"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        className={field}
                      />
                    </Label>
                    <Label name="Booking date (Asia/Karachi today)">
                      <input
                        required
                        type="date"
                        min={officeToday()}
                        max={officeToday()}
                        value={bookingDate}
                        onChange={(e) => setBookingDate(e.target.value)}
                        className={field}
                      />
                    </Label>
                    {kind === "reserve" && (
                      <Label name="Hold expiry (browser local time)">
                        <input
                          required
                          type="datetime-local"
                          value={expiry}
                          onChange={(e) => setExpiry(e.target.value)}
                          className={field}
                        />
                      </Label>
                    )}
                    <Label name="Payment plan">
                      <select
                        className={field}
                        value={planKind}
                        onChange={(e) =>
                          setPlanKind(e.target.value as typeof planKind)
                        }
                      >
                        <option value="full">Full payment</option>
                        <option value="installment">
                          Monthly installments
                        </option>
                      </select>
                    </Label>
                    {planKind === "installment" && (
                      <>
                        <Label
                          name={`Down payment including token (${details.plot.currency})`}
                        >
                          <input
                            required
                            inputMode="decimal"
                            className={field}
                            value={down}
                            onChange={(e) => setDown(e.target.value)}
                          />
                        </Label>
                        <Label name="Number of monthly installments">
                          <input
                            required
                            type="number"
                            min={1}
                            max={120}
                            value={installments}
                            onChange={(e) =>
                              setInstallments(Number(e.target.value))
                            }
                            className={field}
                          />
                        </Label>
                        <Label name="First installment date">
                          <input
                            required
                            type="date"
                            min={bookingDate}
                            value={firstDue}
                            onChange={(e) => setFirstDue(e.target.value)}
                            className={field}
                          />
                        </Label>
                      </>
                    )}
                  </div>
                  <Card title="Payment schedule preview">
                    {scheduleError ? (
                      <p role="status">{scheduleError}</p>
                    ) : (
                      <ol
                        className="max-h-48 overflow-auto text-sm"
                        data-testid="payment-schedule"
                      >
                        {schedule.map((s, i) => (
                          <li key={i}>
                            {s.label} · {s.dueDate} ·{" "}
                            {amount(s.amountMinor, details.plot.currency)}
                          </li>
                        ))}
                      </ol>
                    )}
                    <p className="text-xs">
                      Token is included in the down payment/total. Monthly dates
                      clamp to month-end, amounts sum exactly. Schedule terms do
                      not assert payments received.
                    </p>
                  </Card>
                  <Label name="Booking notes">
                    <textarea name="notes" maxLength={4000} className={field} />
                  </Label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Label name="ID copy (PDF, PNG or JPEG, max 2 MiB)">
                      <input
                        type="file"
                        accept="application/pdf,image/png,image/jpeg"
                        onChange={(e) => readFiles(e.target.files, "id_copy")}
                        className={field}
                      />
                    </Label>
                    <Label name="Payment evidence (unverified, max 2 MiB)">
                      <input
                        type="file"
                        accept="application/pdf,image/png,image/jpeg"
                        onChange={(e) =>
                          readFiles(e.target.files, "payment_receipt")
                        }
                        className={field}
                      />
                    </Label>
                  </div>
                  <p className="text-xs">
                    Files are private evidence, not payment verification. No
                    antivirus guarantee. {files.map((f) => f.name).join(", ")}
                  </p>
                  <ul>
                    {files.map((f) => (
                      <li key={f.category} className="text-sm">
                        {f.name}{" "}
                        <button
                          type="button"
                          className="underline"
                          onClick={() =>
                            setFiles((old) =>
                              old.filter((x) => x.category !== f.category),
                            )
                          }
                        >
                          Remove{" "}
                          {f.category === "id_copy"
                            ? "ID copy"
                            : "payment evidence"}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    disabled={!!scheduleError || fileBusy}
                    className={button}
                    type="submit"
                  >
                    {busy ? "Saving booking…" : "Save plot booking"}
                  </button>
                </fieldset>
              </form>
            ))}
          {details.bookings.length > 0 && (
            <Card title="Booking records">
              {details.bookings.map((b) => (
                <section
                  key={String(b.id)}
                  className="border rounded-xl p-3 space-y-3"
                  aria-label={`Booking ${String(b.id)}`}
                >
                  <h4 className="font-bold">
                    {String(b.client_name || "Client unavailable")} ·{" "}
                    {String(b.status)}
                  </h4>
                  <p className="text-xs break-all">
                    Booking {String(b.id)} · revision {String(b.revision)} ·{" "}
                    {String(b.booking_date)}
                  </p>
                  <dl className="grid gap-x-3 gap-y-1 grid-cols-[100px_minmax(0,1fr)] text-sm break-words">
                    <dt>Phone</dt>
                    <dd>{String(b.client_phone || "Not set")}</dd>
                    <dt>Email</dt>
                    <dd>{String(b.client_email || "Not set")}</dd>
                    <dt>CNIC / ID</dt>
                    <dd>{String(b.client_cnic || "Not set")}</dd>
                    <dt>Address</dt>
                    <dd>{String(b.client_address || "Not set")}</dd>
                    <dt>Agent</dt>
                    <dd>{String(b.agent_name || "Unavailable")}</dd>
                    <dt>Expiry</dt>
                    <dd>
                      {b.expiry_date
                        ? new Date(String(b.expiry_date)).toLocaleString()
                        : "No hold expiry"}
                    </dd>
                    <dt>CRM lead</dt>
                    <dd className="break-all">
                      {String(b.lead_id || "Not linked")}
                    </dd>
                    <dt>Notes</dt>
                    <dd className="whitespace-pre-wrap">
                      {String(b.notes || "None")}
                    </dd>
                  </dl>
                  {b.invoice ? (
                    <p>
                      Token invoice {String(b.invoice.invoice_number)} ·{" "}
                      {amount(
                        Number(b.invoice.amount_minor),
                        String(b.invoice.currency),
                      )}{" "}
                      · {String(b.invoice.status)} (no payment recorded)
                    </p>
                  ) : (
                    <p>No token invoice issued for this legacy booking.</p>
                  )}
                  {Array.isArray(b.payment_plan?.schedule) && (
                    <details>
                      <summary>Saved payment schedule</summary>
                      <ol className="text-sm max-h-48 overflow-auto">
                        {b.payment_plan.schedule.map(
                          (
                            s: {
                              label: string;
                              dueDate: string;
                              amountMinor: number;
                            },
                            i: number,
                          ) => (
                            <li key={i}>
                              {s.label} · {s.dueDate} ·{" "}
                              {amount(s.amountMinor, String(b.currency))}
                            </li>
                          ),
                        )}
                      </ol>
                    </details>
                  )}
                  <div className="flex flex-wrap gap-3">
                    {b.files.map((file) => (
                      <AuthenticatedDownload
                        key={String(file.id)}
                        href={`/api/v1/plots/${encodeURIComponent(plotId)}/files/${encodeURIComponent(String(file.id))}`}
                        className="text-emerald-800 underline"
                      >
                        {file.kind === "confirmation"
                          ? "Download confirmation PDF"
                          : file.kind === "invoice"
                            ? "Download token invoice PDF"
                            : `Download ${String(file.name)}`}
                      </AuthenticatedDownload>
                    ))}
                  </div>
                  {!b.managed && (
                    <p>
                      Legacy booking is read-only until billing and terms are
                      reconciled.
                    </p>
                  )}
                  <p className="text-xs">
                    Issued PDFs preserve original terms; current status/expiry
                    is shown above.
                  </p>
                  {b.managed &&
                    String(b.id) === details.activeBookingId &&
                    details.canWrite &&
                    ["reserved", "booked"].includes(details.plot.status) && (
                      <fieldset disabled={busy} className="space-y-3">
                        <Label name="Reason for booking action">
                          <input
                            minLength={3}
                            maxLength={500}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className={field}
                          />
                        </Label>
                        {b.status === "pending" && (
                          <Label name="Extended hold expiry (browser local time)">
                            <input
                              type="datetime-local"
                              value={extension}
                              onChange={(e) => setExtension(e.target.value)}
                              className={field}
                            />
                          </Label>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {b.status === "pending" && (
                            <>
                              <button
                                type="button"
                                disabled={reason.trim().length < 3}
                                className={button}
                                onClick={() =>
                                  action(
                                    String(b.id),
                                    Number(b.revision),
                                    "confirm",
                                  )
                                }
                              >
                                Confirm booking
                              </button>
                              <button
                                type="button"
                                disabled={reason.trim().length < 3}
                                className={secondary}
                                onClick={() =>
                                  action(
                                    String(b.id),
                                    Number(b.revision),
                                    "extend",
                                  )
                                }
                              >
                                Extend hold
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            disabled={reason.trim().length < 3}
                            className={secondary}
                            onClick={() =>
                              action(String(b.id), Number(b.revision), "cancel")
                            }
                          >
                            Cancel booking
                          </button>
                        </div>
                        <p className="text-xs">
                          Cancellation releases only this active booking and
                          cancels its unpaid token invoice. No refund or CRM
                          deletion is performed. Sale conversion and automatic
                          expiry are Phase E.
                        </p>
                      </fieldset>
                    )}
                </section>
              ))}
            </Card>
          )}
          <Card title="Plot activity">
            <p className="text-xs">
              Latest 100 plot/booking events, newest first; latest 50 booking
              records above. Ownership history is Phase E.
            </p>
            {details.activity.length ? (
              <ol className="space-y-2 text-sm">
                {details.activity.map((a) => (
                  <li key={String(a.id)}>
                    {String(a.created_at)} · {String(a.action)} ·{" "}
                    {String(a.actor || "System")}
                    {a.reason ? ` · ${String(a.reason)}` : ""}
                  </li>
                ))}
              </ol>
            ) : (
              <p>No recorded plot/booking activity yet.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
function throwIfError(
  response: Response,
  result: { error?: { message?: string } },
) {
  if (!response.ok)
    throw new Error(result.error?.message || "Booking request failed.");
}
export function FullPlotPage({ plotId }: { plotId: string }) {
  return (
    <main className="max-w-4xl mx-auto p-4 sm:p-8 space-y-5">
      <h1 className="text-2xl font-bold">Private plot record</h1>
      <nav className="flex gap-4">
        <Link href="/dashboard" className="text-emerald-800 underline">
          Back to dashboard
        </Link>
        <Link href="/login" className="text-emerald-800 underline">
          Sign in if your session expired
        </Link>
      </nav>
      <PlotBookingPanel key={plotId} plotId={plotId} />
    </main>
  );
}
