"use client";
import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type FormEvent,
} from "react";
import type {
  Board,
  TicketDetail,
  Vendor,
  WorkOrder,
} from "@/server/modules/maintenance/maintenance.service";
import {
  api,
  button,
  secondary,
  field,
  cash,
  Card,
  Label,
  formData,
  str,
  minor,
  categories,
  display,
  Options,
  Pager,
} from "./Phase4Shared";
import type { Locale } from "@/lib/i18n";

export function MaintenanceWorkspace({
  permissions,
  locale,
  roleSlug,
}: {
  permissions: string[];
  locale: Locale;
  roleSlug: string;
}) {
  const rtl = locale === "ur",
    tr = (en: string, ur: string) => (rtl ? ur : en);
  const manage = permissions.includes("maintenance:triage"),
    vendorManage = permissions.includes("vendors:manage"),
    admin = permissions.includes("admin:manage");
  const [board, setBoard] = useState<Board | null>(null),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<TicketDetail | null>(null);
  const [page, setPage] = useState(1),
    [status, setStatus] = useState(""),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false),
    [photos, setPhotos] = useState<string[]>([]),
    [photoBusy, setPhotoBusy] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null),
    [history, setHistory] = useState<{
      items: (WorkOrder & { title: string })[];
      total: number;
      page: number;
      limit: number;
    } | null>(null),
    [historyVendor, setHistoryVendor] = useState("");
  const [clock, setClock] = useState(Date.now());
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    const b = await api<Board>(
      `maintenance/tickets?page=${page}&status=${status}&search=${encodeURIComponent(search)}`.replace(
        "&status=&",
        "&",
      ),
    );
    const nextDetail = selected
      ? await api<TicketDetail>(`maintenance/tickets/${selected}`)
      : null;
    if (version !== requestVersion.current) return;
    setBoard(b);
    setDetail(nextDetail);
  }, [page, status, selected, search]);
  useEffect(() => {
    let active = true;
    load().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [load]);
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  async function run(
    action: () => Promise<unknown>,
    message = tr("Saved successfully.", "کامیابی سے محفوظ ہو گیا۔"),
  ) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await action();
      await load();
      if (message) setSuccess(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function mutate(action: string, data: unknown) {
    await api(`maintenance/tickets/${selected}`, "PATCH", { action, data });
  }
  async function addPhotos(files: FileList | null) {
    setPhotoBusy(true);
    setError("");
    try {
      if (!files || files.length > 5)
        throw new Error(
          tr(
            "Select up to five photos.",
            "زیادہ سے زیادہ پانچ تصاویر منتخب کریں۔",
          ),
        );
      const next: string[] = [];
      for (const file of Array.from(files)) {
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
          file.size > 10 * 1024 * 1024
        )
          throw new Error(
            tr(
              "Use JPEG, PNG or WebP files under 10MB.",
              "دس ایم بی سے چھوٹی JPEG، PNG یا WebP تصویر منتخب کریں۔",
            ),
          );
        const image = await createImageBitmap(file);
        const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas
          .getContext("2d")!
          .drawImage(image, 0, 0, canvas.width, canvas.height);
        image.close();
        const data = canvas.toDataURL("image/jpeg", 0.8);
        if (data.length > 1400000)
          throw new Error(
            tr(
              "Photo is too large after resizing.",
              "تصویر کا حجم بہت زیادہ ہے۔",
            ),
          );
        next.push(data);
      }
      setPhotos(next);
    } catch (e) {
      setPhotos([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhotoBusy(false);
    }
  }
  async function submitTicket(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = formData(e);
    await run(async () => {
      const result = await api<{ ticket: { id: string } }>(
        "maintenance/tickets",
        "POST",
        {
          unitId: str(f, "unitId"),
          title: str(f, "title"),
          description: str(f, "description"),
          category: str(f, "category"),
          priority: str(f, "priority"),
          photos,
        },
      );
      setSelected(result.ticket.id);
      setPhotos([]);
      form.reset();
    });
  }
  const ticket = detail?.ticket.id === selected ? detail.ticket : undefined;
  const liveOrder = detail?.orders.find((o) =>
    ["scheduled", "in_progress"].includes(o.status),
  );
  function dueText(due: string, state: string) {
    if (["completed", "closed", "cancelled"].includes(state))
      return tr("SLA timer stopped", "مدت کی نگرانی مکمل");
    const minutes = Math.ceil((Date.parse(due) - clock) / 60000);
    return minutes < 0
      ? `${tr("Overdue", "تاخیر")} ${Math.abs(minutes)} ${tr("min", "منٹ")}`
      : `${minutes} ${tr("min remaining", "منٹ باقی")}`;
  }
  const localDate = () =>
    new Date(Date.now() + 3600000 - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  return (
    <div className="space-y-5" data-testid="maintenance-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {tr("Maintenance & vendors", "مرمت اور ٹھیکیدار")}
          </h1>
          <p className="text-sm text-slate-500">
            {tr(
              "Report → triage → schedule → complete → tenant confirms",
              "درخواست ← جائزہ ← شیڈول ← تکمیل ← کرایہ دار کی تصدیق",
            )}
          </p>
        </div>
        {manage && (
          <button
            className={secondary}
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api<{ generated: number; escalated: number }>(
                  "maintenance/cycle",
                  "POST",
                );
                setSuccess(
                  `${r.generated} ${tr("preventive tickets", "حفاظتی درخواستیں")} · ${r.escalated} ${tr("SLA alerts", "مدت کے انتباہات")}`,
                );
              }, "")
            }
          >
            {tr("Run SLA & preventive scan", "مدت اور حفاظتی جانچ چلائیں")}
          </button>
        )}
      </div>
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {tr(
          "Danger to life, gas leak or major electrical hazard? Contact local emergency services immediately. This app is not an emergency dispatch service.",
          "جان کا خطرہ، گیس کا اخراج یا بجلی کا شدید خطرہ؟ فوری طور پر مقامی ہنگامی سروس سے رابطہ کریں۔ یہ ایپ ہنگامی امداد کی سروس نہیں ہے۔",
        )}
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-red-800 break-words"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-emerald-800"
        >
          {success}
        </p>
      )}
      {!board && (
        <p role="status">
          {tr("Loading maintenance…", "مرمت کا ڈیٹا لوڈ ہو رہا ہے…")}
        </p>
      )}
      {permissions.includes("maintenance:create") && board && (
        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer font-semibold">
            {tr("Report an issue", "مسئلہ درج کریں")}
          </summary>
          <form
            onSubmit={submitTicket}
            className="mt-4 grid gap-3 sm:grid-cols-2"
            aria-label={tr("New maintenance ticket", "مرمت کی نئی درخواست")}
          >
            <Label name={tr("Unit", "یونٹ")}>
              <select name="unitId" required className={field}>
                <option value="">{tr("Select unit", "یونٹ منتخب کریں")}</option>
                {board.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.property_name} · {u.unit_number}
                  </option>
                ))}
              </select>
            </Label>
            <Label name={tr("Issue title", "مسئلے کا عنوان")}>
              <input
                name="title"
                required
                minLength={3}
                maxLength={160}
                className={field}
              />
            </Label>
            <Label name={tr("Category", "شعبہ")}>
              <select name="category" className={field}>
                <Options values={categories} rtl={rtl} />
              </select>
            </Label>
            <Label name={tr("Priority", "ترجیح")}>
              <select name="priority" defaultValue="medium" className={field}>
                <Options
                  values={["low", "medium", "high", "emergency"]}
                  rtl={rtl}
                />
              </select>
            </Label>
            <div className="sm:col-span-2">
              <Label name={tr("Describe the issue", "مسئلے کی تفصیل")}>
                <textarea
                  name="description"
                  required
                  maxLength={2000}
                  className={field}
                  rows={3}
                />
              </Label>
            </div>
            <Label name={tr("Photos (up to 5)", "تصاویر (زیادہ سے زیادہ ۵)")}>
              <input
                className={field}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => addPhotos(e.target.files)}
              />
            </Label>
            <p className="text-xs self-center text-slate-500">
              {tr(
                "Photos are resized and stored privately with this ticket.",
                "تصاویر چھوٹی کر کے صرف اس درخواست کے ساتھ نجی طور پر محفوظ کی جاتی ہیں۔",
              )}{" "}
              {photos.length}/5
            </p>
            <button
              className={button}
              disabled={busy || photoBusy || !board.units.length}
            >
              {tr("Submit ticket", "درخواست جمع کریں")}
            </button>
            {!board.units.length && (
              <p>
                {tr(
                  "No eligible units. Tenants need a current active lease.",
                  "کوئی متعلقہ یونٹ نہیں۔ کرایہ دار کے لیے موجودہ فعال معاہدہ ضروری ہے۔",
                )}
              </p>
            )}
          </form>
        </details>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card title={tr("Tickets & SLA", "درخواستیں اور مدت")}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Label name={tr("Filter status", "حالت کے مطابق")}>
              <select
                className={field}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">{tr("All statuses", "تمام حالتیں")}</option>
                <Options
                  values={[
                    "open",
                    "triaged",
                    "scheduled",
                    "in_progress",
                    "completed",
                    "closed",
                  ]}
                  rtl={rtl}
                />
              </select>
            </Label>
            <Label name={tr("Search tickets", "درخواست تلاش کریں")}>
              <input
                className={field}
                value={search}
                maxLength={160}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </Label>
          </div>
          <div className="space-y-2">
            {board?.tickets.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setSelected(t.id);
                  setDetail(null);
                }}
                aria-pressed={selected === t.id}
                className={`w-full min-w-0 rounded-xl border p-3 text-start ${selected === t.id ? "border-emerald-600 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"}`}
                data-testid={`ticket-${t.id}`}
              >
                <span className="block text-xs font-mono text-slate-500">
                  {t.ticket_number}
                </span>
                <span className="block font-bold break-words">{t.title}</span>
                <span className="flex flex-wrap gap-2 text-xs mt-2">
                  <span className="rounded bg-slate-100 px-2 py-1">
                    {display(t.status, rtl)}
                  </span>
                  <span
                    className={`rounded px-2 py-1 ${["high", "emergency"].includes(t.priority) ? "bg-red-100 text-red-800" : "bg-blue-50 text-blue-800"}`}
                  >
                    {display(t.priority, rtl)}
                  </span>
                  <span className="py-1">
                    {dueText(t.sla_due_at, t.status)}
                  </span>
                </span>
              </button>
            ))}
            {board && !board.tickets.length && (
              <p className="py-4 text-slate-500">
                {tr("No tickets found.", "کوئی درخواست نہیں ملی۔")}
              </p>
            )}
          </div>
          {board && (
            <Pager
              page={page}
              total={board.total}
              limit={board.limit}
              onPage={setPage}
              busy={busy}
              rtl={rtl}
            />
          )}
        </Card>
        <Card title={tr("Ticket details", "درخواست کی تفصیل")}>
          {!ticket && (
            <p className="text-slate-500">
              {tr(
                selected
                  ? "Loading ticket…"
                  : "Select a ticket to view its history and actions.",
                selected
                  ? "درخواست لوڈ ہو رہی ہے…"
                  : "تفصیل اور کارروائی کے لیے درخواست منتخب کریں۔",
              )}
            </p>
          )}
          {ticket && (
            <div className="space-y-4" data-testid="ticket-detail">
              <div>
                <p className="font-mono text-xs text-slate-500">
                  {ticket.ticket_number}
                </p>
                <h3 className="text-xl font-bold break-words">
                  {ticket.title}
                </h3>
                <p className="mt-2 whitespace-pre-wrap break-words">
                  {ticket.description}
                </p>
                <p
                  className="text-sm mt-2 font-semibold"
                  data-testid="ticket-status"
                >
                  {display(ticket.status, rtl)}
                </p>
                <p className="text-xs text-slate-500">
                  {tr("SLA deadline", "آخری مدت")}:{" "}
                  {new Date(ticket.sla_due_at).toLocaleString(
                    rtl ? "ur-PK" : "en-PK",
                  )}{" "}
                  · {dueText(ticket.sla_due_at, ticket.status)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(JSON.parse(ticket.photos_json) as string[]).map(
                  (photo, i) => (
                    <a
                      key={i}
                      href={photo}
                      download={`maintenance-photo-${i + 1}.jpg`}
                      className="block"
                    >
                      <img
                        src={photo}
                        alt={`${tr("Issue photo", "مسئلے کی تصویر")} ${i + 1}`}
                        className="h-24 w-24 rounded-lg object-cover border"
                      />
                    </a>
                  ),
                )}
              </div>
              {manage && ["open", "triaged"].includes(ticket.status) && (
                <form
                  className="space-y-3 rounded-xl bg-slate-50 p-3"
                  aria-label={tr("Triage ticket", "درخواست کا جائزہ")}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = formData(e);
                    run(() =>
                      mutate("triage", {
                        category: str(f, "category"),
                        priority: str(f, "priority"),
                        note: str(f, "note"),
                      }),
                    );
                  }}
                  key={`triage-${ticket.id}-${ticket.status}`}
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Label name={tr("Category", "شعبہ")}>
                      <select
                        name="category"
                        defaultValue={ticket.category}
                        className={field}
                      >
                        <Options values={categories} rtl={rtl} />
                      </select>
                    </Label>
                    <Label name={tr("Priority", "ترجیح")}>
                      <select
                        name="priority"
                        defaultValue={ticket.priority}
                        className={field}
                      >
                        <Options
                          values={["low", "medium", "high", "emergency"]}
                          rtl={rtl}
                        />
                      </select>
                    </Label>
                  </div>
                  <Label name={tr("Triage note", "جائزے کا نوٹ")}>
                    <textarea
                      name="note"
                      required
                      maxLength={2000}
                      className={field}
                    />
                  </Label>
                  <button disabled={busy} className={button}>
                    {tr("Save triage", "جائزہ محفوظ کریں")}
                  </button>
                </form>
              )}
              {manage && ticket.status === "triaged" && (
                <form
                  className="space-y-3 rounded-xl border p-3"
                  aria-label={tr(
                    "Schedule work order",
                    "کام کا حکم شیڈول کریں",
                  )}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = formData(e);
                    run(() =>
                      mutate("assign", {
                        vendorId: str(f, "vendorId"),
                        scheduledAt: new Date(
                          str(f, "scheduledAt"),
                        ).toISOString(),
                        estimatedCostMinor: minor(f, "estimate"),
                      }),
                    );
                  }}
                >
                  <Label name={tr("Vendor", "ٹھیکیدار")}>
                    <select className={field} name="vendorId" required>
                      <option value="">
                        {tr(
                          "Select matching available vendor",
                          "دستیاب متعلقہ ٹھیکیدار منتخب کریں",
                        )}
                      </option>
                      {board?.vendors
                        .filter(
                          (v) =>
                            v.available &&
                            (v.trade_category === ticket.category ||
                              v.trade_category === "general"),
                        )
                        .map((v) => (
                          <option value={v.id} key={v.id}>
                            {v.name} · {cash(v.base_rate_minor)} · ★{" "}
                            {v.rating.toFixed(1)}
                          </option>
                        ))}
                    </select>
                  </Label>
                  <Label name={tr("Scheduled time", "کام کا وقت")}>
                    <input
                      className={field}
                      name="scheduledAt"
                      type="datetime-local"
                      required
                      defaultValue={localDate()}
                    />
                  </Label>
                  <Label name={tr("Estimate (PKR)", "تخمینہ (روپے)")}>
                    <input
                      className={field}
                      name="estimate"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                    />
                  </Label>
                  <button disabled={busy} className={button}>
                    {tr("Assign & schedule", "حکم جاری کریں")}
                  </button>
                </form>
              )}
              {manage && liveOrder && (
                <form
                  className="space-y-3 rounded-xl border p-3"
                  aria-label={tr("Update work order", "کام کی پیش رفت")}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = formData(e);
                    run(() =>
                      mutate("work_order", {
                        workOrderId: liveOrder.id,
                        status:
                          liveOrder.status === "scheduled"
                            ? "in_progress"
                            : "completed",
                        note: str(f, "note"),
                        ...(liveOrder.status === "in_progress"
                          ? { actualCostMinor: minor(f, "actualCost") }
                          : {}),
                      }),
                    );
                  }}
                  key={liveOrder.status}
                >
                  <p className="font-semibold">
                    {liveOrder.vendor_name} · {liveOrder.work_order_number}
                  </p>
                  <Label name={tr("Work notes", "کام کے نوٹس")}>
                    <textarea
                      className={field}
                      name="note"
                      required
                      maxLength={2000}
                    />
                  </Label>
                  {liveOrder.status === "in_progress" && (
                    <Label name={tr("Actual cost (PKR)", "اصل لاگت (روپے)")}>
                      <input
                        className={field}
                        name="actualCost"
                        type="number"
                        min="0"
                        step="0.01"
                        required
                      />
                    </Label>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button disabled={busy} className={button}>
                      {tr(
                        liveOrder.status === "scheduled"
                          ? "Start work"
                          : "Mark work completed",
                        liveOrder.status === "scheduled"
                          ? "کام شروع کریں"
                          : "کام مکمل کریں",
                      )}
                    </button>
                    <button
                      className={secondary}
                      disabled={busy}
                      type="button"
                      onClick={(e) => {
                        const f = new FormData(e.currentTarget.form!);
                        if (!str(f, "note")) {
                          setError(
                            tr(
                              "Enter a cancellation reason in work notes.",
                              "کام کے نوٹ میں منسوخی کی وجہ لکھیں۔",
                            ),
                          );
                          return;
                        }
                        run(() =>
                          mutate("work_order", {
                            workOrderId: liveOrder.id,
                            status: "cancelled",
                            note: str(f, "note"),
                          }),
                        );
                      }}
                    >
                      {tr("Cancel order", "حکم منسوخ کریں")}
                    </button>
                  </div>
                </form>
              )}
              {ticket.status === "completed" &&
                (roleSlug === "tenant" || admin) && (
                  <form
                    aria-label={tr("Confirm completion", "تکمیل کی تصدیق")}
                    className="space-y-3 rounded-xl bg-emerald-50 p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = formData(e);
                      run(() =>
                        mutate("confirm", {
                          accepted: true,
                          note: str(f, "note"),
                          ...(roleSlug === "tenant"
                            ? { rating: Number(str(f, "rating")) }
                            : {}),
                        }),
                      );
                    }}
                  >
                    <p className="font-semibold">
                      {tr(
                        admin
                          ? "Administrative closure (audited override)"
                          : "Please confirm the repair",
                        admin
                          ? "منتظم کی جانب سے بندش (آڈٹ میں درج ہو گی)"
                          : "مرمت کی تصدیق کریں",
                      )}
                    </p>
                    {roleSlug === "tenant" && (
                      <Label name={tr("Rating", "درجہ بندی")}>
                        <select
                          className={field}
                          name="rating"
                          defaultValue="5"
                        >
                          <Options
                            values={["5", "4", "3", "2", "1"]}
                            rtl={rtl}
                          />
                        </select>
                      </Label>
                    )}
                    <Label
                      name={tr(
                        "Confirmation / reopen reason",
                        "تصدیق یا دوبارہ کھولنے کی وجہ",
                      )}
                    >
                      <textarea
                        className={field}
                        name="note"
                        required
                        minLength={admin ? 10 : 1}
                        maxLength={2000}
                      />
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      <button disabled={busy} className={button}>
                        {tr("Confirm & close", "تصدیق اور بند کریں")}
                      </button>
                      <button
                        disabled={busy}
                        type="button"
                        className={secondary}
                        onClick={(e) => {
                          const form = e.currentTarget.form!;
                          if (!form.reportValidity()) return;
                          const f = new FormData(form);
                          run(() =>
                            mutate("confirm", {
                              accepted: false,
                              note: str(f, "note"),
                            }),
                          );
                        }}
                      >
                        {tr(
                          "Not fixed — reopen",
                          "مسئلہ حل نہیں ہوا — دوبارہ کھولیں",
                        )}
                      </button>
                    </div>
                  </form>
                )}
              {!!detail?.orders.length && (
                <div>
                  <h4 className="font-bold mb-2">
                    {tr("Work orders & costs", "کام کے احکامات اور لاگت")}
                  </h4>
                  {detail.orders.map((o) => (
                    <div
                      className="rounded-lg border p-3 mb-2 text-sm space-y-1"
                      key={o.id}
                    >
                      <p className="font-semibold">
                        {o.vendor_name} · {display(o.status, rtl)}
                      </p>
                      <p>
                        {tr("Estimate", "تخمینہ")}:{" "}
                        {cash(o.estimated_cost_minor)} · {tr("Actual", "اصل")}:{" "}
                        {cash(o.actual_cost_minor)}
                      </p>
                      <p className="break-words">{o.completion_notes}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(o.scheduled_at).toLocaleString(
                          rtl ? "ur-PK" : "en-PK",
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {ticket.resolution_notes && (
                <p className="rounded-lg bg-slate-50 p-3 break-words">
                  {ticket.resolution_notes}{" "}
                  {ticket.rating && `· ★ ${ticket.rating}/5`}
                </p>
              )}
              <div>
                <h4 className="font-bold mb-2">
                  {tr("Activity timeline", "سرگرمیوں کی تفصیل")}
                </h4>
                <ol className="space-y-2 text-sm">
                  {detail?.events.map((e) => (
                    <li
                      className="border-s-2 border-emerald-200 ps-3"
                      key={e.id}
                    >
                      <p className="font-semibold">{display(e.type, rtl)}</p>
                      <p className="whitespace-pre-wrap break-words">
                        {e.note}
                      </p>
                      <time className="text-xs text-slate-500">
                        {new Date(e.created_at).toLocaleString(
                          rtl ? "ur-PK" : "en-PK",
                        )}
                      </time>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </Card>
      </div>
      {vendorManage && board && (
        <details className="rounded-xl border bg-white p-4">
          <summary className="font-bold cursor-pointer">
            {tr("Vendor directory & rates", "ٹھیکیداروں کی فہرست اور نرخ")}
          </summary>
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {board.vendors.map((v) => (
                <article key={v.id} className="rounded-xl border p-3 space-y-2">
                  <h3 className="font-bold">{v.name}</h3>
                  <p className="text-sm">
                    {display(v.trade_category, rtl)} · {cash(v.base_rate_minor)}{" "}
                    · ★ {v.rating.toFixed(1)} ({v.completed_jobs})
                  </p>
                  <p className="text-xs">
                    {v.phone} ·{" "}
                    {v.available
                      ? tr("Available", "دستیاب")
                      : tr("Unavailable", "غیر دستیاب")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button className={secondary} onClick={() => setEditing(v)}>
                      {tr("Edit vendor", "ٹھیکیدار تبدیل کریں")}
                    </button>
                    <button
                      className={secondary}
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          setHistoryVendor(v.id);
                          setHistory(
                            await api(`maintenance/vendors?id=${v.id}`),
                          );
                        }, "")
                      }
                    >
                      {tr("Work history", "کام کی تاریخ")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {history && (
              <div className="rounded-xl border p-3 space-y-2">
                <h3 className="font-bold">
                  {tr("Vendor work history", "ٹھیکیدار کے سابقہ کام")}
                </h3>
                {history.items.map((o) => (
                  <p className="text-sm break-words" key={o.id}>
                    {o.title} · {display(o.status, rtl)} ·{" "}
                    {cash(o.actual_cost_minor)}
                  </p>
                ))}
                {!history.items.length && (
                  <p>{tr("No work orders yet.", "ابھی کوئی کام نہیں۔")}</p>
                )}
                <Pager
                  {...history}
                  onPage={(n) =>
                    run(
                      async () =>
                        setHistory(
                          await api(
                            `maintenance/vendors?id=${historyVendor}&page=${n}`,
                          ),
                        ),
                      "",
                    )
                  }
                  busy={busy}
                  rtl={rtl}
                />
              </div>
            )}
            <form
              key={editing?.id || "new-vendor"}
              aria-label={tr("Vendor form", "ٹھیکیدار کا فارم")}
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  f = formData(e);
                const data = {
                  name: str(f, "name"),
                  tradeCategory: str(f, "trade"),
                  phone: str(f, "phone"),
                  ...(str(f, "email") ? { email: str(f, "email") } : {}),
                  baseRateMinor: minor(f, "rate"),
                  slaHours: Number(str(f, "slaHours")),
                  available: f.has("available"),
                };
                run(async () => {
                  await api(
                    "maintenance/vendors",
                    editing ? "PATCH" : "POST",
                    editing ? { id: editing.id, data } : data,
                  );
                  setEditing(null);
                  form.reset();
                });
              }}
            >
              <h3 className="font-bold sm:col-span-2">
                {editing
                  ? tr("Edit vendor", "ٹھیکیدار تبدیل کریں")
                  : tr("Add vendor", "ٹھیکیدار شامل کریں")}
              </h3>
              <Label name={tr("Vendor name", "ٹھیکیدار کا نام")}>
                <input
                  className={field}
                  name="name"
                  defaultValue={editing?.name}
                  required
                  minLength={2}
                  maxLength={120}
                />
              </Label>
              <Label name={tr("Trade", "شعبہ")}>
                <select
                  className={field}
                  name="trade"
                  defaultValue={editing?.trade_category}
                >
                  <Options values={categories} rtl={rtl} />
                </select>
              </Label>
              <Label name={tr("Phone", "فون")}>
                <input
                  className={field}
                  name="phone"
                  defaultValue={editing?.phone}
                  required
                  maxLength={25}
                />
              </Label>
              <Label name={tr("Email (optional)", "ای میل (اختیاری)")}>
                <input
                  className={field}
                  name="email"
                  type="email"
                  defaultValue={editing?.email || ""}
                />
              </Label>
              <Label name={tr("Base rate (PKR)", "بنیادی نرخ (روپے)")}>
                <input
                  className={field}
                  name="rate"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={
                    editing ? editing.base_rate_minor / 100 : undefined
                  }
                  required
                />
              </Label>
              <Label name={tr("Vendor SLA (hours)", "ٹھیکیدار کی مدت (گھنٹے)")}>
                <input
                  className={field}
                  name="slaHours"
                  type="number"
                  min="1"
                  max="720"
                  defaultValue={editing?.sla_hours || 24}
                  required
                />
              </Label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="available"
                  defaultChecked={editing ? !!editing.available : true}
                />
                {tr("Available for assignment", "کام کے لیے دستیاب")}
              </label>
              <div className="flex flex-wrap gap-2">
                <button className={button} disabled={busy}>
                  {tr("Save vendor", "ٹھیکیدار محفوظ کریں")}
                </button>
                {editing && (
                  <button
                    type="button"
                    className={secondary}
                    onClick={() => setEditing(null)}
                  >
                    {tr("Cancel edit", "ترمیم منسوخ")}
                  </button>
                )}
              </div>
            </form>
          </div>
        </details>
      )}
      {manage && board && (
        <details className="rounded-xl border bg-white p-4">
          <summary className="font-bold cursor-pointer">
            {tr("Preventive maintenance schedules", "حفاظتی مرمت کا شیڈول")}
          </summary>
          <div className="mt-4 space-y-4">
            {board.schedules.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap justify-between gap-2 border rounded-lg p-3"
              >
                <div>
                  <p className="font-bold">{s.title}</p>
                  <p className="text-sm">
                    {s.interval_days} {tr("days", "دن")} ·{" "}
                    {new Date(s.next_due_at).toLocaleString(
                      rtl ? "ur-PK" : "en-PK",
                    )}{" "}
                    ·{" "}
                    {s.active ? tr("Active", "فعال") : tr("Paused", "روکا ہوا")}
                  </p>
                </div>
                <button
                  className={secondary}
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      api("maintenance/schedules", "PATCH", {
                        id: s.id,
                        data: {
                          unitId: s.unit_id,
                          title: s.title,
                          category: s.category,
                          intervalDays: s.interval_days,
                          nextDueAt: s.next_due_at,
                          active: !s.active,
                        },
                      }),
                    )
                  }
                >
                  {s.active
                    ? tr("Pause schedule", "شیڈول روکیں")
                    : tr("Resume schedule", "شیڈول جاری کریں")}
                </button>
              </div>
            ))}
            <form
              className="grid gap-3 sm:grid-cols-2"
              aria-label={tr("New preventive schedule", "نیا حفاظتی شیڈول")}
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  f = formData(e);
                run(async () => {
                  await api("maintenance/schedules", "POST", {
                    unitId: str(f, "unitId"),
                    title: str(f, "title"),
                    category: str(f, "category"),
                    intervalDays: Number(str(f, "interval")),
                    nextDueAt: new Date(str(f, "due")).toISOString(),
                    active: true,
                  });
                  form.reset();
                });
              }}
            >
              <Label name={tr("Unit", "یونٹ")}>
                <select required className={field} name="unitId">
                  <option value="">
                    {tr("Select unit", "یونٹ منتخب کریں")}
                  </option>
                  {board.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.property_name} · {u.unit_number}
                    </option>
                  ))}
                </select>
              </Label>
              <Label name={tr("Schedule title", "شیڈول کا عنوان")}>
                <input
                  required
                  className={field}
                  name="title"
                  minLength={3}
                  maxLength={160}
                />
              </Label>
              <Label name={tr("Category", "شعبہ")}>
                <select className={field} name="category">
                  <Options values={categories} rtl={rtl} />
                </select>
              </Label>
              <Label name={tr("Repeat every (days)", "ہر کتنے دن بعد")}>
                <input
                  className={field}
                  name="interval"
                  required
                  type="number"
                  min="1"
                  max="366"
                  defaultValue="90"
                />
              </Label>
              <Label name={tr("Next due time", "اگلا وقت")}>
                <input
                  required
                  type="datetime-local"
                  className={field}
                  name="due"
                  defaultValue={localDate()}
                />
              </Label>
              <button className={`${button} self-end`} disabled={busy}>
                {tr("Create schedule", "شیڈول بنائیں")}
              </button>
            </form>
          </div>
        </details>
      )}
    </div>
  );
}
