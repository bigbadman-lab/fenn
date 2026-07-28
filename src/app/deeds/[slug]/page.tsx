import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DeedDetail } from "@/components/deeds/deed-detail";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import { DeedsDetailPulse } from "@/components/world-pulse/deeds-pulse";
import { getPublicDeedBySlug } from "@/lib/deeds/queries";

export const dynamic = "force-dynamic";

type DeedDetailPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: DeedDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const deed = await getPublicDeedBySlug(slug);
  if (!deed) {
    return { title: "Deed" };
  }
  return { title: deed.title };
}

export default async function DeedDetailPage({ params }: DeedDetailPageProps) {
  const { slug } = await params;
  const deed = await getPublicDeedBySlug(slug);

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
