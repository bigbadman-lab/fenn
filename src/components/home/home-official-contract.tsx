import { OfficialFennContract } from "@/components/commons/official-fenn-contract";
import { getPublicOfficialFennToken } from "@/lib/treasury/official-token";

/**
 * Compact homepage strip for the official $FENN contract.
 * Always visible. Pending when unresolved; live CA only from DB resolver.
 * Request-time (page ISR) — no cached address at import time.
 * Mounted at the top of the world/map section (HomeIdentity), above the map.
 */
export async function HomeOfficialContract() {
  const token = await getPublicOfficialFennToken();
  return <OfficialFennContract token={token} variant="home" />;
}
