import { OfficialFennContract } from "@/components/commons/official-fenn-contract";
import { getPublicOfficialFennToken } from "@/lib/treasury/official-token";

/**
 * Homepage verification strip for the official $FENN contract.
 * Always visible. Pending when unresolved; live CA only from DB resolver.
 * Request-time (page ISR) — no cached address at import time.
 */
export async function HomeOfficialContract() {
  const token = await getPublicOfficialFennToken();
  return <OfficialFennContract token={token} variant="home" />;
}
