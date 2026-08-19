/**
 * P2D — fenn.token.identity factual acceptance (no model, no prose snapshots).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getFennCanonDocument,
  listFennCanonDocuments,
} from "@/content/canon";

const RETRIEVAL_ACCEPTANCE: readonly {
  query: string;
  facts: readonly RegExp[];
}[] = [
  {
    query: "What is $VELL?",
    facts: [
      /\$VELL is the on-chain token/i,
      /Robinhood Chain/i,
      /ERC-20/i,
      /1,000,000,000/,
    ],
  },
  {
    query: "What chain is VELL on?",
    facts: [/Robinhood Chain/i, /4663/],
  },
  {
    query: "How many VELL exist?",
    facts: [/1,000,000,000/, /Total supply/i],
  },
  {
    query: "How many decimals does VELL have?",
    facts: [/Decimals:\s*18/i],
  },
  {
    query: "Is LEAF the same as VELL?",
    facts: [
      /LEAF is not/i,
      /not an ERC-20/i,
      /does not mean owning \$VELL/i,
    ],
  },
  {
    query: "Can I swap my LEAF for VELL?",
    facts: [/not automatically convertible|redeemable for \$VELL/i],
  },
  {
    query: "Where was VELL launched?",
    facts: [
      /through PONS/i,
      /launchpad/i,
      /Robinhood Chain/i,
    ],
  },
  {
    query: "Did you launch through PONS?",
    facts: [
      /entered Robinhood Chain through PONS/i,
      /First-person speech is allowed when grounded/i,
    ],
  },
  {
    query: "Does PONS control VELL?",
    facts: [
      /not VELL's owner/i,
      /does not gain ongoing economic authority/i,
      /not the Treasury/i,
      /does not become the Purse/i,
    ],
  },
  {
    query: "Is PONS your Treasury?",
    facts: [/PONS is not the Treasury/i],
  },
  {
    query: "What is the Purse?",
    facts: [
      /finite body of \$VELL/i,
      /not the Treasury/i,
      /10,000,000/,
      /one percent/i,
      /not a permanent Purse balance/i,
    ],
  },
  {
    query: "What is the VELL contract?",
    facts: [
      /does not include the official contract address/i,
      /trusted live state/i,
      /do not invent an address/i,
      /do not substitute Purse or Treasury/i,
    ],
  },
  {
    query: "Has VELL launched?",
    facts: [
      /does not by itself mean the official live contract is configured/i,
      /trusted live state/i,
    ],
  },
];

describe("P2D fenn.token.identity canon sheet", () => {
  it("is public, registered, and listed", () => {
    const doc = getFennCanonDocument("fenn.token.identity");
    assert.ok(doc);
    assert.equal(doc.visibility, "public");
    assert.equal(doc.title, "$VELL");
    assert.ok(listFennCanonDocuments().some((d) => d.key === "fenn.token.identity"));
  });

  it("supports acceptance queries by factual presence", () => {
    const doc = getFennCanonDocument("fenn.token.identity")!;
    for (const row of RETRIEVAL_ACCEPTANCE) {
      for (const fact of row.facts) {
        assert.match(
          doc.content,
          fact,
          `query="${row.query}" missing ${fact}`,
        );
      }
    }
  });

  it("never hardcodes official contract address", () => {
    const doc = getFennCanonDocument("fenn.token.identity")!;
    assert.doesNotMatch(doc.content, /0x[a-fA-F0-9]{40}/);
    for (const d of listFennCanonDocuments()) {
      assert.doesNotMatch(d.content, /0x[a-fA-F0-9]{40}/);
    }
  });

  it("does not invent market data or LEAF conversion", () => {
    const doc = getFennCanonDocument("fenn.token.identity")!;
    assert.match(doc.content, /Do not invent price/i);
    assert.doesNotMatch(doc.content, /LEAF\s*→\s*\$VELL|swap LEAF for \$VELL at/i);
  });
});
