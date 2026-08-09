import type { Metadata } from "next";

import { HomeFennVoice } from "@/components/home/home-fenn-voice";
import { HomeFirstThirty } from "@/components/home/home-first-thirty";
import { HomeGreenwoodTeaser } from "@/components/home/home-greenwood-teaser";
import { HomeIdentity } from "@/components/home/home-identity";
import { HomeLiveTicker } from "@/components/home/home-live-ticker";
import { HomeLoreInterrupt } from "@/components/home/home-lore-interrupt";
import { HomeOutlawRegister } from "@/components/home/home-outlaw-register";
import { HomePaths } from "@/components/home/home-paths";
import { HomeWelcome } from "@/components/home/home-welcome";
import { LoreTransmission } from "@/components/home/lore-transmission";
import { buildHomeMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildHomeMetadata();

/**
 * ISR so an operator-inserted official FENN row can appear without redeploy.
 * Target freshness: next full regeneration within 60s (not trading realtime).
 * Live ticker is a separate client island + no-store API.
 */
export const revalidate = 60;

/**
 * Homepage order: live wire → orient → journey → world/map (+ official $FENN
 * contract above the map) → Outlaw → deeper lore → directory.
 */
export default function HomePage() {
  return (
    <div className="home">
      <HomeLiveTicker />
      <HomeWelcome />
      <HomeFirstThirty />
      <HomeIdentity />
      <HomeOutlawRegister />
      <HomeFennVoice />
      <LoreTransmission />
      <HomeLoreInterrupt />
      <HomeGreenwoodTeaser />
      <HomePaths />
    </div>
  );
}
