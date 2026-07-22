import type { Metadata } from "next";

import { CampGround } from "@/components/camp/camp-ground";

export const metadata: Metadata = {
  title: "The Camp",
};

export default function CampPage() {
  return <CampGround />;
}
