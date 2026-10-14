import { zipSync, strToU8 } from "fflate";
import { NextResponse } from "next/server";
import { HttpError, requirePermission } from "@/server/auth/guards";
import type { JwtPayload } from "@/server/auth/crypto";
import { recordAuditLog } from "../audit/audit.service";
import { pdfResponse } from "../shared/pdf";
import {
  financialReport,
  ledgerReport,
  operationalReport,
  type ReportFilter,
} from "./reports.service";
type Cell = string | number;
export function csvCell(value: Cell) {
  const s =
    typeof value === "number"
      ? String(value)
      : /^[\s]*[=+\-@\t\r]/.test(value)
        ? `'${value}`
        : value;
  return `"${s.replaceAll('"', '""')}"`;
}
const xml = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
/** Minimal genuine XLSX. Text uses inlineStr, never formulas or external links. */
export function workbook(sheets: { name: string; rows: Cell[][] }[]) {
  const files: Record<string, Uint8Array> = {};
  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  );
  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  files["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
  );
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet.rows.map((r, n) => `<row r="${n + 1}">${r.map((c) => (typeof c === "number" ? `<c><v>${c}</v></c>` : `<c t="inlineStr"><is><t xml:space="preserve">${xml(c)}</t></is></c>`)).join("")}</row>`).join("")}</sheetData></worksheet>`,
    );
  });
  return zipSync(files, { level: 6 });
}
export async function exportReport(
  ctx: JwtPayload,
  q: ReportFilter,
  format: string,
  kind: string,
) {
  requirePermission(ctx, "accounting:read");
  requirePermission(ctx, "reports:export");
  if (
    !["csv", "xlsx", "pdf"].includes(format) ||
    !["summary", "ledger"].includes(kind)
  )
    throw new HttpError(
      400,
      "EXPORT_FORMAT",
      "Choose csv, xlsx or pdf and summary or ledger.",
    );
  const report = financialReport(ctx, q),
    ops = operationalReport(ctx, q),
    money = (n: number) => n / 100;
  const summary: Cell[][] = [
    [
      "Fahad Real Estate — property operations, not corporate statutory accounts",
    ],
    ["Currency", "PKR"],
    ["Basis", "Accrual"],
    ["From", q.from],
    ["To", q.to],
    ["Project", q.propertyId || "All"],
    ["Owner", q.ownerId || "All"],
    [
      "Historical settlements",
      "Legacy clearing is NOT bank receipts; balances are recorded, not bank-verified.",
    ],
    [
      "Posting complete (organization-wide)",
      report.reconciliation.fullyPosted
        ? "Yes"
        : "No — synchronize/investigate",
    ],
    ["All monetary columns below", "PKR, not paisa"],
    ["Income", money(report.totals.incomeMinor)],
    ["Expenses", money(report.totals.expenseMinor)],
    ["Net income", money(report.totals.profitMinor)],
    ["Recorded cash movement", money(report.totals.cashMovementMinor)],
    ["Receivables closing", money(report.totals.receivablesMinor)],
    ["Payables closing", money(report.totals.payablesMinor)],
    ["Legacy clearing closing", money(report.totals.legacyClearingMinor)],
    ["Assets", money(report.totals.assetsMinor)],
    ["Liabilities", money(report.totals.liabilitiesMinor)],
    ["Equity excluding earnings", money(report.totals.equityMinor)],
    ["Retained earnings", money(report.totals.retainedEarningsMinor)],
    ["Current occupancy %", ops.occupancy.occupancyPct],
    ["Recorded rent receipts in range", money(ops.rent.recordedReceiptsMinor)],
    [
      "Current outstanding invoices",
      money(Object.values(ops.aging).reduce((a, b) => a + b, 0)),
    ],
    ["Lead cohort conversion %", ops.leadConversion.conversionPct],
  ];
  const trial: Cell[][] = [
    [
      "Code",
      "Account",
      "Type",
      "Opening signed PKR",
      "Debit PKR",
      "Credit PKR",
      "Closing signed PKR",
    ],
    ...report.accounts.map((a) => [
      a.code,
      a.name,
      a.type,
      money(a.openingMinor),
      money(a.debitMinor),
      money(a.creditMinor),
      money(a.closingMinor),
    ]),
  ];
  const budgets: Cell[][] = [
    [
      "Month",
      "Project",
      "Code",
      "Expense",
      "Full-month budget PKR",
      "Actual in selected dates PKR",
      "Remaining PKR",
    ],
    ...report.budgets.map((b) => [
      b.periodMonth,
      b.propertyName,
      b.accountCode,
      b.accountName,
      money(b.plannedMinor),
      money(b.actualMinor),
      money(b.varianceMinor),
    ]),
  ];
  let sheets = [
    { name: "Summary", rows: summary },
    { name: "Trial balance", rows: trial },
    { name: "Budget actual", rows: budgets },
    {
      name: "Current arrears",
      rows: [
        ["Invoice", "Tenant", "Due", "Days overdue", "Outstanding PKR"],
        ...ops.arrears.map((a) => [
          a.invoiceNumber,
          a.tenantName,
          a.dueDate,
          a.daysOverdue,
          money(a.outstandingMinor),
        ]),
      ] as Cell[][],
    },
    {
      name: "Vacancy",
      rows: [
        ["Project", "Unit", "Vacant since", "Days (unknown if empty)"],
        ...ops.vacancies.map((v) => [
          v.propertyName,
          v.unitNumber,
          v.vacantSince || "",
          v.vacantDays ?? "",
        ]),
      ] as Cell[][],
    },
    {
      name: "Agents",
      rows: [
        [
          "Agent",
          "Assigned cohort leads",
          "Won cohort leads",
          "Deals closed in range",
          "Recorded split commission PKR",
        ],
        ...ops.agents.map((a) => [
          a.name,
          a.assignedLeads,
          a.wonLeads,
          a.closedDeals,
          money(a.commissionMinor),
        ]),
      ] as Cell[][],
    },
  ];
  if (kind === "ledger") {
    const ledger = ledgerReport(ctx, q, 1, 10000);
    if (ledger.total > 10000)
      throw new HttpError(
        413,
        "EXPORT_TOO_LARGE",
        "More than 10,000 ledger lines. Narrow the date/project scope; export is never silently truncated.",
      );
    sheets = [
      {
        name: "Ledger",
        rows: [
          [
            "Date",
            "Journal",
            "Reference",
            "Project",
            "Code",
            "Account",
            "Direction",
            "Amount PKR",
            "Description",
            "Source",
          ],
          ...ledger.rows.map((r) => [
            String(r.entryDate),
            String(r.journalId),
            String(r.reference),
            String(r.propertyName || "Office / unallocated"),
            String(r.accountCode),
            String(r.accountName),
            String(r.direction),
            money(r.amountMinor),
            String(r.description),
            String(r.sourceType),
          ]),
        ],
      },
    ];
  }
  recordAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.sub,
    action: "accounting.report_exported",
    entityType: "report",
    entityId: kind,
    metadata: { ...q, format },
  });
  const filename = `fahad-${kind}-${q.from}-${q.to}.${format}`;
  if (format === "pdf")
    return pdfResponse(
      `Fahad Real Estate — ${kind}`,
      [
        `Accrual | PKR | ${q.from} to ${q.to} | Project ${q.propertyId || "all"} | Owner ${q.ownerId || "all"}`,
        "Property operations only; recorded cash is not a bank reconciliation. Legacy clearing is not verified cash.",
        "English PDF template; Unicode text remains available in CSV/XLSX.",
        ...sheets.flatMap((s) => [s.name, ...s.rows.map((r) => r.join(" | "))]),
      ],
      filename,
    );
  const data =
    format === "xlsx"
      ? Buffer.from(workbook(sheets))
      : "\uFEFF" +
        sheets
          .flatMap((s) => [[s.name], ...s.rows, []])
          .map((r) => r.map(csvCell).join(","))
          .join("\r\n");
  return new NextResponse(data, {
    headers: {
      "Content-Type":
        format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
