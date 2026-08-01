/** Member-safe ASCII sigil projection for The Fire. */
export type SafeGreenwoodSigil = {
  slug: string;
  asciiBody: string;
  a11yLabel: string;
  width: number;
  height: number;
  isFallback: boolean;
};

export type GreenwoodSigilAssignmentResult = SafeGreenwoodSigil & {
  profileId: string;
  sigilId: string;
  newlyAssigned: boolean;
  assignedAt: string;
};

export type AssignGreenwoodSigilRpcRow = {
  profile_id: string;
  sigil_id: string;
  slug: string;
  ascii_body: string;
  a11y_label: string;
  width: number | string;
  height: number | string;
  is_fallback: boolean;
  newly_assigned: boolean;
  assigned_at: string;
};
