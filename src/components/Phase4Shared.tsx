"use client";
import {
  type ReactNode,
  type ReactElement,
  type FormEvent,
  useId,
  cloneElement,
  Children,
} from "react";
import { authFetch } from "@/lib/auth-client";
export const field =
  "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600";
export const button =
  "rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50";
export const secondary =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50";
export const cash = (n: number) =>
  `PKR ${(n / 100).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await authFetch(`/api/v1/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Request failed");
  return data as T;
}
export function Card({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm space-y-4"
    >
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}
export function Label({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {name}
      </label>
      {cloneElement(Children.only(children) as ReactElement<{ id?: string }>, {
        id,
      })}
    </div>
  );
}
export const formData = (e: FormEvent<HTMLFormElement>) =>
  new FormData(e.currentTarget);
export const str = (f: FormData, key: string) => String(f.get(key) || "");
export const minor = (f: FormData, key: string) =>
  Math.round(Number(f.get(key)) * 100);
export const categories = [
  "plumbing",
  "electrical",
  "hvac",
  "structural",
  "cleaning",
  "general",
];
const ur: Record<string, string> = {
  plumbing: "پلمبنگ",
  electrical: "بجلی",
  hvac: "ایئر کنڈیشننگ",
  structural: "عمارت",
  cleaning: "صفائی",
  general: "عمومی",
  low: "کم",
  medium: "درمیانی",
  high: "زیادہ",
  emergency: "ہنگامی",
  open: "نیا",
  triaged: "جائزہ مکمل",
  scheduled: "شیڈول شدہ",
  in_progress: "کام جاری",
  completed: "کام مکمل",
  closed: "بند",
  cancelled: "منسوخ",
  in_app: "ایپ میں",
  email: "ای میل",
  sms: "ایس ایم ایس",
  whatsapp: "واٹس ایپ",
  queued: "قطار میں",
  processing: "ارسال جاری",
  delivered: "موصول",
  mock_sent: "آزمائشی ارسال",
  sent: "ارسال شدہ",
  failed: "ناکام",
  dead_letter: "دوبارہ کوشش ختم",
  opened: "درخواست جمع",
  tenant_confirmed: "کرایہ دار کی تصدیق",
  admin_closed: "منتظم نے بند کیا",
  reopened: "دوبارہ کھلا",
  sla_breached: "مدت کی خلاف ورزی",
};
export const display = (s: string, rtl: boolean) =>
  rtl ? ur[s] || s : s.replaceAll("_", " ");
export function Options({ values, rtl }: { values: string[]; rtl: boolean }) {
  return (
    <>
      {values.map((v) => (
        <option key={v} value={v}>
          {display(v, rtl)}
        </option>
      ))}
    </>
  );
}
export function Pager({
  page,
  total,
  limit,
  onPage,
  busy,
  rtl,
}: {
  page: number;
  total: number;
  limit: number;
  onPage: (n: number) => void;
  busy: boolean;
  rtl: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <button
        className={secondary}
        disabled={busy || page === 1}
        onClick={() => onPage(page - 1)}
      >
        {rtl ? "پچھلا" : "Previous"}
      </button>
      <span>
        {rtl ? "صفحہ" : "Page"} {page} / {Math.max(1, Math.ceil(total / limit))}{" "}
        · {total}
      </span>
      <button
        className={secondary}
        disabled={busy || page * limit >= total}
        onClick={() => onPage(page + 1)}
      >
        {rtl ? "اگلا" : "Next"}
      </button>
    </div>
  );
}
