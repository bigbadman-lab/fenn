/**
 * Book of the Road — post-registration arrival.
 * One authoritative destination for every successful Outlaw registration surface.
 */
export const OUTLAW_REGISTRATION_ARRIVAL_PATH = "/outlaw" as const;

/** Prefer replace so Back does not land on a completed register form. */
export const OUTLAW_REGISTRATION_ARRIVAL_METHOD = "replace" as const;

/** Client-only phases for the Register surface (not shown as API names). */
export type OutlawRegisterPhase =
  | "idle"
  | "submitting"
  | "writing"
  | "write_open_failed";

/** Holding state while bootstrap catches up after the name is written. */
export const REGISTRATION_WRITING_COPY = {
  title: "YOUR NAME IS BEING WRITTEN.",
  body: "The Register is remembering you.",
  status: "[ writing the name… ]",
} as const;

/**
 * Pre-form hold after Privy auth while identity / wallet resolve.
 * Registration is not finished — user must stay on the page.
 */
export const REGISTRATION_IDENTITY_PREPARING_COPY = {
  title: "BECOMING AN OUTLAW",
  body: "YOUR IDENTITY IS BEING PREPARED.",
  wait: "WAIT HERE — THE OUTLAW FORM IS OPENING…",
  note: "THIS MAY TAKE A FEW SECONDS.",
} as const;

/** Registration already succeeded; refresh/open failed. */
export const REGISTRATION_WRITE_OPEN_FAILED_COPY = {
  title: "YOUR NAME WAS WRITTEN.",
  body: "The road did not open cleanly.",
  action: "[ CONTINUE TO YOUR OUTLAW ]",
} as const;
