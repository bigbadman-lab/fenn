import type { DeskDeedDefinition, DeedDefinitionFilter } from "@/lib/deeds/authoring";

export type {
  DeskDeedDefinition,
  DeedDefinitionFilter,
};

export type DeskDeedDefinitionListItem = Pick<
  DeskDeedDefinition,
  | "id"
  | "slug"
  | "title"
  | "status"
  | "accessScope"
  | "reward"
  | "isPublic"
  | "isRepeatable"
  | "publishedAt"
  | "createdAt"
  | "updatedAt"
  | "completionsCount"
  | "maxCompletions"
  | "startsAt"
  | "endsAt"
>;

export function toDefinitionListItem(
  deed: DeskDeedDefinition,
): DeskDeedDefinitionListItem {
  return {
    id: deed.id,
    slug: deed.slug,
    title: deed.title,
    status: deed.status,
    accessScope: deed.accessScope,
    reward: deed.reward,
    isPublic: deed.isPublic,
    isRepeatable: deed.isRepeatable,
    publishedAt: deed.publishedAt,
    createdAt: deed.createdAt,
    updatedAt: deed.updatedAt,
    completionsCount: deed.completionsCount,
    maxCompletions: deed.maxCompletions,
    startsAt: deed.startsAt,
    endsAt: deed.endsAt,
  };
}
