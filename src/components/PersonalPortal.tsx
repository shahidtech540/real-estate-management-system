"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearAccessToken } from "@/lib/auth-client";
import { AuthenticatedDownload } from "./AuthenticatedDownload";
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
} from "./Phase4Shared";
import type {
  portalSummary,
  portalPage,
} from "@/server/modules/portals/portals.service";
type Summary = ReturnType<typeof portalSummary>;
type Page = ReturnType<typeof portalPage>;
export function PersonalPortal({ expectedRole }: { expectedRole?: string }) {
  const router = useRouter(),
    [data, setData] = useState<Summary | null>(null),
    [records, setRecords] = useState<Page | null>(null),
    [resource, setResource] = useState("leases"),
    [page, setPage] = useState(1),
    [ur, setUr] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const tr = (en: string, urdu: string) => (ur ? urdu : en);
  useEffect(() => {
    let active = true;
    api<Summary>("portal")
      .then((d) => {
        if (active) {
          setData(d);
          if (d.role === "owner")
            setResource((r) => (r === "leases" ? "properties" : r));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!data || data.role === "staff" || resource === "documents") return;
    let active = true;
    setRecords(null);
    api<Page>(`portal?resource=${resource}&page=${page}&limit=20`)
      .then((p) => {
        if (active) setRecords(p);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [resource, page, refresh, data?.role]);
  async function post(path: string, method: string, input: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(path, method, input);
      setMessage(
        (input as { action?: string }).action === "request_consent"
          ? "Request saved. The linked owner can review it in their portal."
          : "Saved. Review the latest recorded state.",
      );
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  const wrong = expectedRole && data && data.role !== expectedRole;
  const tabs =
    data?.role === "owner"
      ? [
          "properties",
          "units",
          "leases",
          "invoices",
          "payments",
          "tickets",
          "statements",
          "reviews",
          "documents",
          "notifications",
        ]
      : [
          "leases",
          "invoices",
          "payments",
          "tickets",
          "documents",
          "notifications",
        ];
  return (
    <main
      dir={ur ? "rtl" : "ltr"}
      className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8"
      data-testid="personal-portal"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-emerald-800">
            {String(data?.company || "Fahad Real Estate")}
          </p>
          <h1 className="text-2xl font-bold">
            {data?.role === "owner"
              ? tr("Owner portal", "مالک کا پورٹل")
              : data?.role === "staff"
                ? tr("Owner consent requests", "مالک کی رضامندی کی درخواستیں")
                : tr("Tenant portal", "کرایہ دار کا پورٹل")}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={secondary} onClick={() => setUr((v) => !v)}>
            {ur ? "English" : "اردو"}
          </button>
          <Link href="/dashboard" className={secondary}>
            {tr("Role workspace", "کردار کا صفحہ")}
          </Link>
          <button
            className={secondary}
            onClick={async () => {
              try {
                await api("auth/logout", "POST", {});
              } finally {
                clearAccessToken();
                router.push("/login");
              }
            }}
          >
            {tr("Sign out", "سائن آؤٹ")}
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}{" "}
          <Link href="/login" className="underline">
            {tr("Sign in", "لاگ ان")}
          </Link>
        </p>
      )}
      {!data ? (
        <p>
          {tr(
            "Loading your linked records…",
            "آپ کا متعلقہ ریکارڈ لوڈ ہو رہا ہے…",
          )}
        </p>
      ) : wrong ? (
        <p role="alert">
          {tr(
            "This portal requires a different role.",
            "اس پورٹل کے لیے دوسرا کردار ضروری ہے۔",
          )}{" "}
          <Link href="/portal" className="underline">
            {tr("Open your portal", "اپنا پورٹل کھولیں")}
          </Link>
        </p>
      ) : (
        <>
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            {tr(
              "Recorded, unverified data. No live payment, bank verification or automatic lease execution. Owner consent is a recorded acknowledgement, not a contract amendment or authorization to bypass staff/agent approvals.",
              "درج غیر تصدیق شدہ / نمونہ ریکارڈ۔ حقیقی ادائیگی، بینک کی تصدیق یا خودکار معاہدہ نہیں۔ مالک کی رضامندی صرف ریکارڈ ہے؛ معاہدے میں تبدیلی یا عملے کی منظوری کا متبادل نہیں۔",
            )}
          </p>
          {data.role === "staff" && data.options.linking && (
            <Card
              title={tr(
                "Administrator: link a personal account",
                "منتظم: ذاتی اکاؤنٹ منسلک کریں",
              )}
            >
              <p>
                Verify identity and authorization offline first. Matching emails
                alone never grant access. Linking/replacing/unlinking changes
                visibility immediately and is audited.
              </p>
              <form
                aria-label="Link portal profile"
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = formData(e),
                    [profileType, profileId] = str(f, "profile").split(":");
                  void post("portal", "POST", {
                    action: "link_profile",
                    profileType,
                    profileId,
                    userId: str(f, "user") || null,
                  });
                }}
              >
                <Label name="Business profile">
                  <select name="profile" className={field} required>
                    <option value="">Choose existing profile</option>
                    {data.options.linking.owners.map((o) => (
                      <option key={String(o.id)} value={`owner:${o.id}`}>
                        {String(o.label)} · owner ·{" "}
                        {String(o.user_id || "unlinked")}
                      </option>
                    ))}
                    {data.options.linking.tenants.map((t) => (
                      <option key={String(t.id)} value={`tenant:${t.id}`}>
                        {String(t.label)} · tenant ·{" "}
                        {String(t.user_id || "unlinked")}
                      </option>
                    ))}
                  </select>
                </Label>
                <Label name="Matching-role account (blank unlinks)">
                  <select name="user" className={field}>
                    <option value="">Unlink account</option>
                    {data.options.linking.users.map((u) => (
                      <option key={String(u.id)} value={String(u.id)}>
                        {String(u.label)} · {String(u.role)}
                      </option>
                    ))}
                  </select>
                </Label>
                <button className={button} disabled={busy}>
                  Save profile link
                </button>
              </form>
            </Card>
          )}
          {data.role === "staff" ? (
            <Card
              title={tr(
                "Request linked owner consent",
                "متعلقہ مالک کی رضامندی طلب کریں",
              )}
            >
              <form
                aria-label="Owner consent request"
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = formData(e),
                    [entityType, entityId] = str(f, "source").split(":");
                  void post("portal", "POST", {
                    action: "request_consent",
                    entityType,
                    entityId,
                    ownerId: str(f, "owner"),
                    summary: str(f, "summary"),
                    proposedCostMinor: Math.round(Number(str(f, "cost")) * 100),
                  });
                }}
              >
                <Label name="Linked owner">
                  <select name="owner" className={field} required>
                    <option value="">Choose owner</option>
                    {data.options.owners.map((o) => (
                      <option key={String(o.id)} value={String(o.id)}>
                        {String(o.label)}
                      </option>
                    ))}
                  </select>
                </Label>
                <Label name="Source lease / ticket">
                  <select name="source" className={field} required>
                    <option value="">Choose source</option>
                    {data.options.leases.map((l) => (
                      <option key={String(l.id)} value={`lease:${l.id}`}>
                        {String(l.label)}
                      </option>
                    ))}
                    {data.options.tickets.map((t) => (
                      <option key={String(t.id)} value={`maintenance:${t.id}`}>
                        {String(t.label)}
                      </option>
                    ))}
                  </select>
                </Label>
                <Label name="Proposal summary">
                  <textarea
                    className={field}
                    name="summary"
                    required
                    minLength={5}
                    maxLength={1200}
                  />
                </Label>
                <Label name="Proposed cost PKR (estimate only)">
                  <input
                    type="number"
                    className={field}
                    name="cost"
                    defaultValue="0"
                    min="0"
                    max="10000000000"
                    step="0.01"
                    required
                  />
                </Label>
                <button className={button} disabled={busy}>
                  {tr("Request owner consent", "مالک کی رضامندی طلب کریں")}
                </button>
              </form>
              <p role="status">
                {message
                  ? tr(message, "کامیابی سے محفوظ۔ موجودہ ریکارڈ دیکھیں۔")
                  : ""}
              </p>
            </Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Card title={tr("Linked profiles", "متعلقہ پروفائل")}>
                  <p className="text-2xl font-bold">{data.linkedProfiles}</p>
                </Card>
                <Card
                  title={
                    data.role === "owner"
                      ? tr(
                          "Whole-property invoice balance (not owner share)",
                          "پراپرٹی کے بلوں کا بقایا (مالک کا حصہ نہیں)",
                        )
                      : tr(
                          "Your recorded outstanding invoices",
                          "آپ کے درج بقایا بل",
                        )
                  }
                >
                  <p className="text-2xl font-bold">
                    {cash(data.outstandingMinor)}
                  </p>
                </Card>
              </div>
              <nav aria-label="Portal records" className="flex flex-wrap gap-2">
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    className={resource === tab ? button : secondary}
                    onClick={() => {
                      setResource(tab);
                      setPage(1);
                      setError("");
                    }}
                  >
                    {tr(
                      tab,
                      (
                        {
                          leases: "معاہدے",
                          invoices: "بل",
                          payments: "ادائیگیاں",
                          tickets: "مرمت",
                          properties: "پروجیکٹس",
                          units: "یونٹ",
                          statements: "حساب",
                          reviews: "رضامندی",
                          documents: "دستاویزات",
                          notifications: "پیغامات",
                        } as Record<string, string>
                      )[tab],
                    )}
                  </button>
                ))}
              </nav>
              {resource === "documents" ? (
                <Vault />
              ) : (
                <Card
                  title={`${tr("Your records", "آپ کا ریکارڈ")} · ${resource}`}
                >
                  <div className="space-y-3">
                    {!records ? (
                      <p>Loading…</p>
                    ) : records.items.length === 0 ? (
                      <p>
                        {tr(
                          "No linked records here. Staff must link your account; no records from other users are shown.",
                          "یہاں کوئی متعلقہ ریکارڈ نہیں۔ عملہ آپ کا اکاؤنٹ منسلک کرے؛ دوسروں کا ریکارڈ نہیں دکھایا جاتا۔",
                        )}
                      </p>
                    ) : (
                      records.items.map((r) => (
                        <article
                          key={String(r.id)}
                          className="rounded-lg border border-slate-200 p-3"
                        >
                          <PortalRecord record={r} ur={ur} />
                          {resource === "leases" && (
                            <AuthenticatedDownload
                              className={secondary}
                              href={`/api/v1/leases/${r.id}/agreement`}
                            >
                              {tr(
                                "Download unsigned template PDF",
                                "غیر دستخط شدہ معاہدے کا پی ڈی ایف",
                              )}
                            </AuthenticatedDownload>
                          )}
                          {resource === "statements" && (
                            <AuthenticatedDownload
                              className={secondary}
                              href={`/api/v1/billing/statements?format=pdf&id=${r.id}`}
                            >
                              {tr(
                                "Download statement PDF",
                                "حساب کا پی ڈی ایف",
                              )}
                            </AuthenticatedDownload>
                          )}
                          {resource === "reviews" && r.status === "pending" && (
                            <form
                              aria-label={`Decide ${r.id}`}
                              className="mt-3 flex flex-wrap gap-2"
                              onSubmit={(e) => {
                                e.preventDefault();
                                const f = formData(e);
                                void post("portal", "POST", {
                                  action: "decide_consent",
                                  id: r.id,
                                  decision: str(f, "decision"),
                                  note: str(f, "note"),
                                });
                              }}
                            >
                              <select
                                name="decision"
                                aria-label="Consent decision"
                                className={field}
                              >
                                <option value="approved">
                                  Approve acknowledgement
                                </option>
                                <option value="rejected">Reject</option>
                              </select>
                              <input
                                name="note"
                                aria-label="Decision note"
                                className={field}
                                required
                                minLength={3}
                                maxLength={1000}
                              />
                              <button className={button} disabled={busy}>
                                Record decision
                              </button>
                            </form>
                          )}
                          {resource === "tickets" &&
                            data.role === "tenant" &&
                            r.status === "completed" && (
                              <form
                                className="mt-3 flex flex-wrap gap-2"
                                aria-label={`Confirm ${r.id}`}
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const f = formData(e);
                                  void post(
                                    `maintenance/tickets/${r.id}`,
                                    "PATCH",
                                    {
                                      action: "confirm",
                                      data: {
                                        accepted: str(f, "accepted") === "true",
                                        rating: Number(str(f, "rating")),
                                        note: str(f, "note"),
                                      },
                                    },
                                  );
                                }}
                              >
                                <select className={field} name="accepted">
                                  <option value="true">Resolved</option>
                                  <option value="false">
                                    Not resolved — reopen
                                  </option>
                                </select>
                                <input
                                  name="rating"
                                  aria-label="Rating"
                                  type="number"
                                  min="1"
                                  max="5"
                                  defaultValue="5"
                                  className={field}
                                />
                                <input
                                  name="note"
                                  aria-label="Repair feedback"
                                  required
                                  className={field}
                                />
                                <button className={button}>
                                  Confirm repair
                                </button>
                              </form>
                            )}
                        </article>
                      ))
                    )}
                  </div>
                  <div className="flex gap-3">
                    <button
                      className={secondary}
                      disabled={page === 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </button>
                    <span>Page {page}</span>
                    <button
                      className={secondary}
                      disabled={!records?.hasMore}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </Card>
              )}
              {data.role === "tenant" && (
                <Card title={tr("Report maintenance", "مرمت کی درخواست")}>
                  <p className="text-sm text-amber-900">
                    {tr(
                      "Gas smell, fire, exposed wires or flooding: keep away and contact local emergency services now. This portal does not dispatch emergency services.",
                      "گیس، آگ، کھلی تاریں یا سیلاب: دور رہیں اور فوراً مقامی ایمرجنسی خدمات سے رابطہ کریں۔ پورٹل ایمرجنسی خدمات کو نہیں بھیجتا۔",
                    )}
                  </p>
                  <form
                    aria-label="Portal maintenance"
                    className="grid gap-3 sm:grid-cols-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = formData(e);
                      void post("maintenance/tickets", "POST", {
                        unitId: str(f, "unit"),
                        title: str(f, "title"),
                        description: str(f, "description"),
                        category: str(f, "category"),
                        priority: str(f, "priority"),
                      });
                    }}
                  >
                    <Label name="Your active unit">
                      <select name="unit" className={field} required>
                        <option value="">Choose linked unit</option>
                        {("units" in data.options
                          ? data.options.units || []
                          : []
                        ).map((u) => (
                          <option key={String(u.id)} value={String(u.id)}>
                            {String(u.label)}
                          </option>
                        ))}
                      </select>
                    </Label>
                    <Label name="Issue title">
                      <input
                        name="title"
                        className={field}
                        required
                        minLength={3}
                        maxLength={160}
                      />
                    </Label>
                    <Label name="Description">
                      <textarea
                        name="description"
                        className={field}
                        required
                        minLength={3}
                        maxLength={2000}
                      />
                    </Label>
                    <Label name="Trade">
                      <select className={field} name="category">
                        {[
                          "general",
                          "plumbing",
                          "electrical",
                          "hvac",
                          "structural",
                          "cleaning",
                        ].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </Label>
                    <Label name="Urgency">
                      <select className={field} name="priority">
                        {["medium", "high", "emergency", "low"].map((p) => (
                          <option key={p}>{p}</option>
                        ))}
                      </select>
                    </Label>
                    <button className={button} disabled={busy}>
                      {tr("Submit ticket", "درخواست بھیجیں")}
                    </button>
                  </form>
                  {refresh > 0 && (
                    <p role="status">
                      {tr(
                        "Saved. Select tickets to review the current state.",
                        "محفوظ۔ موجودہ حالت کے لیے درخواستوں کا صفحہ کھولیں۔",
                      )}
                    </p>
                  )}
                </Card>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
function Vault() {
  const [docs, setDocs] = useState<
      {
        id: string;
        title: string;
        entityType: string;
        entityId: string;
        version: number;
      }[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    api<{ documents: typeof docs }>("documents")
      .then((d) => setDocs(d.documents))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <Card title="Your authorized document metadata">
      <p>
        Stored vault metadata only; no live S3 download or OCR is configured.
        Lease template PDFs are available under leases.
      </p>
      {error && <p role="alert">{error}</p>}
      {docs.map((d) => (
        <p key={d.id}>
          {d.title} · v{d.version} · {d.entityType} / {d.entityId}
        </p>
      ))}
    </Card>
  );
}

function PortalRecord({
  record,
  ur,
}: {
  record: Record<string, unknown>;
  ur: boolean;
}) {
  const labels: Record<string, string> = {
    id: "شناخت",
    status: "حالت",
    name: "نام",
    city: "شہر",
    type: "قسم",
    title: "عنوان",
    description: "تفصیل",
    summary: "خلاصہ",
    subject: "عنوان",
    body: "پیغام",
    rent_minor: "ماہانہ کرایہ",
    deposit_minor: "ضمانت",
    total_minor: "کل رقم",
    paid_minor: "ادا شدہ",
    amount_minor: "رقم",
    net_payout_minor: "خالص مالک رقم",
    proposed_cost_minor: "مجوزہ لاگت",
    lease_number: "معاہدہ نمبر",
    invoice_number: "بل نمبر",
    ticket_number: "درخواست نمبر",
    due_date: "آخری تاریخ",
    period_month: "مہینہ",
    unit_number: "یونٹ نمبر",
    decision_note: "فیصلے کی وجہ",
  };
  return (
    <dl className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
      {Object.entries(record).map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="text-xs font-medium text-slate-500">
            {ur
              ? labels[key] || key.replaceAll("_", " ")
              : key.replaceAll("_", " ")}
          </dt>
          <dd className="break-words whitespace-pre-wrap text-slate-900">
            {value === null
              ? "—"
              : key.endsWith("_minor") && typeof value === "number"
                ? cash(value)
                : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
