/**
 * Format integer minor units (1 PKR = 100 paisa) into human-readable currency string.
 */
export function formatMinorCurrency(amountMinor: number, currency = "PKR"): string {
  const major = Math.round(amountMinor / 100);
  return `${currency} ${major.toLocaleString("en-PK")}`;
}

export function formatCompactPkr(amountMinor: number): string {
  const major = amountMinor / 100;
  if (major >= 10_000_000) {
    return `PKR ${(major / 10_000_000).toFixed(2)} Crore`;
  }
  if (major >= 100_000) {
    return `PKR ${(major / 100_000).toFixed(2)} Lakh`;
  }
  return `PKR ${Math.round(major).toLocaleString("en-PK")}`;
}
