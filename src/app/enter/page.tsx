import { redirect } from "next/navigation";

import {
  captureInviteAttribution,
  clearInviteCookie,
  normalizeInviteCode,
  setInviteCookie,
} from "@/lib/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EnterPageProps = {
  searchParams: Promise<{ invite?: string | string[] }>;
};

/**
 * Invite landing route.
 * Captures attribution into an HttpOnly cookie, then continues normal entry.
 * Invalid codes never block the road.
 */
export default async function EnterPage({ searchParams }: EnterPageProps) {
  const params = await searchParams;
  const raw = Array.isArray(params.invite) ? params.invite[0] : params.invite;
  const code = normalizeInviteCode(raw ?? "");

  if (!code) {
    try {
      await clearInviteCookie();
    } catch {
      // ignore
    }
    redirect("/#outlaw-register");
  }

  let valid = false;
  let inviterLabel: string | null = null;

  try {
    const result = await captureInviteAttribution(code);
    valid = result.valid;
    inviterLabel = result.inviterLabel;
    if (valid) {
      await setInviteCookie(code);
    } else {
      await clearInviteCookie();
    }
  } catch (err) {
    console.error("[enter invite]", err);
    try {
      await clearInviteCookie();
    } catch {
      // ignore
    }
    redirect("/#outlaw-register");
  }

  if (valid) {
    const led = inviterLabel
      ? `led=1&from=${encodeURIComponent(inviterLabel)}`
      : "led=1";
    redirect(`/outlaw/register?${led}`);
  }

  redirect("/#outlaw-register");
}
