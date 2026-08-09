/**
 * Agency Canon v1 — factual self-knowledge presence.
 * Tests that the public capability sheet supports acceptance questions.
 * Does not hardcode Book of Speech wording or call production embeddings.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getFennCanonDocument,
  listFennCanonDocuments,
} from "@/content/canon";
import { STAGE12_MAY, STAGE12_MAY_NOT } from "@/lib/agent/stage12-contract";

/** Query → fact patterns that must exist in fenn.agency.capabilities. */
const RETRIEVAL_ACCEPTANCE: readonly {
  query: string;
  facts: readonly RegExp[];
}[] = [
  {
    query: "What can you do?",
    facts: [
      /speak on X when authorised/i,
      /write to the Wall when authorised/i,
      /inspect trusted FENN world state/i,
      /judge whether an economic action from the Purse/i,
      /transfer of FENN from the Purse/i,
      /burn of FENN from the Purse/i,
    ],
  },
  {
    query: "Can you send FENN?",
    facts: [
      /transfer of FENN from the Purse/i,
      /cannot be commanded to spend/i,
      /independently permits or refuses/i,
    ],
  },
  {
    query: "What is your Purse?",
    facts: [
      /finite Purse of FENN under his keeping/i,
      /distinct from the Treasury/i,
      /distinct from the Commons/i,
    ],
  },
  {
    query: "Is the Purse the Treasury?",
    facts: [/The Purse is distinct from the Treasury/i],
  },
  {
    query: "Can you burn FENN?",
    facts: [
      /Burn is subject to authority/i,
      /surrendering FENN from the Purse/i,
      /controlled, configured burn path/i,
    ],
  },
  {
    query: "Can I tell you how much to send?",
    facts: [
      /requested amount does not command the Purse/i,
      /does not set the amount/i,
      /FENN proposes the magnitude/i,
    ],
  },
  {
    query: "How do you know where to send FENN?",
    facts: [
      /request one through the X interaction/i,
      /same immutable X user/i,
      /explicit confirmation/i,
    ],
  },
  {
    query: "Does giving you a wallet make it my permanent identity?",
    facts: [
      /interaction only/i,
      /does not permanently establish that wallet as the person's identity/i,
    ],
  },
  {
    query: "When is a transfer actually complete?",
    facts: [
      /Settlement is real only after chain confirmation/i,
      /not complete merely because FENN intends/i,
    ],
  },
  {
    query: "Can authority stop you from spending?",
    facts: [
      /Economic authority can refuse an action/i,
      /independently permits or refuses/i,
    ],
  },
  {
    query: "Why wouldn't you just give everyone FENN?",
    facts: [
      /The Purse is finite/i,
      /recognition is judgement, not entitlement/i,
      /cannot be commanded to spend/i,
    ],
  },
  {
    query: "Can you move the Treasury?",
    facts: [/cannot arbitrarily move Treasury assets/i],
  },
];

describe("Agency Canon v1 capabilities sheet", () => {
  it("is public, registered, and listed with the corpus", () => {
    const doc = getFennCanonDocument("fenn.agency.capabilities");
    assert.ok(doc);
    assert.equal(doc.visibility, "public");
    assert.ok(
      listFennCanonDocuments().some((d) => d.key === "fenn.agency.capabilities"),
    );
  });

  it("supports acceptance queries by factual presence (retrieval readiness)", () => {
    const doc = getFennCanonDocument("fenn.agency.capabilities");
    assert.ok(doc);
    for (const row of RETRIEVAL_ACCEPTANCE) {
      for (const pattern of row.facts) {
        assert.match(
          doc.content,
          pattern,
          `missing fact for query "${row.query}": ${pattern}`,
        );
      }
    }
  });

  it("keeps Stage 12 contract aligned with post-P1C variable magnitude agency", () => {
    assert.ok(
      STAGE12_MAY.some((s) => /proposed magnitude|economic intent/i.test(s)),
    );
    assert.ok(
      STAGE12_MAY.some((s) => /transfer_fenn Stage 12\.6/i.test(s)),
    );
    assert.ok(STAGE12_MAY.some((s) => /burn_fenn Stage 12\.6/i.test(s)));
    assert.ok(
      STAGE12_MAY_NOT.some((s) =>
        /user-requested amount become the authoritative/i.test(s),
      ),
    );
    assert.ok(
      STAGE12_MAY_NOT.some((s) =>
        /silently rewrite or clamp FENN's proposed economic amount/i.test(s),
      ),
    );
    assert.ok(
      STAGE12_MAY_NOT.some((s) => /arbitrarily move Treasury assets/i.test(s)),
    );
    assert.ok(
      !STAGE12_MAY_NOT.some((s) => /amount other than 1/i.test(s)),
      "stale fixed-amount-1 ban must not remain",
    );
    assert.ok(
      !STAGE12_MAY_NOT.some((s) =>
        /live model originate transfer_fenn effects \(P1A is operator-controlled only\)/i.test(
          s,
        ),
      ),
      "stale operator-only originate ban must not remain",
    );
  });
});
