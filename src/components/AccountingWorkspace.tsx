"use client";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import type {
  financialReport,
  operationalReport,
  ledgerReport,
} from "@/server/modules/accounting/reports.service";
import {
  api,
  Card,
  Label,
  field,
  button,
  secondary,
  cash,
  formData,
  str,
  minor,
  Pager,
} from "./Phase4Shared";
import { AuthenticatedDownload } from "./AuthenticatedDownload";
type Reports = {
  financial: ReturnType<typeof financialReport>;
  operations: ReturnType<typeof operationalReport>;
  ledger: ReturnType<typeof ledgerReport>;
};
type Catalog = {
  accounts: { code: string; name: string; type: string }[];
  projects: { id: string; name: string }[];
  owners: { id: string; name: string }[];
  expenses: {
    id: string;
    expense_date: string;
    description: string;
    reference: string;
    amount_minor: number;
    status: string;
    receipt_name: string | null;
  }[];
  payables: {
    id: string;
    work_order_number: string;
    vendor_name: string;
    actual_cost_minor: number;
    paid_reference: string | null;
  }[];
  schedules: {
    id: string;
    frequency: string;
    next_due_at: string;
    active: number;
  }[];
  deliveries: { id: string; dueAt: string; report: Reports["financial"] }[];
};
const localToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function AccountingWorkspace({
  locale,
  permissions,
}: {
  locale: Locale;
  permissions: string[];
}) {
  const rtl = locale === "ur",
    tr = (en: string, ur: string) => (rtl ? ur : en),
    write = permissions.includes("accounting:write");
  const [tab, setTab] = useState("overview"),
    [catalog, setCatalog] = useState<Catalog | null>(null),
    [reports, setReports] = useState<Reports | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [page, setPage] = useState(1);
  const [query, setQuery] = useState(() => ({
    from: `${localToday().slice(0, 7)}-01`,
    to: localToday(),
    propertyId: "",
    ownerId: "",
  }));
  const params = new URLSearchParams({
    ...query,
    page: String(page),
  }).toString();
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    Promise.all([api<Catalog>("accounting"), api<Reports>(`reports?${params}`)])
      .then(([c, r]) => {
        if (active) {
          setCatalog(c);
          setReports(r);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [params, refresh]);
  async function act(
    action: string,
    data: Record<string, unknown>,
    form?: HTMLFormElement,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ posted?: number }>("accounting", "POST", {
        action,
        ...data,
      });
      setMessage(
        action === "sync"
          ? `${tr("Sources synchronized; new journals", "ماخذ ہم آہنگ، نئے اندراجات")}: ${result.posted}`
          : tr("Saved successfully.", "محفوظ ہو گیا۔"),
      );
      form?.reset();
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  function submit(
    action: string,
    map: (f: FormData) => Record<string, unknown>,
  ) {
    return (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      void act(action, map(formData(e)), form);
    };
  }
  const project = (name = "propertyId", allowOffice = false) => (
    <Label name={tr("Project", "منصوبہ")}>
      <select
        className={field}
        name={name}
        required={!allowOffice}
        defaultValue={query.propertyId}
      >
        {allowOffice && (
          <option value="">
            {tr("Office / unallocated", "دفتر / غیر مختص")}
          </option>
        )}
        {catalog?.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </Label>
  );
  const expenseAccount = () => (
    <Label name={tr("Expense account", "اخراجات کا کھاتہ")}>
      <select className={field} name="accountCode">
        {catalog?.accounts
          .filter((a) => a.type === "expense")
          .map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} · {a.name}
            </option>
          ))}
      </select>
    </Label>
  );
  const input = (
    label: string,
    name: string,
    type = "text",
    value?: string,
  ) => (
    <Label name={label}>
      <input
        className={field}
        name={name}
        type={type}
        required
        defaultValue={value}
        {...(type === "number"
          ? { min: "0.01", max: "10000000000", step: "0.01" }
          : {})}
      />
    </Label>
  );
  const save = (
    <button className={button} disabled={busy}>
      {tr("Save record", "ریکارڈ محفوظ کریں")}
    </button>
  );
  const table = (headers: string[], rows: ReactNode[][]) => (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full text-start text-sm">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} className="text-start p-2 border-b whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="p-2 border-b align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className="p-3 text-slate-500">
          {tr("No records in this scope.", "اس دائرے میں کوئی ریکارڈ نہیں۔")}
        </p>
      )}
    </div>
  );
  const formClass = "grid min-w-0 gap-3 sm:grid-cols-2";
  return (
    <div data-testid="accounting-workspace" className="min-w-0 space-y-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {tr("Accounting & reports", "اکاؤنٹنگ اور رپورٹس")}
          </h1>
          <p className="text-sm text-slate-600">
            {tr(
              "Property operations · Accrual · PKR · Recorded cash is not a verified bank balance.",
              "پراپرٹی کے معاملات · استحقاق · پاکستانی روپے · درج نقد بینک کا تصدیق شدہ بیلنس نہیں۔",
            )}
          </p>
        </div>
        {write && (
          <button
            className={button}
            disabled={busy}
            onClick={() => void act("sync", {})}
          >
            {tr("Synchronize source history", "سابقہ ریکارڈ ہم آہنگ کریں")}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-emerald-800">
          {message}
        </p>
      )}
      <Card title={tr("Report filters", "رپورٹ کی حدود")}>
        <form
          aria-label="Accounting filters"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            const f = formData(e);
            setQuery({
              from: str(f, "from"),
              to: str(f, "to"),
              propertyId: str(f, "propertyId"),
              ownerId: str(f, "ownerId"),
            });
            setPage(1);
          }}
        >
          {input(tr("From", "سے"), "from", "date", query.from)}
          {input(tr("To", "تک"), "to", "date", query.to)}
          <Label name={tr("Project filter", "منصوبے کی حد")}>
            <select className={field} name="propertyId">
              <option value="">{tr("All projects", "تمام منصوبے")}</option>
              {catalog?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Label>
          <Label name={tr("Owner filter", "مالک کی حد")}>
            <select className={field} name="ownerId">
              <option value="">{tr("All owners", "تمام مالکان")}</option>
              {catalog?.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Label>
          <button disabled={busy} className={secondary}>
            {tr("Apply filters", "حدود نافذ کریں")}
          </button>
        </form>
        {permissions.includes("reports:export") && (
          <div className="flex flex-wrap gap-2">
            {["summary", "ledger"].flatMap((report) =>
              ["csv", "xlsx", "pdf"].map((format) => (
                <AuthenticatedDownload
                  key={`${report}-${format}`}
                  href={`/api/v1/reports?${params}&report=${report}&format=${format}`}
                  className={secondary}
                >
                  {tr(
                    report === "summary" ? "Summary" : "Ledger",
                    report === "summary" ? "خلاصہ" : "لیجر",
                  )}{" "}
                  {format.toUpperCase()}
                </AuthenticatedDownload>
              )),
            )}
          </div>
        )}
      </Card>
      <nav aria-label="Accounting views" className="flex flex-wrap gap-2">
        {[
          ["overview", "Overview", "خلاصہ"],
          ["ledger", "Ledger & journals", "لیجر اور اندراجات"],
          ["expenses", "Expenses & payables", "اخراجات اور واجبات"],
          ["budgets", "Budgets", "بجٹ"],
          ["setup", "Accounts & digests", "کھاتے اور خلاصے"],
        ].map(([id, en, ur]) => (
          <button
            key={id}
            className={tab === id ? button : secondary}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {tr(en, ur)}
          </button>
        ))}
      </nav>
      {!reports || !catalog ? (
        <p role="status">
          {tr("Loading accounting…", "اکاؤنٹنگ لوڈ ہو رہی ہے…")}
        </p>
      ) : (
        <>
          <div
            className={`rounded-xl border p-4 text-sm ${reports.financial.reconciliation.fullyPosted ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-300"}`}
          >
            <strong>
              {tr(
                "Organization-wide reconciliation",
                "تنظیم کے تمام کھاتوں کا ملاپ",
              )}
              :{" "}
              {reports.financial.reconciliation.fullyPosted
                ? tr("Sources posted and reconciled", "ماخذ درج اور مماثل")
                : tr(
                    "Incomplete — synchronize or investigate",
                    "نامکمل — ہم آہنگی یا جانچ درکار",
                  )}
            </strong>
            <p>
              AR{" "}
              {cash(
                reports.financial.reconciliation.receivablesDifferenceMinor,
              )}{" "}
              · AP{" "}
              {cash(reports.financial.reconciliation.payablesDifferenceMinor)} ·{" "}
              {tr(
                "Unposted invoices / payments / work orders / credits",
                "غیر درج بل / ادائیگیاں / کام / کریڈٹ",
              )}{" "}
              {reports.financial.reconciliation.unsyncedInvoices}/
              {reports.financial.reconciliation.unsyncedPayments}/
              {reports.financial.reconciliation.unsyncedWorkOrders}/
              {reports.financial.reconciliation.unsyncedCredits}
            </p>
            <p>
              {tr(
                "Legacy clearing is NOT verified cash",
                "سابقہ کلیئرنگ تصدیق شدہ نقد نہیں",
              )}
              : {cash(reports.financial.reconciliation.legacyClearingMinor)}
            </p>
          </div>
          {tab === "overview" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  [
                    tr("Accrual income", "استحقاق آمدنی"),
                    reports.financial.totals.incomeMinor,
                  ],
                  [
                    tr("Expenses", "اخراجات"),
                    reports.financial.totals.expenseMinor,
                  ],
                  [
                    tr("Net income", "خالص آمدنی"),
                    reports.financial.totals.profitMinor,
                  ],
                  [
                    tr("Recorded cash movement", "درج نقد کی تبدیلی"),
                    reports.financial.totals.cashMovementMinor,
                  ],
                  [
                    tr("Receivables closing", "وصول طلب"),
                    reports.financial.totals.receivablesMinor,
                  ],
                  [
                    tr("Payables closing", "واجب الادا"),
                    reports.financial.totals.payablesMinor,
                  ],
                  [tr("Assets", "اثاثے"), reports.financial.totals.assetsMinor],
                  [
                    tr("Liabilities", "ذمہ داریاں"),
                    reports.financial.totals.liabilitiesMinor,
                  ],
                ].map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="rounded-xl border bg-white p-4"
                  >
                    <p className="text-sm text-slate-500">{label}</p>
                    <p className="font-bold text-lg break-words">
                      {cash(Number(value))}
                    </p>
                  </div>
                ))}
              </div>
              <Card
                title={tr(
                  "Trial balance & balance sheet",
                  "ٹرائل بیلنس اور بیلنس شیٹ",
                )}
              >
                {table(
                  [
                    "Code",
                    "Account",
                    "Opening (Dr − Cr)",
                    "Debit",
                    "Credit",
                    "Closing (Dr − Cr)",
                  ],
                  reports.financial.accounts.map((a) => [
                    a.code,
                    a.name,
                    cash(a.openingMinor),
                    cash(a.debitMinor),
                    cash(a.creditMinor),
                    cash(a.closingMinor),
                  ]),
                )}
                <p className="text-sm">
                  {tr("Period debits / credits", "مدت کے ڈیبٹ / کریڈٹ")}:{" "}
                  {cash(reports.financial.totals.debitMinor)} /{" "}
                  {cash(reports.financial.totals.creditMinor)} ·{" "}
                  {tr("Equity + retained earnings", "سرمایہ اور محفوظ آمدنی")}:{" "}
                  {cash(
                    reports.financial.totals.equityMinor +
                      reports.financial.totals.retainedEarningsMinor,
                  )}
                </p>
              </Card>
              <Card title={tr("Current operations", "موجودہ معاملات")}>
                <p>
                  {tr("As of", "بتاریخ")} {reports.operations.asOf} ·{" "}
                  {tr(
                    "Physical units are not prorated by ownership.",
                    "جسمانی یونٹ ملکیت کے تناسب سے تقسیم نہیں ہوتے۔",
                  )}
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <p>
                    {tr("Occupancy", "آباد یونٹ")}:{" "}
                    <strong>
                      {reports.operations.occupancy.occupancyPct}%
                    </strong>{" "}
                    ({reports.operations.occupancy.occupiedUnits}/
                    {reports.operations.occupancy.rentalPoolUnits})
                  </p>
                  <p>
                    {tr("Available units", "دستیاب یونٹ")}:{" "}
                    {reports.operations.occupancy.availableUnits}
                  </p>
                  <p>
                    {tr("Lead cohort conversion", "منتخب رابطوں کی تبدیلی")}:{" "}
                    {reports.operations.leadConversion.conversionPct}%
                  </p>
                </div>
                <p>
                  {tr(
                    "Rent invoice months touched by range: billed / settled (includes legacy)",
                    "منتخب مہینوں کے کرایہ بل: واجب / ادا شدہ (سابقہ سمیت)",
                  )}
                  : {cash(reports.operations.rent.billedMinor)} /{" "}
                  {cash(reports.operations.rent.invoiceSettledMinor)}
                </p>
                <p>
                  {tr(
                    "Recorded rent receipts by payment date",
                    "ادائیگی کی تاریخ کے مطابق درج کرایہ رسیدیں",
                  )}
                  : {cash(reports.operations.rent.recordedReceiptsMinor)}
                </p>
                <p>
                  {tr(
                    "Completed maintenance cost / cost per physical unit",
                    "مکمل مرمت کا خرچ / فی یونٹ خرچ",
                  )}
                  : {cash(reports.operations.maintenance.actualCostMinor)} /{" "}
                  {cash(reports.operations.maintenance.costPerUnitMinor)}
                </p>
                {table(
                  ["Aging bucket", "Current outstanding"],
                  Object.entries(reports.operations.aging).map(([key, n]) => [
                    key,
                    cash(n),
                  ]),
                )}
              </Card>
              <Card title={tr("Arrears aging", "بقایا عمر")}>
                {table(
                  ["Invoice", "Tenant", "Due", "Days overdue", "Outstanding"],
                  reports.operations.arrears.map((a) => [
                    a.invoiceNumber,
                    a.tenantName,
                    a.dueDate,
                    a.daysOverdue,
                    cash(a.outstandingMinor),
                  ]),
                )}
              </Card>
              <Card title={tr("Vacancy duration", "خالی رہنے کی مدت")}>
                {table(
                  ["Project", "Unit", "Vacant since", "Days"],
                  reports.operations.vacancies.map((v) => [
                    v.propertyName,
                    v.unitNumber,
                    v.vacantSince ||
                      tr("Unknown historical date", "سابقہ تاریخ نامعلوم"),
                    v.vacantDays ?? "—",
                  ]),
                )}
              </Card>
              <Card title={tr("Agent performance", "ایجنٹ کی کارکردگی")}>
                {table(
                  [
                    "Agent",
                    "Assigned leads",
                    "Won leads",
                    "Closed deals",
                    "Recorded commission",
                  ],
                  reports.operations.agents.map((a) => [
                    a.name,
                    a.assignedLeads,
                    a.wonLeads,
                    a.closedDeals,
                    cash(a.commissionMinor),
                  ]),
                )}
              </Card>
            </>
          )}
          {tab === "ledger" && (
            <>
              <Card title={tr("Posted ledger", "درج شدہ لیجر")}>
                {table(
                  [
                    "Date",
                    "Reference / source",
                    "Project",
                    "Account",
                    "Debit",
                    "Credit",
                  ],
                  reports.ledger.rows.map((l) => [
                    l.entryDate,
                    <span key={l.id} title={l.description}>
                      {l.reference}
                      <br />
                      <small>
                        {l.sourceType}
                        {l.reversed ? " · reversed" : ""}
                      </small>
                    </span>,
                    l.propertyName || "Office / unallocated",
                    `${l.accountCode} ${l.accountName}`,
                    l.direction === "debit" ? cash(l.amountMinor) : "—",
                    l.direction === "credit" ? cash(l.amountMinor) : "—",
                  ]),
                )}
                <Pager
                  page={page}
                  total={reports.ledger.total}
                  limit={50}
                  onPage={setPage}
                  busy={busy}
                  rtl={rtl}
                />
              </Card>
              {write && (
                <>
                  <Card
                    title={tr("Balanced manual journal", "متوازن دستی اندراج")}
                  >
                    <p className="text-sm">
                      {tr(
                        "Two equal lines. AR, AP and deposits must use their source workflows. Corrections are reversals, never edits.",
                        "دو برابر اندراجات۔ وصولی، واجبات اور ضمانت ان کے اپنے نظام سے درج ہوں۔ تصحیح واپسی سے، تبدیلی سے نہیں۔",
                      )}
                    </p>
                    <form
                      aria-label="Manual journal"
                      className={formClass}
                      onSubmit={submit("journal", (f) => ({
                        propertyId: str(f, "propertyId") || null,
                        entryDate: str(f, "entryDate"),
                        debitCode: str(f, "debitCode"),
                        creditCode: str(f, "creditCode"),
                        amountMinor: minor(f, "amount"),
                        description: str(f, "description"),
                        reference: str(f, "reference"),
                      }))}
                    >
                      {project("propertyId", true)}
                      {input(
                        tr("Entry date", "اندراج کی تاریخ"),
                        "entryDate",
                        "date",
                        localToday(),
                      )}
                      {["debitCode", "creditCode"].map((name, i) => (
                        <Label
                          key={name}
                          name={tr(
                            i ? "Credit account" : "Debit account",
                            i ? "کریڈٹ کھاتہ" : "ڈیبٹ کھاتہ",
                          )}
                        >
                          <select className={field} name={name}>
                            {catalog.accounts
                              .filter(
                                (a) =>
                                  !["1100", "2000", "2100"].includes(a.code),
                              )
                              .map((a) => (
                                <option value={a.code} key={a.code}>
                                  {a.code} · {a.name}
                                </option>
                              ))}
                          </select>
                        </Label>
                      ))}
                      {input("Amount (PKR)", "amount", "number")}
                      {input("Description", "description")}
                      {input("Unique reference", "reference")}
                      {save}
                    </form>
                  </Card>
                  <Card
                    title={tr(
                      "Reverse manual journal",
                      "دستی اندراج واپس کریں",
                    )}
                  >
                    <form
                      aria-label="Reverse journal"
                      className={formClass}
                      onSubmit={submit("reverse", (f) => ({
                        id: str(f, "id"),
                        entryDate: str(f, "entryDate"),
                        reason: str(f, "reason"),
                      }))}
                    >
                      <Label name="Journal on this ledger page">
                        <select className={field} name="id" required>
                          <option value="">Select journal</option>
                          {reports.ledger.rows
                            .filter(
                              (l) =>
                                l.sourceType === "manual" &&
                                l.direction === "debit" &&
                                !l.reversed,
                            )
                            .map((l) => (
                              <option key={l.id} value={l.journalId}>
                                {l.reference}
                              </option>
                            ))}
                        </select>
                      </Label>
                      {input(
                        "Reversal date",
                        "entryDate",
                        "date",
                        localToday(),
                      )}
                      {input("Reason", "reason")}
                      {save}
                    </form>
                  </Card>
                </>
              )}
            </>
          )}
          {tab === "expenses" && (
            <>
              <Card
                title={tr(
                  "Latest organization expenses (up to 100)",
                  "تنظیم کے تازہ اخراجات (زیادہ سے زیادہ ۱۰۰)",
                )}
              >
                {table(
                  [
                    "Date",
                    "Description / reference",
                    "Amount",
                    "Status",
                    "Receipt",
                  ],
                  catalog.expenses.map((e) => [
                    e.expense_date,
                    `${e.description} · ${e.reference}`,
                    cash(e.amount_minor),
                    e.status,
                    e.receipt_name ? (
                      <AuthenticatedDownload
                        href={`/api/v1/accounting?action=receipt&id=${e.id}`}
                        className="underline"
                      >
                        {e.receipt_name}
                      </AuthenticatedDownload>
                    ) : (
                      "—"
                    ),
                  ]),
                )}
              </Card>
              {write && (
                <>
                  <Card
                    title={tr("Record paid expense", "ادا شدہ خرچ درج کریں")}
                  >
                    <p className="text-sm">
                      {tr(
                        "Records an existing payment; does not move money. Completed work-order costs are posted separately, not duplicated here.",
                        "موجودہ ادائیگی درج ہوتی ہے، رقم منتقل نہیں ہوتی۔ مکمل کام کے اخراجات یہاں دوبارہ نہ درج کریں۔",
                      )}
                    </p>
                    <form
                      aria-label="New expense"
                      className={formClass}
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = e.currentTarget,
                          f = formData(e),
                          file = f.get("receipt") as File;
                        let receipt: unknown;
                        try {
                          if (file?.size) {
                            if (file.size > 3 * 1024 * 1024)
                              throw new Error("Receipt must be at most 3 MiB.");
                            receipt = {
                              name: file.name,
                              data: await new Promise<string>(
                                (resolve, reject) => {
                                  const reader = new FileReader();
                                  reader.onload = () =>
                                    resolve(String(reader.result));
                                  reader.onerror = () =>
                                    reject(new Error("Cannot read receipt"));
                                  reader.readAsDataURL(file);
                                },
                              ),
                            };
                          }
                          await act(
                            "expense",
                            {
                              propertyId: str(f, "propertyId"),
                              accountCode: str(f, "accountCode"),
                              amountMinor: minor(f, "amount"),
                              expenseDate: str(f, "expenseDate"),
                              description: str(f, "description"),
                              reference: str(f, "reference"),
                              ...(receipt ? { receipt } : {}),
                            },
                            form,
                          );
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : "Upload failed",
                          );
                        }
                      }}
                    >
                      {project()}
                      {expenseAccount()}
                      {input(
                        "Expense date",
                        "expenseDate",
                        "date",
                        localToday(),
                      )}
                      {input("Amount (PKR)", "amount", "number")}
                      {input("Description", "description")}
                      {input("Unique reference", "reference")}
                      <Label name="Private receipt (optional, PDF/image, max 3 MiB)">
                        <input
                          className={field}
                          name="receipt"
                          type="file"
                          accept="application/pdf,image/png,image/jpeg,image/webp"
                        />
                      </Label>
                      {save}
                    </form>
                  </Card>
                  <Card title={tr("Void an expense", "خرچ واپس کریں")}>
                    <form
                      aria-label="Void expense"
                      className={formClass}
                      onSubmit={submit("voidExpense", (f) => ({
                        id: str(f, "id"),
                        entryDate: str(f, "entryDate"),
                        reason: str(f, "reason"),
                      }))}
                    >
                      <Label name="Expense">
                        <select className={field} name="id" required>
                          <option value="">Select expense</option>
                          {catalog.expenses
                            .filter((e) => e.status === "posted")
                            .map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.reference}
                              </option>
                            ))}
                        </select>
                      </Label>
                      {input("Void date", "entryDate", "date", localToday())}
                      {input("Reason", "reason")}
                      {save}
                    </form>
                  </Card>
                </>
              )}
              <Card
                title={tr(
                  "Latest maintenance payables (up to 100)",
                  "مرمت کے تازہ واجبات (زیادہ سے زیادہ ۱۰۰)",
                )}
              >
                {table(
                  ["Work order", "Vendor", "Actual cost", "Payment reference"],
                  catalog.payables.map((p) => [
                    p.work_order_number,
                    p.vendor_name,
                    cash(p.actual_cost_minor),
                    p.paid_reference || "Unpaid",
                  ]),
                )}
                {write && (
                  <form
                    aria-label="Vendor payment"
                    className={formClass}
                    onSubmit={submit("payVendor", (f) => ({
                      workOrderId: str(f, "workOrderId"),
                      paidDate: str(f, "paidDate"),
                      reference: str(f, "reference"),
                    }))}
                  >
                    <Label name="Completed work order">
                      <select className={field} name="workOrderId" required>
                        <option value="">Select unpaid work order</option>
                        {catalog.payables
                          .filter(
                            (p) => !p.paid_reference && p.actual_cost_minor > 0,
                          )
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.work_order_number} ·{" "}
                              {cash(p.actual_cost_minor)}
                            </option>
                          ))}
                      </select>
                    </Label>
                    {input("Payment date", "paidDate", "date", localToday())}
                    {input("Verified payment reference", "reference")}
                    {save}
                    <p className="text-sm sm:col-span-2">
                      {tr(
                        "Full settlement record only; no bank transfer is initiated.",
                        "صرف مکمل ادائیگی کا ریکارڈ، بینک منتقلی نہیں۔",
                      )}
                    </p>
                  </form>
                )}
              </Card>
            </>
          )}
          {tab === "budgets" && (
            <>
              <Card title={tr("Budget versus actual", "بجٹ بمقابلہ اصل")}>
                <p className="text-sm">
                  {tr(
                    "Budgets cover full months touched by the filter; actual covers the exact selected dates.",
                    "بجٹ منتخب مہینوں کا مکمل ہے؛ اصل خرچ منتخب تاریخوں کا ہے۔",
                  )}
                </p>
                {table(
                  [
                    "Month",
                    "Project",
                    "Account",
                    "Budget",
                    "Actual",
                    "Remaining",
                  ],
                  reports.financial.budgets.map((b) => [
                    b.periodMonth,
                    b.propertyName,
                    `${b.accountCode} ${b.accountName}`,
                    cash(b.plannedMinor),
                    cash(b.actualMinor),
                    cash(b.varianceMinor),
                  ]),
                )}
              </Card>
              {write && (
                <Card
                  title={tr("Save monthly budget", "ماہانہ بجٹ محفوظ کریں")}
                >
                  <form
                    aria-label="Monthly budget"
                    className={formClass}
                    onSubmit={submit("budget", (f) => ({
                      propertyId: str(f, "propertyId"),
                      accountCode: str(f, "accountCode"),
                      periodMonth: str(f, "periodMonth"),
                      amountMinor: minor(f, "amount"),
                    }))}
                  >
                    {project()}
                    {expenseAccount()}
                    {input(
                      "Month",
                      "periodMonth",
                      "month",
                      localToday().slice(0, 7),
                    )}
                    {input("Budget (PKR)", "amount", "number")}
                    {save}
                  </form>
                </Card>
              )}
            </>
          )}
          {tab === "setup" && (
            <>
              <Card title={tr("Chart of accounts", "کھاتوں کی فہرست")}>
                {table(
                  ["Code", "Account", "Type"],
                  catalog.accounts.map((a) => [a.code, a.name, a.type]),
                )}
                {write && (
                  <form
                    aria-label="New account"
                    className={formClass}
                    onSubmit={submit("account", (f) => ({
                      code: str(f, "code"),
                      name: str(f, "name"),
                      type: str(f, "type"),
                    }))}
                  >
                    {input("Four-digit account code", "code")}
                    {input("Account name", "name")}
                    <Label name="Type">
                      <select name="type" className={field}>
                        {[
                          "asset",
                          "liability",
                          "equity",
                          "income",
                          "expense",
                        ].map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </Label>
                    {save}
                  </form>
                )}
              </Card>
              <Card title={tr("Scheduled digests", "شیڈول شدہ خلاصے")}>
                <p>
                  {tr(
                    "Private in-app snapshots only. The report worker must be running. Missed runs are coalesced; no external messages.",
                    "صرف نجی ایپ خلاصے۔ رپورٹ ورکر چلنا ضروری ہے۔ سابقہ رنز اکٹھے ہوتے ہیں؛ بیرونی پیغامات نہیں۔",
                  )}
                </p>
                {write && permissions.includes("reports:export") && (
                  <form
                    aria-label="Digest schedule"
                    className={formClass}
                    onSubmit={submit("schedule", (f) => ({
                      frequency: str(f, "frequency"),
                    }))}
                  >
                    <Label name="Frequency">
                      <select name="frequency" className={field}>
                        {["daily", "weekly", "monthly"].map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    </Label>
                    {save}
                  </form>
                )}
                {table(
                  ["Frequency", "Next due", "Status", "Action"],
                  catalog.schedules.map((s) => [
                    s.frequency,
                    s.next_due_at,
                    s.active ? "Active" : "Paused",
                    write && s.active ? (
                      <button
                        disabled={busy}
                        className={secondary}
                        onClick={() => void act("pauseSchedule", { id: s.id })}
                      >
                        Pause
                      </button>
                    ) : (
                      "—"
                    ),
                  ]),
                )}
                {catalog.deliveries.map((d) => (
                  <details key={d.id} className="rounded-lg border p-3">
                    <summary>
                      {d.report.filter.from} — {d.report.filter.to} ·{" "}
                      {tr("Saved snapshot", "محفوظ خلاصہ")}
                    </summary>
                    <p>
                      Income {cash(d.report.totals.incomeMinor)} · Expense{" "}
                      {cash(d.report.totals.expenseMinor)} · Net{" "}
                      {cash(d.report.totals.profitMinor)} ·{" "}
                      {d.report.reconciliation.fullyPosted
                        ? "Posted"
                        : "Incomplete"}
                    </p>
                    <p>
                      Legacy clearing (not cash):{" "}
                      {cash(d.report.totals.legacyClearingMinor)}
                    </p>
                  </details>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
