"use client";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { domainCatalog } from "@/server/modules/domain-agents/domain.service";
import type {
  Assessment,
  AgentKind,
} from "@/server/modules/domain-agents/contracts";
import {
  api,
  Card,
  Label,
  button,
  field,
  secondary,
  formData,
  str,
} from "./Phase4Shared";
type Catalog = ReturnType<typeof domainCatalog>;
const names: Record<AgentKind, [string, string]> = {
  lead: ["Lead qualification & matching", "رابطے کی اہلیت اور یونٹ"],
  listing: ["Listing copy & price evidence", "اشتہار اور قیمت کے ذرائع"],
  rent: ["Rent reconciliation & reminders", "کرایہ اور یاددہانی"],
  maintenance: ["Maintenance triage & dispatch", "مرمت کی درجہ بندی"],
  lease: ["Lease review & offer drafts", "معاہدہ اور پیشکش"],
  insights: [
    "Portfolio insights & cited retrieval",
    "پورٹ فولیو اور حوالہ جاتی تلاش",
  ],
};
export function DomainAgentsWorkspace({
  locale,
  permissions,
  assessment,
  runId,
  onRun,
  refresh,
  canPropose,
}: {
  locale: Locale;
  permissions: string[];
  assessment: Assessment | null;
  runId: string;
  onRun: (id: string) => void;
  refresh: number;
  canPropose: (tool: string) => boolean;
}) {
  const rtl = locale === "ur",
    tr = (en: string, ur: string) => (rtl ? ur : en);
  const [data, setData] = useState<Catalog | null>(null),
    [kind, setKind] = useState<AgentKind>("lead"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    api<Catalog>("agents/domain")
      .then((c) => {
        if (active) {
          setData(c);
          setKind((k) =>
            c.agents.some((a) => a.kind === k)
              ? k
              : c.agents[0]?.kind || "insights",
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  async function send(action: string, input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ id: string }>("agents/domain", "POST", {
        action,
        ...input,
        requestKey: `domain-${crypto.randomUUID()}`,
      });
      onRun(result.id);
      setMessage(
        tr(
          "Run queued. Advance one step below, or wait for the worker and refresh. No business record changes during assessment.",
          "عمل قطار میں ہے۔ نیچے اگلا مرحلہ چلائیں یا کارکن کے بعد تازہ کریں۔ جائزے سے کاروباری ریکارڈ نہیں بدلتا۔",
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  const optionField = (
    label: string,
    name: string,
    options: { id: string; label: string }[],
    optional = false,
  ) => (
    <Label name={label}>
      <select name={name} className={field} required={!optional}>
        <option value="">
          {optional
            ? tr("None / all", "کوئی نہیں / تمام")
            : tr("Choose a stored record", "درج ریکارڈ منتخب کریں")}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label} · {o.id}
          </option>
        ))}
      </select>
    </Label>
  );
  return (
    <Card title={tr("Six domain agents", "چھ شعبہ وار ایجنٹ")}>
      <div data-testid="domain-agents-workspace" className="space-y-4">
        <p className="text-sm text-slate-600">
          {tr(
            "Local explainable rules and lexical retrieval · English / Urdu drafts · No live model, verified market appraisal, legal certification or external delivery. Every write needs another authorized reviewer.",
            "مقامی واضح قواعد اور متنی تلاش · انگریزی / اردو مسودے · بیرونی ماڈل، قانونی تصدیق یا بیرونی پیغام نہیں۔ ہر تبدیلی کے لیے دوسرے مجاز شخص کی منظوری ضروری ہے۔",
          )}
        </p>
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
        {!data ? (
          <p>{tr("Loading…", "لوڈ ہو رہا ہے…")}</p>
        ) : !data.agents.length ? (
          <p>
            {tr(
              "No domain tools are permitted by your role and current agent allowlists.",
              "آپ کے کردار اور ایجنٹ کی موجودہ اجازتوں میں شعبہ وار ٹول دستیاب نہیں۔",
            )}
          </p>
        ) : (
          <>
            <Label name={tr("Domain agent", "شعبہ وار ایجنٹ")}>
              <select
                className={field}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as AgentKind);
                  setError("");
                  setMessage("");
                }}
              >
                {data.agents.map((a) => (
                  <option key={a.kind} value={a.kind}>
                    {names[a.kind][rtl ? 1 : 0]}
                    {a.enabled ? "" : " · disabled"}
                  </option>
                ))}
              </select>
            </Label>
            {kind === "maintenance" && (
              <p
                role="note"
                className="rounded-lg bg-amber-50 p-3 text-amber-900"
              >
                {tr(
                  "Danger, gas smell, fire, exposed wiring or flooding? Keep away and contact local emergency services and the office now. Do not wait for the agent or attempt repairs. This app does not contact emergency services.",
                  "گیس، آگ، کھلی تاریں یا سیلاب؟ دور رہیں اور فوراً مقامی ایمرجنسی خدمات اور دفتر سے رابطہ کریں۔ ایجنٹ کا انتظار یا خود مرمت نہ کریں۔ ایپ ایمرجنسی خدمات کو رابطہ نہیں کرتی۔",
                )}
              </p>
            )}
            <form
              key={kind}
              aria-label="Domain assessment"
              className="grid min-w-0 gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const f = formData(e),
                  input: Record<string, unknown> = {};
                for (const [key, value] of f.entries())
                  if (String(value).trim()) input[key] = String(value);
                if (input.installments)
                  input.installments = Number(input.installments);
                if (input.minBedrooms)
                  input.minBedrooms = Number(input.minBedrooms);
                for (const key of ["viewingAt", "scheduledAt"])
                  if (input[key])
                    input[key] = new Date(String(input[key])).toISOString();
                void send("assess", { kind, input });
              }}
            >
              {kind === "lead" && (
                <>
                  {optionField(
                    tr("Lead", "رابطہ"),
                    "leadId",
                    data.options.leads,
                  )}
                  <Label name={tr("Intent", "مقصد")}>
                    <select name="intent" className={field}>
                      <option value="sale">{tr("Buy", "خریدنا")}</option>
                      <option value="rent">{tr("Rent", "کرایہ")}</option>
                    </select>
                  </Label>
                  <Label
                    name={tr("Unit type (optional)", "یونٹ کی قسم (اختیاری)")}
                  >
                    <select name="unitType" className={field}>
                      <option value="">{tr("Any", "تمام")}</option>
                      {[
                        "plot",
                        "house",
                        "apartment",
                        "shop",
                        "office",
                        "warehouse",
                      ].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </Label>
                  <Label
                    name={tr(
                      "Minimum bedrooms (optional)",
                      "کم از کم بیڈروم (اختیاری)",
                    )}
                  >
                    <input
                      name="minBedrooms"
                      className={field}
                      type="number"
                      min="0"
                      max="20"
                    />
                  </Label>
                  <Label
                    name={tr(
                      "Explicit viewing time (optional; browser local time)",
                      "ملاقات کا وقت (اختیاری؛ براؤزر کا مقامی وقت)",
                    )}
                  >
                    <input
                      name="viewingAt"
                      type="datetime-local"
                      className={field}
                    />
                  </Label>
                </>
              )}
              {kind === "listing" && (
                <>
                  {optionField(
                    tr("Unit", "یونٹ"),
                    "unitId",
                    data.options.units,
                  )}
                  <Label name={tr("Purpose", "مقصد")}>
                    <select name="purpose" className={field}>
                      <option value="sale">{tr("Sale", "فروخت")}</option>
                      <option value="rent">{tr("Rent", "کرایہ")}</option>
                    </select>
                  </Label>
                </>
              )}
              {kind === "rent" && (
                <>
                  {optionField(
                    tr("Invoice", "بل"),
                    "invoiceId",
                    data.options.invoices,
                  )}
                  <Label
                    name={tr(
                      "Illustrative installment count (not agreed)",
                      "مثالی اقساط کی تعداد (طے شدہ نہیں)",
                    )}
                  >
                    <input
                      name="installments"
                      className={field}
                      type="number"
                      min="1"
                      max="12"
                      defaultValue="3"
                      required
                    />
                  </Label>
                </>
              )}
              {kind === "maintenance" && (
                <>
                  {optionField(
                    tr("Ticket", "درخواست"),
                    "ticketId",
                    data.options.tickets,
                  )}
                  <Label
                    name={tr(
                      "Explicit dispatch time (optional; browser local time)",
                      "روانگی کا وقت (اختیاری؛ براؤزر کا مقامی وقت)",
                    )}
                  >
                    <input
                      name="scheduledAt"
                      type="datetime-local"
                      className={field}
                    />
                  </Label>
                </>
              )}
              {kind === "lease" && (
                <>
                  {optionField(
                    tr("Lease", "معاہدہ"),
                    "leaseId",
                    data.options.leases,
                  )}
                  {optionField(
                    tr(
                      "Stored lease text document (optional, must match lease)",
                      "معاہدے کی متنی دستاویز (اختیاری، اسی معاہدے کی)",
                    ),
                    "documentId",
                    data.options.documents.map((d) => ({
                      ...d,
                      label: `${d.label} · ${d.leaseId}`,
                    })),
                    true,
                  )}
                  <Label
                    name={tr(
                      "Proposed new end date (optional; draft only)",
                      "مجوزہ نئی آخری تاریخ (اختیاری؛ صرف مسودہ)",
                    )}
                  >
                    <input name="newEndDate" type="date" className={field} />
                  </Label>
                </>
              )}
              {kind === "insights" && (
                <>
                  <Label name={tr("Portfolio question", "پورٹ فولیو کا سوال")}>
                    <input
                      name="question"
                      required
                      minLength={3}
                      maxLength={500}
                      className={field}
                      defaultValue={tr(
                        "What is the current occupancy?",
                        "آباد یونٹ کتنے ہیں؟",
                      )}
                    />
                  </Label>
                  {optionField(
                    tr("Project (optional)", "پروجیکٹ (اختیاری)"),
                    "propertyId",
                    data.options.projects,
                    true,
                  )}
                  <Label
                    name={tr(
                      "Financial period from (optional)",
                      "مالی مدت آغاز (اختیاری)",
                    )}
                  >
                    <input name="from" type="date" className={field} />
                  </Label>
                  <Label
                    name={tr(
                      "Financial period to (optional)",
                      "مالی مدت اختتام (اختیاری)",
                    )}
                  >
                    <input name="to" type="date" className={field} />
                  </Label>
                </>
              )}
              <button
                className={button}
                disabled={
                  busy ||
                  !permissions.includes("agents:run") ||
                  !data.agents.find((a) => a.kind === kind)?.enabled
                }
              >
                {tr("Queue assessment", "جائزہ قطار میں ڈالیں")}
              </button>
            </form>
          </>
        )}
        {assessment && (
          <section
            aria-label="Domain assessment result"
            className="space-y-3 border-t pt-4"
          >
            <h3 className="font-semibold">
              {names[assessment.kind][rtl ? 1 : 0]} · {assessment.asOf}
            </h3>
            <p>{rtl ? assessment.summaryUr : assessment.summary}</p>
            <ul className="list-disc space-y-1 ps-5 text-sm text-amber-900">
              {assessment.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            <details open>
              <summary className="cursor-pointer font-medium">
                {tr(
                  "Structured findings & bilingual drafts",
                  "نتائج اور دو لسانی مسودے",
                )}
              </summary>
              <pre
                dir="ltr"
                className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-xs text-slate-100"
              >
                {JSON.stringify(assessment.findings, null, 2)}
              </pre>
            </details>
            <details>
              <summary className="cursor-pointer font-medium">
                {tr("Source citations", "ذرائع کے حوالے")} (
                {assessment.citations.length})
              </summary>
              <ul className="space-y-2 text-sm">
                {assessment.citations.map((c, i) => (
                  <li
                    key={i}
                    className="break-words rounded-lg bg-slate-50 p-2"
                  >
                    {c.entityType} · {c.id} · {c.field}
                    {c.version ? ` · v${c.version}` : ""}
                    {c.updatedAt ? ` · ${c.updatedAt}` : ""}
                    {c.excerpt && (
                      <blockquote className="border-s-2 ps-3">
                        {c.excerpt}
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
            </details>
            {assessment.proposals.length === 0 ? (
              <p>
                {tr(
                  "No safe write proposed; recommendations only.",
                  "محفوظ تبدیلی کی تجویز نہیں؛ صرف مشورہ۔",
                )}
              </p>
            ) : (
              assessment.proposals.map((p) => (
                <div key={p.id} className="rounded-lg border p-3">
                  <p className="font-medium">{p.title}</p>
                  <p className="text-xs text-slate-600">
                    {p.tool} ·{" "}
                    {tr(
                      "Source-bound; independent approval required; no external delivery.",
                      "ذرائع سے منسلک؛ الگ منظوری ضروری؛ بیرونی پیغام نہیں۔",
                    )}
                  </p>
                  <button
                    className={`${secondary} mt-2`}
                    disabled={
                      busy ||
                      !permissions.includes("agents:run") ||
                      !canPropose(p.tool)
                    }
                    onClick={() =>
                      void send("propose", { runId, proposalId: p.id })
                    }
                  >
                    {tr(
                      "Request independent approval",
                      "الگ منظوری کی درخواست",
                    )}
                  </button>
                </div>
              ))
            )}
          </section>
        )}
      </div>
    </Card>
  );
}
