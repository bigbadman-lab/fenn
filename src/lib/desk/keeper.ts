import "server-only";

import type { FennDeskIdentity } from "@/lib/desk/auth";
import type { SafeDeskKeeper } from "@/lib/desk/types";
import { getProfileSigil } from "@/lib/greenwood/sigil/assignment";
import { formatOutlawNumber } from "@/lib/profiles/types";

export type { SafeDeskKeeper } from "@/lib/desk/types";

export function deskKeeperDisplayName(identity: FennDeskIdentity): string {
  const alias = identity.outlawAlias?.trim();
  if (alias) return alias;
  return `Outlaw ${formatOutlawNumber(identity.outlawNumber)}`;
}

/**
 * Build the safe Keeper view for authorised Desk surfaces.
 * Sigil is optional — missing assignment is omitted, never assigned here.
 */
export async function loadSafeDeskKeeper(
  identity: FennDeskIdentity,
): Promise<SafeDeskKeeper> {
  let sigil: SafeDeskKeeper["sigil"] = null;
  try {
    const assigned = await getProfileSigil(identity.profileId);
    if (assigned) {
      sigil = {
        asciiBody: assigned.asciiBody,
        a11yLabel: assigned.a11yLabel,
      };
    }
  } catch {
    sigil = null;
  }

  return {
    displayName: deskKeeperDisplayName(identity),
    outlawNumberLabel: formatOutlawNumber(identity.outlawNumber),
    sigil,
  };
}
