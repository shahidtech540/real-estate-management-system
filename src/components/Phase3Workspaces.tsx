"use client";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  TenantRecord,
  LeaseRecord,
} from "@/server/modules/leases/leases.service";
import type {
  InvoiceRecord,
  PaymentReceiptRecord,
  OwnerStatementRecord,
} from "@/server/modules/billing/billing.service";
import type { Locale } from "@/lib/i18n";

const field =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500";
const button =
  "rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:bg-emerald-800";
const cash = (n: number) =>
  `PKR ${(n / 100).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const currentMonth = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/api/v1/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Request failed");
  return data;
}
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}
function Input({
  name,
  label,
  type = "text",
  required = true,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-600 space-y-1">
      <span>{label}</span>
      <input
        className={field}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        step={type === "number" ? "0.01" : undefined}
        min={type === "number" ? 0 : undefined}
      />
    </label>
  );
}
function Select({
  name,
  label,
  children,
  onChange,
  value,
}: {
  name: string;
  label: string;
  children: ReactNode;
  onChange?: (s: string) => void;
  value?: string;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-600 space-y-1">
      <span>{label}</span>
      <select
        className={field}
        name={name}
        required
        onChange={(e) => onChange?.(e.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}
const formData = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget));
};
const money = (v: FormDataEntryValue | undefined) =>
  Math.round(Number(v) * 100);
interface Props {
  permissions: string[];
  locale: Locale;
  units: { id: string; unitNumber: string; status: string }[];
  onRefresh: () => void;
}

export function TenancyWorkspace({
  permissions,
  locale,
  units,
  onRefresh,
}: Props) {
  const [tenants, setTenants] = useState<TenantRecord[]>([]),
    [leases, setLeases] = useState<LeaseRecord[]>([]);
  const [search, setSearch] = useState(""),
    [expiry, setExpiry] = useState("");
  const [selected, setSelected] = useState(""),
    [details, setDetails] = useState<{
      checklists: {
        kind: string;
        items: { label: string; checked: boolean; notes?: string }[];
        photos: string[];
      }[];
      events: {
        id: string;
        type: string;
        payload: { amountMinor?: number };
        createdAt: string;
      }[];
    }>({ checklists: [], events: [] });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const write = permissions.includes("leases:write"),
    tenantWrite = permissions.includes("tenants:write");
  const tr = (en: string, ur: string) => (locale === "ur" ? ur : en);
  const load = useCallback(async () => {
    const requests = [api("leases").then((d) => setLeases(d.leases))];
    if (permissions.includes("tenants:read"))
      requests.push(api("tenants").then((d) => setTenants(d.tenants)));
    await Promise.all(requests);
  }, [permissions]);
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, [load]);
  useEffect(() => {
    if (selected)
      api(`leases/${selected}/checklist`)
        .then(setDetails)
        .catch((e) => setMessage(e.message));
  }, [selected]);
  async function act(path: string, method: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      await api(path, method, body);
      await load();
      if (selected) setDetails(await api(`leases/${selected}/checklist`));
      onRefresh();
      setMessage(tr("Saved successfully.", "کامیابی سے محفوظ ہو گیا۔"));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const lease = leases.find((l) => l.id === selected);
  const held = details.events.reduce(
    (n, e) =>
      n +
      (e.type === "deposit_received"
        ? e.payload.amountMinor || 0
        : e.type === "deposit_refunded"
          ? -(e.payload.amountMinor || 0)
          : 0),
    0,
  );
  return (
    <div className="space-y-6" dir={locale === "ur" ? "rtl" : "ltr"}>
      <header>
        <h1 className="text-2xl font-bold">
          {tr("Tenants & leases", "کرایہ دار اور معاہدے")}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {tr(
            "KYC, tenancy lifecycle, security deposits and move-in / move-out records.",
            "شناخت کی تصدیق، کرایہ نامہ، ضمانتی رقم اور آمد و روانگی کا ریکارڈ۔",
          )}
        </p>
      </header>
      {message && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm"
        >
          {message}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {["30_days", "60_days", "90_days"].map((w, i) => (
          <button
            key={w}
            onClick={() => setExpiry(expiry === w ? "" : w)}
            className={`rounded-xl border p-5 text-start ${expiry === w ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white"}`}
          >
            <p className="text-xs text-slate-500">
              {tr("Renewal alerts", "تجدید کی یاد دہانی")} · {i * 30}–
              {(i + 1) * 30} {tr("days", "دن")}
            </p>
            <strong className="text-3xl">
              {
                leases.filter(
                  (l) =>
                    ["active", "expiring", "renewed"].includes(l.status) &&
                    l.expiryWindow === w,
                ).length
              }
            </strong>
          </button>
        ))}
      </div>
      {tenantWrite && (
        <Card title={tr("Onboard tenant", "نیا کرایہ دار")}>
          <form
            className="grid gap-3 md:grid-cols-3"
            onSubmit={(e) => {
              const f = formData(e);
              act("tenants", "POST", {
                ...f,
                references: f.referenceName
                  ? [
                      {
                        name: f.referenceName,
                        phone: f.referencePhone,
                        relationship: f.referenceRelationship,
                      },
                    ]
                  : [],
              });
            }}
          >
            <Input name="fullName" label="Full name / نام" />
            <Input name="cnic" label="CNIC (35202-1234567-1)" />
            <Input name="phone" label="Phone / فون" />
            <Input name="email" label="Email / ای میل" type="email" />
            <Input
              name="emergencyContactName"
              label="Emergency contact"
              required={false}
            />
            <Input
              name="emergencyContactPhone"
              label="Emergency phone"
              required={false}
            />
            <Input
              name="referenceName"
              label="Reference name"
              required={false}
            />
            <Input
              name="referencePhone"
              label="Reference phone"
              required={false}
            />
            <Input
              name="referenceRelationship"
              label="Reference relationship"
              required={false}
            />
            <button disabled={busy} className={button}>
              {tr("Register (pending KYC)", "رجسٹر کریں")}
            </button>
          </form>
        </Card>
      )}
      {tenants.length > 0 && (
        <Card
          title={tr(
            "Tenant directory & payment history",
            "کرایہ داروں کی فہرست اور ادائیگیاں",
          )}
        >
          <input
            aria-label="Search tenants"
            className={field}
            placeholder="Search name, CNIC, phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-start">
              <thead>
                <tr className="border-b text-xs text-slate-500">
                  {["Tenant", "KYC", "Invoiced", "Paid", "Balance"].map((x) => (
                    <th className="p-3 text-start" key={x}>
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tenants
                  .filter((t) =>
                    `${t.fullName} ${t.cnic} ${t.phone}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((t) => (
                    <tr className="border-b" key={t.id}>
                      <td className="p-3">
                        <strong>{t.fullName}</strong>
                        <p className="text-xs text-slate-500">
                          {t.cnic} · {t.phone}
                        </p>
                        <p className="text-xs text-slate-400">
                          Emergency: {t.emergencyContactName}{" "}
                          {t.emergencyContactPhone}
                        </p>
                        {t.references.map((r, n) => (
                          <p className="text-xs text-slate-400" key={n}>
                            Reference: {r.name} · {r.phone} · {r.relationship}
                          </p>
                        ))}
                      </td>
                      <td className="p-3">
                        {tenantWrite ? (
                          <select
                            aria-label={`KYC ${t.fullName}`}
                            className={field}
                            value={t.kycStatus}
                            disabled={busy}
                            onChange={(e) =>
                              act("tenants", "PATCH", {
                                id: t.id,
                                kycStatus: e.target.value,
                              })
                            }
                          >
                            {["pending", "verified", "rejected"].map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        ) : (
                          t.kycStatus
                        )}
                      </td>
                      <td className="p-3">{cash(t.totalInvoicedMinor)}</td>
                      <td className="p-3">{cash(t.totalPaidMinor)}</td>
                      <td className="p-3 text-rose-700">
                        {cash(t.arrearsMinor)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            KYC ID files: use Document Vault with entity type tenant and the
            tenant ID. References and emergency contacts must be independently
            verified.
          </p>
        </Card>
      )}
      {write && (
        <Card title={tr("Draft a lease", "کرایہ نامہ تیار کریں")}>
          <form
            className="grid gap-3 md:grid-cols-3"
            onSubmit={(e) => {
              const f = formData(e);
              act("leases", "POST", {
                ...f,
                rentMinor: money(f.rent),
                depositMinor: money(f.deposit),
                escalationPct: Number(f.escalation),
                dueDay: Number(f.dueDay),
                graceDays: Number(f.graceDays),
                lateFeeMinor: money(f.lateFee),
                status: "draft",
              });
            }}
          >
            <Select name="tenantId" label="Tenant">
              <option value="">Choose tenant</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName} ({t.kycStatus})
                </option>
              ))}
            </Select>
            <Select name="unitId" label="Unit">
              <option value="">Choose unit</option>
              {units
                .filter(
                  (u) =>
                    u.status === "available" &&
                    !leases.some(
                      (l) =>
                        l.unitId === u.id &&
                        !["terminated", "expired"].includes(l.status),
                    ),
                )
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.unitNumber}
                  </option>
                ))}
            </Select>
            <Input name="startDate" label="Start date" type="date" />
            <Input name="endDate" label="End date" type="date" />
            <Input name="rent" label="Monthly rent (PKR)" type="number" />
            <Input
              name="deposit"
              label="Agreed security deposit (PKR)"
              type="number"
            />
            <Input
              name="escalation"
              label="Annual escalation (%)"
              type="number"
              defaultValue={10}
            />
            <Input
              name="dueDay"
              label="Due day (1–28)"
              type="number"
              defaultValue={5}
            />
            <Input
              name="graceDays"
              label="Grace days"
              type="number"
              defaultValue={5}
            />
            <Input
              name="lateFee"
              label="One-time late fee (PKR)"
              type="number"
              defaultValue={5000}
            />
            <button disabled={busy} className={button}>
              Create draft
            </button>
          </form>
        </Card>
      )}
      <Card title={tr("Lease register", "معاہدوں کی فہرست")}>
        <button
          className="text-sm text-emerald-700 underline"
          onClick={() => setExpiry("")}
        >
          Show all
        </button>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-slate-500">
                {[
                  "Lease / tenant",
                  "Property / unit",
                  "Term",
                  "Monthly rent",
                  "Status",
                  "Documents",
                ].map((x) => (
                  <th className="p-3 text-start" key={x}>
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leases
                .filter((l) => !expiry || l.expiryWindow === expiry)
                .map((l) => (
                  <tr
                    key={l.id}
                    className={`border-b ${selected === l.id ? "bg-emerald-50" : ""}`}
                  >
                    <td className="p-3">
                      <button
                        className="font-bold text-emerald-700 underline"
                        onClick={() => setSelected(l.id)}
                      >
                        {l.leaseNumber}
                      </button>
                      <p>{l.tenantName}</p>
                    </td>
                    <td className="p-3">
                      {l.propertyName}
                      <p className="text-xs text-slate-500">{l.unitNumber}</p>
                    </td>
                    <td className="p-3 text-xs">
                      {l.startDate} → {l.endDate}
                      <p>{l.daysRemaining} days remaining</p>
                    </td>
                    <td className="p-3">{cash(l.rentMinor)}</td>
                    <td className="p-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">
                        {l.status}
                      </span>
                    </td>
                    <td className="p-3">
                      <a
                        className="text-emerald-700 underline"
                        href={`/api/v1/leases/${l.id}/agreement`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Agreement PDF ↗
                      </a>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {leases.length === 0 && (
            <p className="p-6 text-slate-500">
              No leases available for your account.
            </p>
          )}
        </div>
      </Card>
      {lease && (
        <Card
          title={`${lease.leaseNumber} · ${tr("Lease operations", "معاہدے کی کارروائی")}`}
        >
          <p className="text-sm">
            Deposit agreed: {cash(lease.depositMinor)} · Deposit held:{" "}
            {cash(held)} · Escalation: {lease.escalationPct}%
          </p>
          {write && (
            <form
              className="grid gap-3 md:grid-cols-3"
              onSubmit={(e) => {
                const f = formData(e);
                act("leases", "PATCH", {
                  id: selected,
                  status: f.status,
                  ...(f.newEndDate ? { newEndDate: f.newEndDate } : {}),
                });
              }}
            >
              <Select name="status" label="Next status">
                {{
                  draft: ["pending_signature", "terminated"],
                  pending_signature: ["active", "terminated"],
                  active: ["expiring", "renewed", "terminated"],
                  expiring: ["renewed", "terminated"],
                  renewed: ["expiring", "terminated"],
                  terminated: [],
                  expired: [],
                }[lease.status].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
              <Input
                name="newEndDate"
                label="New end date (required for renewal)"
                type="date"
                required={false}
              />
              <button
                disabled={
                  busy || ["terminated", "expired"].includes(lease.status)
                }
                className={button}
              >
                Update lifecycle
              </button>
            </form>
          )}
          {permissions.includes("payments:write") && (
            <form
              className="grid gap-3 md:grid-cols-4"
              onSubmit={(e) => {
                const f = formData(e);
                act(`leases/${selected}/deposit`, "POST", {
                  type: f.type,
                  amountMinor: money(f.amount),
                  reference: f.reference,
                });
              }}
            >
              <Select name="type" label="Deposit action">
                <option value="deposit_received">
                  Receive security deposit
                </option>
                <option value="deposit_refunded">
                  Refund after termination
                </option>
              </Select>
              <Input name="amount" label="Amount (PKR)" type="number" />
              <Input name="reference" label="Verified transaction reference" />
              <button disabled={busy} className={button}>
                Record deposit
              </button>
            </form>
          )}
          {write && (
            <form
              className="grid gap-3 md:grid-cols-2"
              onSubmit={(e) => {
                const f = formData(e);
                act(`leases/${selected}/checklist`, "PUT", {
                  kind: f.kind,
                  items: String(f.items)
                    .split("\n")
                    .filter(Boolean)
                    .map((label) => ({
                      label,
                      checked: true,
                      notes: String(f.notes),
                    })),
                  photos: String(f.photos)
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                });
              }}
            >
              <Select name="kind" label="Inspection">
                <option value="move_in">Move in</option>
                <option value="move_out">Move out</option>
              </Select>
              <label className="text-xs font-semibold">
                Completed checks (one per line)
                <textarea
                  className={field}
                  name="items"
                  required
                  placeholder="Keys handed over&#10;Meter readings recorded&#10;Walls inspected"
                />
              </label>
              <Input
                name="notes"
                label="Condition / meter readings"
                required={false}
              />
              <label className="text-xs font-semibold">
                Evidence photos (HTTPS URL per line)
                <textarea className={field} name="photos" />
              </label>
              <button disabled={busy} className={button}>
                Save inspection
              </button>
            </form>
          )}
          {details.checklists.map((c) => (
            <div key={c.kind} className="rounded-lg bg-slate-50 p-4">
              <strong>{c.kind}</strong>
              {c.items.map((i, n) => (
                <p className="text-sm" key={n}>
                  {i.checked ? "✓" : "○"} {i.label} {i.notes && `— ${i.notes}`}
                </p>
              ))}
              {c.photos.map((u) => (
                <a
                  className="block text-xs text-emerald-700 underline"
                  key={u}
                  href={u}
                  target="_blank"
                  rel="noreferrer"
                >
                  Inspection photo ↗
                </a>
              ))}
            </div>
          ))}
          <ul className="text-xs text-slate-500 space-y-1">
            {details.events.map((e) => (
              <li key={e.id}>
                {e.createdAt.slice(0, 10)} · {e.type}{" "}
                {e.payload.amountMinor ? cash(e.payload.amountMinor) : ""}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function BillingWorkspace({
  permissions,
  locale,
  onRefresh,
}: Omit<Props, "units">) {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]),
    [payments, setPayments] = useState<PaymentReceiptRecord[]>([]),
    [statements, setStatements] = useState<OwnerStatementRecord[]>([]),
    [leases, setLeases] = useState<LeaseRecord[]>([]);
  const [month, setMonth] = useState(currentMonth()),
    [filter, setFilter] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [aging, setAging] = useState<
    Record<string, { count: number; totalMinor: number }>
  >({});
  const [charges, setCharges] = useState<
    {
      id: string;
      type: string;
      amountMinor: number;
      startMonth: string;
      endMonth: string;
    }[]
  >([]);
  const [credits, setCredits] = useState<
    { id: string; invoiceId: string; amountMinor: number; reason: string }[]
  >([]);
  const tr = (en: string, ur: string) => (locale === "ur" ? ur : en);
  const load = useCallback(async () => {
    const requests: Promise<unknown>[] = [];
    if (permissions.includes("invoices:read")) {
      requests.push(
        api("billing/invoices").then((d) => {
          setInvoices(d.invoices);
          setCredits(d.creditNotes);
          setCharges(d.recurringCharges);
        }),
      );
      requests.push(api("billing/arrears").then((d) => setAging(d.buckets)));
    }
    if (permissions.includes("payments:read"))
      requests.push(
        api("billing/payments").then((d) => setPayments(d.payments)),
      );
    if (permissions.includes("statements:read"))
      requests.push(
        api("billing/statements").then((d) => setStatements(d.statements)),
      );
    if (permissions.includes("leases:read"))
      requests.push(api("leases").then((d) => setLeases(d.leases)));
    await Promise.all(requests);
  }, [permissions]);
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, [load]);
  async function act(path: string, method: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const result = await api(path, method, body);
      await load();
      onRefresh();
      setMessage(
        result.generatedCount !== undefined
          ? `Generated ${result.generatedCount}, skipped ${result.skippedCount}.`
          : tr("Saved successfully.", "کامیابی سے محفوظ ہو گیا۔"),
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const visible = invoices.filter(
    (i) => i.periodMonth === month && (!filter || i.status === filter),
  );
  const outstanding = invoices.filter(
    (i) => i.balanceMinor > 0 && i.status !== "cancelled",
  );
  return (
    <div className="space-y-6" dir={locale === "ur" ? "rtl" : "ltr"}>
      <header>
        <h1 className="text-2xl font-bold">
          {tr(
            "Rent, payments & owner statements",
            "کرایہ، ادائیگیاں اور مالکان کے گوشوارے",
          )}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {tr(
            "Amounts in PKR. Record verified external payments or explicitly simulate a test gateway payment.",
            "تمام رقوم پاکستانی روپے میں۔ تصدیق شدہ ادائیگی کا ریکارڈ درج کریں۔",
          )}
        </p>
      </header>
      {message && (
        <div
          role="status"
          className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm"
        >
          {message}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-4">
        {Object.entries(aging).map(([key, b]) => (
          <div
            key={key}
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            <p className="text-xs text-slate-500">
              {key.replaceAll("_", "–").replace("plus", "+")}{" "}
              {tr("days overdue", "دن واجب الادا")}
            </p>
            <p className="text-lg font-bold text-rose-700">
              {cash(b.totalMinor)}
            </p>
            <p className="text-xs">{b.count} invoices</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-xs font-semibold">
          {tr("Billing period", "بلنگ کا مہینہ")}
          <input
            className={field}
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        {permissions.includes("invoices:write") && (
          <>
            <button
              disabled={busy || !month}
              className={button}
              onClick={() =>
                act("billing/invoices", "POST", {
                  action: "rent_cycle",
                  periodMonth: month,
                })
              }
            >
              Generate rent cycle
            </button>
            <button
              disabled={busy}
              className={button}
              onClick={() =>
                act("billing/invoices", "PATCH", { action: "late_fees" })
              }
            >
              Apply eligible late fees
            </button>
          </>
        )}
        {permissions.includes("accounting:write") && (
          <button
            disabled={busy || !month}
            className={button}
            onClick={() =>
              act("billing/statements", "POST", { periodMonth: month })
            }
          >
            Generate owner statements
          </button>
        )}
      </div>
      <Card title={tr("Invoice register", "انوائس رجسٹر")}>
        <select
          aria-label="Invoice status filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={`${field} max-w-xs`}
        >
          <option value="">All statuses</option>
          {["pending", "partially_paid", "paid", "overdue"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-slate-500">
                {[
                  "Invoice / tenant",
                  "Type / due",
                  "Total",
                  "Paid",
                  "Balance",
                  "Status",
                ].map((x) => (
                  <th key={x} className="text-start p-3">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => (
                <tr key={i.id} className="border-b">
                  <td className="p-3">
                    <strong>{i.invoiceNumber}</strong>
                    <p className="text-xs">
                      {i.tenantName} · {i.unitNumber}
                    </p>
                  </td>
                  <td className="p-3 text-xs">
                    {i.type}
                    <p>{i.dueDate}</p>
                  </td>
                  <td className="p-3">
                    {cash(i.totalMinor)}
                    <p className="text-xs text-slate-400">
                      Late fee: {cash(i.lateFeeMinor)}
                    </p>
                  </td>
                  <td className="p-3">{cash(i.paidMinor)}</td>
                  <td className="p-3">{cash(i.balanceMinor)}</td>
                  <td className="p-3 text-xs">{i.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && (
            <p className="p-6 text-slate-500">No invoices for this period.</p>
          )}
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        {permissions.includes("invoices:write") && (
          <Card title="Utilities & other charges">
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                const f = formData(e);
                act("billing/invoices", "POST", {
                  ...f,
                  ...(f.schedule === "recurring"
                    ? {
                        action: "recurring_charge",
                        startMonth: month,
                        endMonth: f.endMonth,
                      }
                    : {}),
                  periodMonth: month,
                  amountMinor: money(f.amount),
                });
              }}
            >
              <Select name="leaseId" label="Lease">
                <option value="">Choose lease</option>
                {leases.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.leaseNumber} · {l.tenantName}
                  </option>
                ))}
              </Select>
              <Select name="type" label="Charge">
                <option value="utilities">Utilities</option>
                <option value="maintenance">Maintenance</option>
                <option value="parking">Parking</option>
                <option value="service_charge">Service charge</option>
              </Select>
              <Input name="amount" type="number" label="Amount (PKR)" />
              <Input
                name="dueDate"
                type="date"
                label="Due date (one-time charge)"
                required={false}
              />
              <Select name="schedule" label="Schedule">
                <option value="once">One-time charge</option>
                <option value="recurring">
                  Monthly from selected billing period
                </option>
              </Select>
              <Input
                name="endMonth"
                type="month"
                label="End month (recurring only)"
                required={false}
              />
              <button disabled={busy} className={button}>
                Save charge
              </button>
            </form>
            {charges.map((c) => (
              <p key={c.id} className="text-xs text-slate-500">
                {c.type}: {cash(c.amountMinor)} monthly · {c.startMonth} to{" "}
                {c.endMonth}
              </p>
            ))}
          </Card>
        )}
        {permissions.includes("payments:write") && (
          <Card title={tr("Record a payment", "ادائیگی درج کریں")}>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                const f = formData(e);
                act(
                  f.simulate === "yes"
                    ? "billing/checkout"
                    : "billing/payments",
                  "POST",
                  {
                    invoiceId: f.invoiceId,
                    method: f.method,
                    amountMinor: money(f.amount),
                    referenceNumber: f.reference,
                    requestId: f.reference,
                  },
                );
              }}
            >
              <Select name="invoiceId" label="Outstanding invoice">
                <option value="">Choose invoice</option>
                {outstanding.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoiceNumber} · {i.tenantName} · {cash(i.balanceMinor)}
                  </option>
                ))}
              </Select>
              <Select name="method" label="Payment method">
                {[
                  "bank_transfer",
                  "cash",
                  "jazzcash",
                  "easypaisa",
                  "stripe",
                ].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
              <Input
                name="amount"
                type="number"
                label="Amount received (PKR)"
              />
              <Input
                name="reference"
                label="Unique transaction reference (8+ chars for mock)"
              />
              <Select name="simulate" label="Processing mode">
                <option value="no">
                  Record verified external payment (no charge)
                </option>
                <option value="yes">
                  MOCK gateway test (JazzCash / Easypaisa / Stripe only)
                </option>
              </Select>
              <button disabled={busy} className={button}>
                Record & issue receipt
              </button>
              <p className="text-xs text-slate-500">
                Partial payments supported. Duplicate references are idempotent.
                Excess payments are rejected, not silently allocated.
              </p>
            </form>
          </Card>
        )}
        {permissions.includes("invoices:write") && (
          <Card title="Credit note">
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                const f = formData(e);
                act("billing/invoices", "PATCH", {
                  action: "credit",
                  invoiceId: f.invoiceId,
                  creditMinor: money(f.amount),
                  reason: f.reason,
                });
              }}
            >
              <Select name="invoiceId" label="Invoice">
                <option value="">Choose invoice</option>
                {outstanding.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoiceNumber} · {cash(i.balanceMinor)}
                  </option>
                ))}
              </Select>
              <Input name="amount" label="Credit (PKR)" type="number" />
              <Input name="reason" label="Reason (audited)" />
              <button disabled={busy} className={button}>
                Issue credit
              </button>
            </form>
            {credits.map((c) => (
              <p key={c.id} className="text-xs text-slate-500">
                {cash(c.amountMinor)} · {c.reason} ·{" "}
                {invoices.find((i) => i.id === c.invoiceId)?.invoiceNumber}
              </p>
            ))}
          </Card>
        )}
      </div>
      {permissions.includes("payments:read") && (
        <Card
          title={tr(
            "Payment history & PDF receipts",
            "ادائیگیوں کا ریکارڈ اور رسیدیں",
          )}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b">
                  {[
                    "Receipt / date",
                    "Tenant",
                    "Method / reference",
                    "Amount",
                    "Download",
                  ].map((s) => (
                    <th className="p-3 text-start" key={s}>
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.paymentId} className="border-b">
                    <td className="p-3">
                      {p.receiptNumber}
                      <p className="text-xs">{p.paidAt.slice(0, 10)}</p>
                    </td>
                    <td className="p-3">{p.tenantName}</td>
                    <td className="p-3">
                      {p.method}
                      <p className="text-xs text-slate-400">
                        {p.referenceNumber}
                      </p>
                    </td>
                    <td className="p-3">{cash(p.amountMinor)}</td>
                    <td className="p-3">
                      <a
                        href={p.pdfUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-700 underline"
                      >
                        PDF ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {permissions.includes("statements:read") && (
        <Card
          title={tr(
            "Owner statements & payouts",
            "مالکان کے گوشوارے اور ادائیگیاں",
          )}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {statements
              .filter((s) => s.periodMonth === month)
              .map((s) => (
                <article
                  key={s.id}
                  className="rounded-xl border border-slate-200 p-4 space-y-2"
                >
                  <h3 className="font-bold">
                    {s.ownerName}{" "}
                    <span className="text-xs font-normal text-slate-500">
                      {s.status}
                    </span>
                  </h3>
                  <p className="text-sm">
                    Gross rent {cash(s.grossRentMinor)} − Expenses{" "}
                    {cash(s.expensesMinor)} − Fee ({s.managementFeePct}%){" "}
                    {cash(s.managementFeeMinor)}
                  </p>
                  <p className="text-xl font-bold text-emerald-700">
                    Net: {cash(s.netPayoutMinor)}
                  </p>
                  {s.lineItems.map((l) => (
                    <p key={l.propertyId} className="text-xs text-slate-500">
                      {l.propertyName} · {l.ownershipPct}% ownership · Share{" "}
                      {cash(l.ownerShareGrossRentMinor)}
                    </p>
                  ))}
                  <a
                    href={`/api/v1/billing/statements?id=${s.id}&format=pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-emerald-700 underline"
                  >
                    Download statement PDF ↗
                  </a>
                  {permissions.includes("payments:write") &&
                    s.status !== "paid" &&
                    s.netPayoutMinor > 0 && (
                      <form
                        className="flex gap-2 items-end"
                        onSubmit={(e) => {
                          const f = formData(e);
                          act("billing/statements", "PATCH", {
                            id: s.id,
                            reference: f.reference,
                          });
                        }}
                      >
                        <Input
                          name="reference"
                          label="Payout transfer reference"
                        />
                        <button disabled={busy} className={button}>
                          Mark paid
                        </button>
                      </form>
                    )}
                </article>
              ))}
          </div>
          {statements.filter((s) => s.periodMonth === month).length === 0 && (
            <p className="text-sm text-slate-500">
              No statements issued for this month yet.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
