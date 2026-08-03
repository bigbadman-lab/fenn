import "server-only";

import type { FennDeskIdentity } from "@/lib/desk/auth";
import type { DeskDeedDefinitionListItem } from "@/lib/desk/deed-definition-types";
import { toDefinitionListItem } from "@/lib/desk/deed-definition-types";
import {
  archiveDeed,
  closeDeed,
  createDeedDraft,
  deleteDeedDraft,
  duplicateDeed,
  getDeedDefinition,
  listDeedDefinitions,
  publishDeed,
  updateDeedDraft,
  type DeedDefinitionFilter,
  type DeskDeedDefinition,
} from "@/lib/deeds/authoring";
import type {
  CreateDeedDraftInput,
  UpdateDeedDraftInput,
} from "@/lib/deeds/authoring-validation";

export async function deskListDeedDefinitions(
  filter: DeedDefinitionFilter = "all",
): Promise<DeskDeedDefinitionListItem[]> {
  const deeds = await listDeedDefinitions(filter);
  return deeds.map(toDefinitionListItem);
}

export async function deskGetDeedDefinition(
  deedId: string,
): Promise<DeskDeedDefinition | null> {
  return getDeedDefinition(deedId);
}

export async function deskCreateDeedDraft(
  input: CreateDeedDraftInput,
  identity: FennDeskIdentity,
): Promise<DeskDeedDefinition> {
  return createDeedDraft(input, identity.actorId);
}

export async function deskUpdateDeedDraft(
  deedId: string,
  input: UpdateDeedDraftInput,
  identity: FennDeskIdentity,
): Promise<DeskDeedDefinition> {
  return updateDeedDraft(deedId, input, identity.actorId);
}

export async function deskPublishDeed(
  deedId: string,
  identity: FennDeskIdentity,
): Promise<DeskDeedDefinition> {
  return publishDeed(deedId, identity.actorId);
}

export async function deskCloseDeed(
  deedId: string,
  identity: FennDeskIdentity,
): Promise<DeskDeedDefinition> {
  return closeDeed(deedId, identity.actorId);
}

export async function deskArchiveDeed(
  deedId: string,
  identity: FennDeskIdentity,
): Promise<DeskDeedDefinition> {
  return archiveDeed(deedId, identity.actorId);
}

export async function deskDeleteDeedDraft(
  deedId: string,
  identity: FennDeskIdentity,
): Promise<{ deleted: true; deedId: string }> {
  return deleteDeedDraft(deedId, identity.actorId);
}

export async function deskDuplicateDeed(
  deedId: string,
  identity: FennDeskIdentity,
): Promise<DeskDeedDefinition> {
  return duplicateDeed(deedId, identity.actorId);
}
