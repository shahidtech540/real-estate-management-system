/** Shared minor-unit schedule arithmetic. Token is part of (not additional to) down payment. */
export type PaymentPlan = {
  kind: "full" | "installment";
  downPaymentMinor: number;
  installments: number;
  firstDueDate: string;
};
export type ScheduleLine = {
  label: string;
  dueDate: string;
  amountMinor: number;
};
const isDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
export function bookingSchedule(
  total: number,
  token: number,
  bookingDate: string,
  plan: PaymentPlan,
): ScheduleLine[] {
  if (
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    total > 1e12 ||
    !Number.isSafeInteger(token) ||
    token < 0 ||
    token > total
  )
    throw new Error("Token must be between zero and the plot price.");
  if (!isDate(bookingDate)) throw new Error("Invalid booking date.");
  const lines: ScheduleLine[] = [
    { label: "Token invoice", dueDate: bookingDate, amountMinor: token },
  ];
  if (plan.kind === "full") {
    lines.push({
      label: "Remaining balance",
      dueDate: bookingDate,
      amountMinor: total - token,
    });
    return lines;
  }
  if (
    !Number.isSafeInteger(plan.downPaymentMinor) ||
    plan.downPaymentMinor < token ||
    plan.downPaymentMinor >= total ||
    !Number.isInteger(plan.installments) ||
    plan.installments < 1 ||
    plan.installments > 120 ||
    !isDate(plan.firstDueDate) ||
    plan.firstDueDate <= bookingDate
  )
    throw new Error(
      "Installments need a down payment at least the token and below price, 1–120 months, and a first due date after booking.",
    );
  lines.push({
    label: "Down payment balance",
    dueDate: bookingDate,
    amountMinor: plan.downPaymentMinor - token,
  });
  const balance = total - plan.downPaymentMinor,
    each = Math.floor(balance / plan.installments),
    remainder = balance % plan.installments;
  if (each < 1)
    throw new Error("Each installment must be at least one minor unit.");
  const [year, month, day] = plan.firstDueDate.split("-").map(Number);
  if (year + Math.floor((month - 1 + plan.installments - 1) / 12) > 9999)
    throw new Error("Schedule exceeds the supported calendar.");
  for (let i = 0; i < plan.installments; i++) {
    const last = new Date(Date.UTC(year, month + i, 0)).getUTCDate();
    const date = new Date(Date.UTC(year, month - 1 + i, Math.min(day, last)))
      .toISOString()
      .slice(0, 10);
    lines.push({
      label: `Installment ${i + 1}`,
      dueDate: date,
      amountMinor: each + (i < remainder ? 1 : 0),
    });
  }
  return lines;
}
export function parseMajorMoney(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error(
      "Enter a nonnegative amount with at most two decimal places.",
    );
  const [a, b = ""] = value.split(".");
  const minor = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor > 1e12)
    throw new Error("Amount exceeds the supported limit.");
  return minor;
}
export type BookingFileInput = {
  name: string;
  category: "id_copy" | "payment_receipt";
  mimeType: "application/pdf" | "image/png" | "image/jpeg";
  base64: string;
};
