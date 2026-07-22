export type BookEntry = {
  id: string;
  title: string;
  body: string;
};

/** Static Stage 5 Book fragments grounded in FENN_MVP_SPEC.md. */
export const BOOK_ENTRIES: BookEntry[] = [
  {
    id: "crown-keeps",
    title: "what the crown keeps",
    body: `What the Crown keeps, the Greenwood shares.

A hoard is a failure of circulation.`,
  },
  {
    id: "the-road",
    title: "the road",
    body: `The Road is free.

Robinhood built the chain.
FENN found the Greenwood.
The Hood decides what happens next.`,
  },
  {
    id: "the-crown",
    title: "the crown",
    body: `The Crown is concentration.

money
knowledge
attention
access
opportunity
power

It is a concept, not a person.`,
  },
  {
    id: "the-greenwood",
    title: "the greenwood",
    body: `The Greenwood is earned.

The road is free. The Greenwood is earned.

Not everyone can enter yet.
That is intentional.`,
  },
  {
    id: "leaf",
    title: "leaf",
    body: `LEAF measures what you gave the Greenwood.
It does not promise what the Greenwood will give you back.

It is not $FENN.
It cannot be purchased here.`,
  },
  {
    id: "man-in-the-castle",
    title: "the man in the castle",
    body: `the man in the castle built a road.
he probably expected traffic.
he may not have expected us.

the wood was listening.`,
  },
  {
    id: "the-book",
    title: "the book",
    body: `pages accumulate slowly.

some entries explain.
some refuse to.

the Chronicle is not written here yet.`,
  },
];
