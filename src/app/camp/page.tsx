import type { Metadata } from "next";

import { CampGround } from "@/components/camp/camp-ground";
import { buildPublicMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPublicMetadata({
  title: "CAMP",
  description:
    "Sit by the fire. Speak with the Camp. Some words leave a mark.",
  path: "/camp",
});

export default function CampPage() {
  return <CampGround />;
}
