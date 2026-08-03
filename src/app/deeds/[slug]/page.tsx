import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DeedDetail } from "@/components/deeds/deed-detail";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import { DeedsDetailPulse } from "@/components/world-pulse/deeds-pulse";
import { getPublicDeedBySlugCached } from "@/lib/deeds/queries";
import {
  DEED_METADATA_DESCRIPTION_FALLBACK,
  buildPublicMetadata,
  normalizePublicDescription,
  PRIVATE_ROBOTS,
} from "@/lib/site/metadata";

export const dynamic = "force-dynamic";

type DeedDetailPageProps = {
  params: Promise<{ slug: string }>;
};

function missingDeedMetadata(): Metadata {
  return {
    title: "DEED",
    description: DEED_METADATA_DESCRIPTION_FALLBACK,
    robots: PRIVATE_ROBOTS,
  };
}

export async function generateMetadata({
  params,
}: DeedDetailPageProps): Promise<Metadata> {
  try {
    const { slug } = await params;
    const deed = await getPublicDeedBySlugCached(slug);
    if (!deed?.slug) {
      return missingDeedMetadata();
    }

    const description = normalizePublicDescription(
      deed.loreDescription,
      DEED_METADATA_DESCRIPTION_FALLBACK,
    );

    return buildPublicMetadata({
      title: deed.title,
      description,
      path: `/deeds/${deed.slug}`,
    });
  } catch {
    return missingDeedMetadata();
  }
}

export default async function DeedDetailPage({ params }: DeedDetailPageProps) {
  const { slug } = await params;
  const deed = await getPublicDeedBySlugCached(slug);

  if (!deed) {
    notFound();
  }

  return (
    <article className="place deeds-place">
      <DeedsDetailPulse endsAt={deed.endsAt} />
      <AsciiPageTitle title="DEEDS" mark="DEEDS" accent="deeds" />
      <DeedDetail deed={deed} />
    </article>
  );
}
