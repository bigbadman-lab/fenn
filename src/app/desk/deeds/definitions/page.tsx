import { redirect } from "next/navigation";

/**
 * Prevent `[submissionId]` from capturing the static "definitions" segment.
 * Nested authoring lives under /definitions/new and /definitions/[deedId].
 */
export default function DeskDeedsDefinitionsIndexPage() {
  redirect("/desk/deeds?view=definitions");
}
