import type { Metadata } from "next";

import { HomeFirstThirty } from "@/components/home/home-first-thirty";
import { HomeGreenwoodTeaser } from "@/components/home/home-greenwood-teaser";
import { HomeHeaderContract } from "@/components/home/home-header-contract";
import { HomeIdentity } from "@/components/home/home-identity";
import { HomeLiveTicker } from "@/components/home/home-live-ticker";
import { HomeLoreInterrupt } from "@/components/home/home-lore-interrupt";
import { HomeOutlawRegister } from "@/components/home/home-outlaw-register";
import { HomePaths } from "@/components/home/home-paths";
import { HomeWelcome } from "@/components/home/home-welcome";
import { LoreTransmission } from "@/components/home/lore-transmission";
import { buildHomeMetadata } from "@/lib/site/metadata";

export const metadata = buildHomeMetadata();

/**
 * ISR for homepage freshness (not trading realtime).
 * Live ticker is a separate client island + no-store API.
 */
export const revalidate = 60;

/**
 * Homepage: live wire → arrival stage → map vault → register → lore → directory.
 */
export default function HomePage() {
  return (
    <div className="home">
      <HomeHeaderContract />
      <HomeLiveTicker />

      <div className="home-stage">
        <div className="home-stage__watermark" aria-hidden="true">
          VELL
        </div>

        <div className="home-stage__intro">
          <HomeWelcome />
          <HomeFirstThirty />
        </div>

        <div className="home-stage__map-vault">
          <HomeIdentity />
        </div>
      </div>

      <HomeOutlawRegister />
      <LoreTransmission />
      <HomeLoreInterrupt />
      <HomeGreenwoodTeaser />
      <HomePaths />
    </div>
  );
}
