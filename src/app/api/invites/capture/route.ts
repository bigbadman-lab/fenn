import { NextResponse } from "next/server";

import {
  captureInviteAttribution,
  clearInviteCookie,
  normalizeInviteCode,
  setInviteCookie,
} from "@/lib/invites";

export const runtime = "nodejs";

/**
 * Public invite capture. Does not reveal profile IDs or private identity data.
 * Invalid codes do not block entry — they simply clear attribution.
 */
export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { valid: false },
        {
          status: 200,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }

    const raw =
      body &&
      typeof body === "object" &&
      body !== null &&
      "inviteCode" in body
        ? (body as { inviteCode: unknown }).inviteCode
        : null;

    const code = normalizeInviteCode(raw);
    if (!code) {
      await clearInviteCookie();
      return NextResponse.json(
        { valid: false },
        {
          status: 200,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }

    const result = await captureInviteAttribution(code);

    if (result.valid) {
      await setInviteCookie(code);
    } else {
      await clearInviteCookie();
    }

    // Public surface: validity + optional safe inviter label only.
    return NextResponse.json(
      {
        valid: result.valid,
        ...(result.valid && result.inviterLabel
          ? { inviterLabel: result.inviterLabel }
          : {}),
      },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    console.error("[api/invites/capture]", error);
    try {
      await clearInviteCookie();
    } catch {
      // ignore
    }
    return NextResponse.json(
      { valid: false },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
