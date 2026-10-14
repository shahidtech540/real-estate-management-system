import { NextRequest, NextResponse } from "next/server";
import { requireAuth, HttpError } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import * as a from "@/server/modules/accounting/accounting.service";
import * as schedules from "@/server/modules/accounting/schedules.service";
export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req),
      action = req.nextUrl.searchParams.get("action");
    if (action === "receipt") {
      const receipt = a.expenseReceipt(
        ctx,
        req.nextUrl.searchParams.get("id") || "",
      );
      return new NextResponse(receipt.bytes, {
        headers: {
          "Content-Type": receipt.mime,
          "Content-Disposition": `attachment; filename="${receipt.name.replace(/[^a-zA-Z0-9_.-]/g, "_")}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }
    return NextResponse.json(
      { ...a.accountingCatalog(ctx), ...schedules.listSchedules(ctx) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    // Bound uploaded receipts before parsing; Content-Length alone is not trusted.
    const reader = req.body?.getReader();
    if (!reader)
      throw new HttpError(400, "BODY_REQUIRED", "JSON body required.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4_250_000) {
        await reader.cancel();
        throw new HttpError(
          413,
          "BODY_TOO_LARGE",
          "Request must be at most 4.25 MB.",
        );
      }
      chunks.push(value);
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new HttpError(400, "INVALID_JSON", "Invalid JSON body.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new HttpError(400, "INVALID_BODY", "Expected JSON object.");
    const { action, ...input } = body;
    const result =
      action === "sync"
        ? a.synchronize(ctx)
        : action === "account"
          ? a.createAccount(ctx, input)
          : action === "journal"
            ? a.manualJournal(ctx, input)
            : action === "reverse"
              ? a.reverseJournal(ctx, input)
              : action === "expense"
                ? a.createExpense(ctx, input)
                : action === "voidExpense"
                  ? a.voidExpense(ctx, input)
                  : action === "payVendor"
                    ? a.payVendor(ctx, input)
                    : action === "budget"
                      ? a.saveBudget(ctx, input)
                      : action === "schedule"
                        ? schedules.saveSchedule(ctx, input)
                        : action === "pauseSchedule"
                          ? schedules.pauseSchedule(ctx, input)
                          : null;
    if (!result)
      throw new HttpError(400, "UNKNOWN_ACTION", "Unknown accounting action.");
    return NextResponse.json(result, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
