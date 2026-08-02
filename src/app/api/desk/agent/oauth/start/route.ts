import { writeAdminAuditLog } from "@/lib/admin/audit";
import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildXAuthorizationUrl,
  generatePkcePair,
  getXOauthClientConfig,
  pkceExpiresAt,
} from "@/lib/x/oauth-config";
import { createPkceSession } from "@/lib/x/oauth-tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Desk-native OAuth start for @askfenn.
 * Returns the authorization URL as JSON so Privy bearer auth can be used.
 * Reuses the same PKCE helpers and callback as Admin start.
 * Does not return tokens.
 */
async function startOauth(request: Request) {
  const identity = await requireFennDeskAccess(request);
  const config = getXOauthClientConfig();
  const pkce = generatePkcePair();

  await createPkceSession({
    state: pkce.state,
    codeVerifier: pkce.codeVerifier,
    actorId: identity.actorId,
    expiresAt: pkceExpiresAt(),
  });

  const db = createAdminClient();
  await writeAdminAuditLog(db, {
    actorId: identity.actorId,
    action: "desk.agent.oauth_start",
    entityType: "x_oauth_credentials",
    entityId: "askfenn",
    afterState: { started: true },
  });

  const authorizationUrl = buildXAuthorizationUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state: pkce.state,
    codeChallenge: pkce.codeChallenge,
  });

  return deskJson({ ok: true, authorizationUrl });
}

export async function GET(request: Request) {
  try {
    return await startOauth(request);
  } catch (error) {
    return mapDeskError(error, "GET /api/desk/agent/oauth/start");
  }
}

export async function POST(request: Request) {
  try {
    return await startOauth(request);
  } catch (error) {
    return mapDeskError(error, "POST /api/desk/agent/oauth/start");
  }
}
