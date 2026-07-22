import { HomeGreenwoodTeaser } from "@/components/home/home-greenwood-teaser";
import { HomeIdentity } from "@/components/home/home-identity";
import { HomeLoreInterrupt } from "@/components/home/home-lore-interrupt";
import { HomeOutlawRegister } from "@/components/home/home-outlaw-register";
import { HomePaths } from "@/components/home/home-paths";
import { HomeWelcome } from "@/components/home/home-welcome";

export default function HomePage() {
  return (
    <div className="home">
      <HomeIdentity />
      <HomeWelcome />
      <HomeLoreInterrupt />
      <HomeOutlawRegister />
      <HomeGreenwoodTeaser />
      <HomePaths />
    </div>
  );
}
