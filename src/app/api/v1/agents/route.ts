import { NextRequest, NextResponse } from "next/server";
import { HttpError, requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import * as a from "@/server/modules/orchestration/orchestration.service";
export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req),
      id = req.nextUrl.searchParams.get("id");
    return NextResponse.json(
      id ? a.runDetail(ctx, id) : a.orchestrationCatalog(ctx),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req),
      reader = req.body?.getReader();
    if (!reader)
      throw new HttpError(400, "BODY_REQUIRED", "JSON body required.");
    let length = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 64000) {
        await reader.cancel();
        throw new HttpError(
          413,
          "BODY_TOO_LARGE",
          "Plan requests must be at most 64 KiB.",
        );
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, "INVALID_JSON", "Invalid JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new HttpError(400, "INVALID_BODY", "Expected a JSON object.");
    const { action, ...input } = body;
    const result =
      action === "start"
        ? a.startRun(ctx, input)
        : action === "advance" && typeof input.id === "string"
          ? a.advanceRun(ctx, input.id)
          : action === "cancel"
            ? a.cancelRun(ctx, input)
            : action === "review"
              ? a.reviewApproval(ctx, input)
              : action === "engine"
                ? a.configureEngine(ctx, input)
                : action === "agent"
                  ? a.configureAgent(ctx, input)
                  : null;
    if (!result)
      throw new HttpError(
        400,
        "UNKNOWN_ACTION",
        "Unknown orchestration action.",
      );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
