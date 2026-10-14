/** Local explainable rules, not an external model or legal/financial certification. */
import { HttpError } from "@/server/auth/guards";
export const RULE_VERSION = "1";
export function classifyMaintenance(text: string, currentPriority = "medium") {
  const t = text.toLowerCase(),
    emergency =
      currentPriority === "emergency" ||
      /gas\s*(leak|smell)|smell.{0,15}gas|fire|sparks|exposed\s*wire|electroc|flood|گیس|آگ|سیلاب/.test(
        t,
      );
  let category = "general";
  if (/gas|گیس/.test(t)) category = "general";
  else if (/electric|sparks|wire|power|بجلی/.test(t)) category = "electrical";
  else if (/leak|drain|pipe|water|flood|پانی|نال[یے]/.test(t))
    category = "plumbing";
  else if (/air\s*condition|\bac\b|hvac|cooling|اے سی/.test(t))
    category = "hvac";
  else if (/crack|roof|wall|structur|دیوار|چھت/.test(t))
    category = "structural";
  else if (/clean|trash|garbage|صفائی/.test(t)) category = "cleaning";
  const priority =
    emergency || currentPriority === "emergency"
      ? "emergency"
      : /urgent|no\s*water|blocked|cannot|شدید/.test(t) ||
          currentPriority === "high"
        ? "high"
        : "medium";
  return {
    category,
    priority,
    emergency,
    advice: emergency
      ? "Keep away from the hazard, contact local emergency services and the office immediately. Do not attempt repairs. This is not a diagnosis."
      : "Coordinator inspection required; classification is advisory.",
  };
}
export function installmentPlan(amount: number, count: number) {
  const quotient = Math.floor(amount / count),
    remaining = amount % count;
  return Array.from(
    { length: count },
    (_, i) => quotient + (i < remaining ? 1 : 0),
  );
}
export function escalatedRent(rent: number, pct: number) {
  if (
    !Number.isSafeInteger(rent) ||
    rent < 0 ||
    !Number.isFinite(pct) ||
    pct < 0 ||
    pct > 100
  )
    throw new HttpError(422, "BAD_SOURCE", "Invalid recorded rent/escalation.");
  const [coefficient, exp = "0"] = String(pct).split("e"),
    [whole, fraction = ""] = coefficient.split(".");
  const scale = fraction.length - Number(exp);
  let numerator = BigInt(whole + fraction),
    denominator = 1n;
  if (scale >= 0) denominator = 10n ** BigInt(scale);
  else numerator *= 10n ** BigInt(-scale);
  const divisor = 100n * denominator,
    result = (BigInt(rent) * (divisor + numerator) + divisor / 2n) / divisor;
  if (result > 1000000000000n)
    throw new HttpError(
      422,
      "BAD_SOURCE",
      "Proposed rent exceeds supported paisa range.",
    );
  return Number(result);
}
export function retrievalTokens(text: string) {
  return [
    ...new Set(
      text
        .toLowerCase()
        .normalize("NFKC")
        .match(/[\p{L}\p{N}]{2,}/gu) || [],
    ),
  ].filter(
    (t) =>
      ![
        "the",
        "and",
        "for",
        "with",
        "what",
        "is",
        "are",
        "of",
        "in",
        "please",
        "ہے",
        "اور",
      ].includes(t),
  );
}
export function retrievalScore(query: string, text: string) {
  const q = retrievalTokens(query),
    words = new Set(retrievalTokens(text));
  if (!q.length) return 0;
  return q.filter((t) => words.has(t)).length / q.length;
}
export function extractLeaseTerms(text: string) {
  const money = (label: RegExp) => {
    const matches = [...text.matchAll(label)];
    if (matches.length !== 1) return null;
    const original = matches[0][1],
      integer = original.split(".")[0];
    if (
      integer.includes(",") &&
      !/^\d{1,3}(,\d{3})+$/.test(integer) &&
      !/^\d{1,2}(,\d{2})*,\d{3}$/.test(integer)
    )
      return null;
    const v = original.replaceAll(",", ""),
      [whole, fraction = ""] = v.split(".");
    if (!/^\d{1,10}$/.test(whole) || fraction.length > 2) return null;
    return Number(
      BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0"),
    );
  };
  const terms = [
    ...text.matchAll(
      /^Lease Term:\s*(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/gim,
    ),
  ];
  return {
    rentMinor:
      [...text.matchAll(/^Monthly Rent:/gim)].length === 1
        ? money(/^Monthly Rent:\s*PKR\s*([\d,]+(?:\.\d{1,2})?)(?:\s|$|\()/gim)
        : null,
    depositMinor:
      [...text.matchAll(/^Security Deposit:/gim)].length === 1
        ? money(
            /^Security Deposit:\s*PKR\s*([\d,]+(?:\.\d{1,2})?)(?:\s|$|\()/gim,
          )
        : null,
    startDate: terms.length === 1 ? terms[0][1] : null,
    endDate: terms.length === 1 ? terms[0][2] : null,
  };
}
