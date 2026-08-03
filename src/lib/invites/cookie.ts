import "server-only";

import { cookies } from "next/headers";

import { normalizeInviteCode } from "@/lib/invites/codes";
import {
  INVITE_COOKIE_MAX_AGE_SECONDS,
  INVITE_COOKIE_NAME,
} from "@/lib/invites/constants";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export type InviteCookieOptions = {
  maxAgeSeconds?: number;
};

/**
 * Set HttpOnly invite attribution cookie. Server revalidates the code later.
 */
export async function setInviteCookie(
  inviteCode: string,
  options?: InviteCookieOptions,
): Promise<void> {
  const code = normalizeInviteCode(inviteCode);
  if (!code) return;

  const store = await cookies();
  store.set(INVITE_COOKIE_NAME, code, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: options?.maxAgeSeconds ?? INVITE_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearInviteCookie(): Promise<void> {
  const store = await cookies();
  store.set(INVITE_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: 0,
  });
}

export async function readInviteCookie(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(INVITE_COOKIE_NAME)?.value;
  return normalizeInviteCode(raw ?? "");
}
