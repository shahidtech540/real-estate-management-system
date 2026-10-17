import { z } from "zod";
import { bookingSchedule } from "./plot-booking";
const text = (n: number) => z.string().trim().max(n);
const moneySchema = z.number().int().nonnegative().max(1_000_000_000_000);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      Number.isFinite(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Invalid date",
  );
export const bookingOfficeDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const clientSchema = z
  .object({
    fullName: text(150).min(2),
    phone: text(30)
      .regex(/^\+?[0-9 ()-]{7,30}$/)
      .refine((v) => {
        const n = v.replace(/\D/g, "").length;
        return n >= 7 && n <= 15;
      }, "Phone must contain 7–15 digits"),
    cnic: text(40).optional(),
    email: z
      .union([z.string().trim().email().max(254), z.literal("")])
      .optional(),
    address: text(500).optional(),
  })
  .strict();
export const bookingInputSchema = z
  .object({
    requestKey: z.string().uuid(),
    expectedMapId: text(100).min(1),
    expectedPriceMinor: moneySchema.positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    clientId: text(100).min(1).optional(),
    newClient: clientSchema.optional(),
    agentId: text(100).min(1),
    bookingType: z.enum(["reserve", "book"]),
    tokenAmountMinor: moneySchema,
    bookingDate: dateSchema,
    expiryDate: z.string().datetime({ offset: true }).nullable(),
    paymentPlan: z
      .object({
        kind: z.enum(["full", "installment"]),
        downPaymentMinor: moneySchema,
        installments: z.number().int().min(0).max(120),
        firstDueDate: z.union([dateSchema, z.literal("")]),
      })
      .strict(),
    notes: text(4000).default(""),
    files: z
      .array(
        z
          .object({
            name: text(150)
              .min(1)
              .regex(/^[^/\\\x00-\x1f]+$/),
            category: z.enum(["id_copy", "payment_receipt"]),
            mimeType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
            base64: z.string().max(2796204),
          })
          .strict(),
      )
      .max(2)
      .default([]),
  })
  .strict()
  .refine((x) => !!x.clientId !== !!x.newClient, {
    message: "Choose an existing client OR create one, not both.",
  });

/** Same structural and calendar/payment validation on browser and server; DB checks stay server-only. */
export function bookingTermsError(
  q: z.infer<typeof bookingInputSchema>,
  now = Date.now(),
): { code: string; message: string } | null {
  if (q.bookingDate !== bookingOfficeDate())
    return {
      code: "BOOKING_DATE",
      message:
        "Booking date must be today in Asia/Karachi; backdated/future business writes are not accepted.",
    };
  if (
    q.bookingType === "reserve" &&
    (!q.expiryDate ||
      Date.parse(q.expiryDate) <= now ||
      Date.parse(q.expiryDate) > now + 90 * 86400000)
  )
    return {
      code: "HOLD_EXPIRY",
      message: "A reservation needs a future expiry within 90 days.",
    };
  if (q.bookingType === "book" && q.expiryDate !== null)
    return {
      code: "BOOKING_EXPIRY",
      message: "A confirmed booking must not have a hold expiry.",
    };
  if (
    q.paymentPlan.kind === "full" &&
    (q.paymentPlan.downPaymentMinor !== q.expectedPriceMinor ||
      q.paymentPlan.installments !== 0 ||
      q.paymentPlan.firstDueDate !== "")
  )
    return {
      code: "FULL_PLAN",
      message:
        "Full payment plan must cover the price and have no installments.",
    };
  try {
    bookingSchedule(
      q.expectedPriceMinor,
      q.tokenAmountMinor,
      q.bookingDate,
      q.paymentPlan,
    );
  } catch (e) {
    return { code: "PAYMENT_PLAN", message: (e as Error).message };
  }
  return null;
}
