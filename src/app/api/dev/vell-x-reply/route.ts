import { NextResponse } from "next/server";

import {
  assertDevOnly,
  DevOnlyForbiddenError,
} from "@/lib/dev/assert-dev-only";
import {
  generateVellXReply,
  parseVellXReplyRequest,
  VellXReplyError,
} from "@/lib/dev/vell-x-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/dev/vell-x-reply
 * Local-only VELL X reply draft. No X API. No database. No auth.
 */
export async function POST(request: Request) {
  try {
    assertDevOnly();
  } catch (error) {
    if (error instanceof DevOnlyForbiddenError) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 },
      );
    }
    throw error;
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON." },
      { status: 400 },
    );
  }

  try {
    const parsed = parseVellXReplyRequest(json);
    const result = await generateVellXReply(parsed);
    return NextResponse.json({ replyText: result.replyText });
  } catch (error) {
    if (error instanceof VellXReplyError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Reply generation failed." },
      { status: 500 },
    );
  }
}
