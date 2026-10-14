import { NextRequest, NextResponse } from "next/server";
import { HttpError, requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import {
  domainCatalog,
  startDomain,
  proposeAction,
} from "@/server/modules/domain-agents/domain.service";
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(domainCatalog(requireAuth(req)), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req),
      reader = req.body?.getReader();
    if (!reader) throw new HttpError(400, "BODY_REQUIRED", "JSON required.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 64000) {
        await reader.cancel();
        throw new HttpError(
          413,
          "BODY_TOO_LARGE",
          "Agent input is limited to 64,000 bytes.",
        );
      }
      chunks.push(value);
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new HttpError(400, "INVALID_JSON", "Invalid JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new HttpError(400, "INVALID_BODY", "Expected a JSON object.");
    const { action, ...input } = body;
    if (!["assess", "propose"].includes(String(action)))
      throw new HttpError(400, "UNKNOWN_ACTION", "Choose assess or propose.");
    return NextResponse.json(
      action === "assess" ? startDomain(ctx, input) : proposeAction(ctx, input),
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
