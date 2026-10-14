"use client";
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { NotificationRecord } from "@/server/modules/notifications/notifications.service";
import {
  api,
  button,
  secondary,
  field,
  Card,
  Label,
  formData,
  str,
  display,
  Options,
  Pager,
} from "./Phase4Shared";
interface NotificationPage {
  items: NotificationRecord[];
  total: number;
  page: number;
  limit: number;
}
interface Template {
  locale: string;
  subject: string;
  body: string;
}
export function NotificationsWorkspace({
  permissions,
  locale,
}: {
  permissions: string[];
  locale: Locale;
}) {
  const rtl = locale === "ur",
    tr = (en: string, ur: string) => (rtl ? ur : en),
    admin = permissions.includes("admin:manage");
  const [outbox, setOutbox] = useState(false),
    [page, setPage] = useState(1),
    [data, setData] = useState<NotificationPage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const [users, setUsers] = useState<
      { id: string; fullName: string; email: string }[]
    >([]),
    [templates, setTemplates] = useState<Template[]>([]);
  const load = useCallback(async () => {
    setData(
      await api<NotificationPage>(
        `notifications?outbox=${outbox}&page=${page}`,
      ),
    );
  }, [outbox, page]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    if (admin) {
      Promise.all([
        api<{ users: typeof users }>("admin/users"),
        api<{ templates: Template[] }>("notifications/templates"),
      ])
        .then(([u, t]) => {
          setUsers(u.users);
          setTemplates(t.templates);
        })
        .catch((e) => setError(e.message));
    }
  }, [admin]);
  async function run(
    fn: () => Promise<unknown>,
    message = tr("Saved successfully.", "کامیابی سے محفوظ ہو گیا۔"),
  ) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await fn();
      await load();
      setSuccess(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5" data-testid="notifications-workspace">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h1 className="text-2xl font-bold">{tr("Notifications", "اطلاعات")}</h1>
        <div className="flex flex-wrap gap-2">
          <button
            className={secondary}
            disabled={busy}
            onClick={() =>
              run(load, tr("Inbox refreshed.", "اطلاعات تازہ ہو گئیں۔"))
            }
          >
            {tr("Refresh notifications", "اطلاعات تازہ کریں")}
          </button>
          {admin && (
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                run(
                  () => api("notifications/dispatch", "POST"),
                  tr(
                    "Delivery batch processed. Check each message status.",
                    "ارسال کی کارروائی مکمل۔ ہر پیغام کی حالت دیکھیں۔",
                  ),
                )
              }
            >
              {tr("Process delivery queue", "ارسال کی قطار چلائیں")}
            </button>
          )}
        </div>
      </div>
      <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        {tr(
          "Maintenance updates and SLA alerts arrive in-app. External channels default to mock delivery: mock_sent means simulated, not delivered to a real phone or mailbox. Live delivery is not implemented yet.",
          "مرمت اور مدت کے انتباہات ایپ میں آتے ہیں۔ بیرونی ذرائع کی آزمائشی ترسیل ہوتی ہے: mock_sent کا مطلب فرضی ارسال ہے، حقیقی فون یا ای میل پر ترسیل نہیں۔ حقیقی ترسیل ابھی نافذ نہیں ہے۔",
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
      <Card
        title={tr(
          outbox ? "Organization delivery log" : "My inbox",
          outbox ? "ادارے کا ارسال ریکارڈ" : "میری اطلاعات",
        )}
      >
        {admin && (
          <Label name={tr("Notification view", "اطلاعات کا منظر")}>
            <select
              className={field}
              value={outbox ? "outbox" : "inbox"}
              onChange={(e) => {
                setOutbox(e.target.value === "outbox");
                setPage(1);
              }}
            >
              <option value="inbox">{tr("My inbox", "میری اطلاعات")}</option>
              <option value="outbox">
                {tr("Organization delivery log", "ادارے کا ارسال ریکارڈ")}
              </option>
            </select>
          </Label>
        )}
        {!data && (
          <p role="status">
            {tr("Loading notifications…", "اطلاعات لوڈ ہو رہی ہیں…")}
          </p>
        )}
        {data && !data.items.length && (
          <p className="text-slate-500 py-3">
            {tr("No notifications yet.", "ابھی کوئی اطلاع نہیں۔")}
          </p>
        )}
        <div className="space-y-3">
          {data?.items.map((n) => (
            <article
              key={n.id}
              className={`rounded-xl border p-4 space-y-2 ${n.read_at ? "border-slate-200" : "border-emerald-300 bg-emerald-50/30"}`}
            >
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="font-bold break-words min-w-0">{n.subject}</h3>
                <span className="text-xs rounded-md bg-slate-100 px-2 py-1">
                  {display(n.channel, rtl)} · {display(n.status, rtl)}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm">
                {n.body}
              </p>
              <p className="text-xs text-slate-500 break-all">
                {new Date(n.created_at).toLocaleString(rtl ? "ur-PK" : "en-PK")}
                {outbox
                  ? ` · ${n.recipient} · ${tr("Attempts", "کوششیں")}: ${n.attempt_count}`
                  : ""}
              </p>
              {n.last_error && (
                <p className="text-xs text-red-700 break-words">
                  {n.last_error}
                </p>
              )}
              {outbox && n.next_attempt_at && n.status === "failed" && (
                <p className="text-xs">
                  {tr("Next retry", "اگلی کوشش")}:{" "}
                  {new Date(n.next_attempt_at).toLocaleString(
                    rtl ? "ur-PK" : "en-PK",
                  )}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {!outbox && !n.read_at && (
                  <button
                    className={secondary}
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        api("notifications", "PATCH", {
                          id: n.id,
                          action: "read",
                        }),
                      )
                    }
                  >
                    {tr("Mark read", "پڑھ لیا")}
                  </button>
                )}
                {admin && ["failed", "dead_letter"].includes(n.status) && (
                  <button
                    disabled={busy}
                    className={secondary}
                    onClick={() =>
                      run(() =>
                        api("notifications", "PATCH", {
                          id: n.id,
                          action: "retry",
                        }),
                      )
                    }
                  >
                    {tr("Retry delivery", "ارسال کی دوبارہ کوشش")}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
        {data && <Pager {...data} onPage={setPage} busy={busy} rtl={rtl} />}
      </Card>
      {admin && (
        <details className="rounded-xl border bg-white p-4">
          <summary className="cursor-pointer font-bold">
            {tr("Send a single notification", "ایک اطلاع بھیجیں")}
          </summary>
          <form
            aria-label={tr("Compose notification", "اطلاع لکھیں")}
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = formData(e),
                requestKey = form.dataset.requestKey || crypto.randomUUID();
              form.dataset.requestKey = requestKey;
              run(async () => {
                await api("notifications", "POST", {
                  userId: str(f, "userId"),
                  channel: str(f, "channel"),
                  subject: str(f, "subject"),
                  body: str(f, "body"),
                  consent: f.has("consent"),
                  requestKey,
                });
                delete form.dataset.requestKey;
                form.reset();
              });
            }}
          >
            <Label name={tr("Recipient", "وصول کنندہ")}>
              <select className={field} name="userId" required>
                <option value="">
                  {tr("Select organization user", "ادارے کا صارف منتخب کریں")}
                </option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} ({u.email})
                  </option>
                ))}
              </select>
            </Label>
            <Label name={tr("Channel", "ذریعہ")}>
              <select className={field} name="channel">
                <Options
                  values={["in_app", "email", "sms", "whatsapp"]}
                  rtl={rtl}
                />
              </select>
            </Label>
            <div className="sm:col-span-2">
              <Label name={tr("Subject", "عنوان")}>
                <input
                  className={field}
                  name="subject"
                  required
                  maxLength={180}
                />
              </Label>
            </div>
            <div className="sm:col-span-2">
              <Label name={tr("Message", "پیغام")}>
                <textarea
                  className={field}
                  name="body"
                  required
                  rows={3}
                  maxLength={4000}
                />
              </Label>
            </div>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input className="mt-1" type="checkbox" name="consent" />
              {tr(
                "I confirm this recipient has agreed to be contacted on the selected external channel. Required for email/SMS/WhatsApp.",
                "میں تصدیق کرتا ہوں کہ وصول کنندہ نے منتخب بیرونی ذریعے پر رابطے کی اجازت دی ہے۔ ای میل، ایس ایم ایس اور واٹس ایپ کے لیے ضروری ہے۔",
              )}
            </label>
            <button disabled={busy} className={button}>
              {tr("Queue notification", "اطلاع قطار میں ڈالیں")}
            </button>
          </form>
        </details>
      )}
      {admin && (
        <details className="rounded-xl border bg-white p-4">
          <summary className="cursor-pointer font-bold">
            {tr(
              "Maintenance notification templates",
              "مرمت کی اطلاعات کے سانچے",
            )}
          </summary>
          <p className="text-sm mt-3 text-slate-500">
            {tr("Available variables", "دستیاب متغیرات")}:{" "}
            {"{{number}}, {{status}}, {{title}}, {{note}}"}
          </p>
          <div className="grid gap-4 mt-4 lg:grid-cols-2">
            {templates.map((t) => (
              <form
                className="space-y-3"
                key={`${t.locale}-${t.subject}-${t.body}`}
                aria-label={`${t.locale} template`}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = formData(e);
                  run(async () => {
                    const r = await api<{ templates: Template[] }>(
                      "notifications/templates",
                      "PUT",
                      {
                        locale: t.locale,
                        subject: str(f, "subject"),
                        body: str(f, "body"),
                      },
                    );
                    setTemplates(r.templates);
                  });
                }}
              >
                <h3 className="font-bold">
                  {t.locale === "ur" ? "اردو" : "English"}
                </h3>
                <Label name={tr("Template subject", "سانچے کا عنوان")}>
                  <input
                    dir={t.locale === "ur" ? "rtl" : "ltr"}
                    className={field}
                    name="subject"
                    defaultValue={t.subject}
                    required
                    maxLength={180}
                  />
                </Label>
                <Label name={tr("Template message", "سانچے کا پیغام")}>
                  <textarea
                    dir={t.locale === "ur" ? "rtl" : "ltr"}
                    className={field}
                    name="body"
                    defaultValue={t.body}
                    required
                    maxLength={4000}
                  />
                </Label>
                <button className={button} disabled={busy}>
                  {tr("Save template", "سانچہ محفوظ کریں")}
                </button>
              </form>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
