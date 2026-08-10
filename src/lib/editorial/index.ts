/** Server-side Editorial Room public surface for API routes. */
export {
  EDITORIAL_CATEGORIES,
  EDITORIAL_CATEGORY_LABELS,
  EDITORIAL_CATEGORY_QUOTAS,
  EDITORIAL_MODES,
  EDITORIAL_MODE_LABELS,
  EDITORIAL_MODE_QUOTAS,
  EDITORIAL_PACKAGE_SIZE,
  type EditorialCategory,
  type EditorialMode,
} from "@/lib/editorial/categories";
export { EditorialError } from "@/lib/editorial/errors";
export {
  getEditorialRoomSnapshot,
  prepareTodaysEditorialPackage,
  regenerateEditorialTransmission,
  speakOnceForKeeper,
} from "@/lib/editorial/service";
export {
  approveTransmission,
  getEditorialRunById,
  incrementTransmissionCopyCount,
  updateTransmissionEditedBody,
} from "@/lib/editorial/store";
export type {
  EditorialDailyOverview,
  EditorialRoomSnapshot,
  SafeEditorialRun,
  SafeEditorialTransmission,
} from "@/lib/editorial/types";
export { EDITORIAL_KEEPER_CONTEXT_MAX_CHARS } from "@/lib/editorial/types";
