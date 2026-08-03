import { OfficialFennContract } from "@/components/commons/official-fenn-contract";
import { getPublicOfficialFennToken } from "@/lib/treasury/official-token";

/**
 * Compact homepage strip for the official $FENN contract.
 * Renders nothing before launch. Uses trusted DB-backed helper only.
 */
export async function HomeOfficialContract() {
  const token = await getPublicOfficialFennToken();
  if (!token) return null;
  return <OfficialFennContract token={token} variant="home" />;
}
