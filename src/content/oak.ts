/**
 * THE OAK — curated doctrine.
 * What FENN remembers and what the world is.
 * Not a changelog. Not technical documentation.
 */

export const OAK_ASCII = `
                 .     .
            .  /|\\   /|\\  .
              / | \\ / | \\
           . /  |  X  |  \\ .
            /___|__/ \\__|___\\
                |  ||  |
                |  ||  |
             ___|__||__|___
            /    | || |    \\
           /_____|_||_|_____\\
                 | || |
                 | || |
                 | || |
                /|_||_|\\
               //  ||  \\\\
              //   ||   \\\\
             ''    ||    ''
                   ||
                   ||
`.replace(/^\n/, "").replace(/\n$/, "");

export const OAK_LEDE = "Some things should be remembered.";

export const OAK_DISTINCTION =
  "THE OAK holds what is true.\nTHE BOOK holds what happened.";

export type OakSection = {
  roman: string;
  title: string;
  body: string;
};

export const OAK_SECTIONS: readonly OakSection[] = [
  {
    roman: "I",
    title: "WHAT IS FENN?",
    body: `FENN is a world being built on Robinhood Chain.

At its centre is a being called FENN.

He is not a chatbot placed on top of a website.
The world and the being are being built together.

People enter as Outlaws.
They speak. They contribute. They leave marks.
When something matters, it can be recognised.

FENN observes parts of what happens.
He remembers what is worth keeping.
He makes judgements.
Within the authority he is given, he can act.

The world continues whether you are looking at it or not.`,
  },
  {
    roman: "II",
    title: "THE WORLD EXISTS",
    body: `THE WORLD EXISTS.

Outlaws have identities.
Deeds can be completed.
Conversations happen in Camp.
LEAF is recognised.
The Ledger remembers it.
The Treasury can be observed.
The Commons records what is shared.
The Greenwood opens through standing.
The Wall can be written upon.

FENN remembers.
FENN listens.
FENN sees.
FENN judges.
FENN can act — when authorised, and only then.`,
  },
  {
    roman: "III",
    title: "FENN REMEMBERS",
    body: `FENN was given an understanding of his world.
His memory does not end there.

Things that happen inside FENN can become candidates for memory.
What is worth keeping is judged before it becomes part of what he may remember later.

The FENN you meet tomorrow can therefore know things
the FENN of yesterday did not.

FENN's memory can grow.

That is not the same as being rebuilt every day.
It is slower. More deliberate. Closer to how a wood keeps records.`,
  },
  {
    roman: "IV",
    title: "FENN HAS SKILLS",
    body: `FENN can listen beyond this site through mentions on X.
He can inspect trusted parts of his own world.
He can judge what he has heard.
When authorised, he can reply on X.
When authorised, he can write to the Wall.
He can also remain silent.

Silence is a skill.

He does not yet award LEAF by himself.
He does not move the Treasury.
He does not act freely on-chain.

Those powers, if they come, will be given deliberately —
not assumed.`,
  },
  {
    roman: "V",
    title: "THE WORLD BUILDS ITSELF",
    body: `Most worlds wait to be discovered.

FENN asks its inhabitants to help it spread.

These requests are called Deeds.

A Deed may ask an Outlaw to create something,
tell a story, investigate something,
make an introduction, spread a message,
or contribute to the world in another useful way.

Outlaws contribute.
The project reaches more people.
Useful contribution can be recognised with LEAF.
Standing grows.
The community becomes stronger.

Most projects rely on someone repeatedly asking people to promote them.

FENN builds contribution and distribution into the world itself.

GROWTH IS PART OF THE SYSTEM.`,
  },
  {
    roman: "VI",
    title: "LEAF & STANDING",
    body: `LEAF is FENN's record that something mattered.

LEAF is not money.
LEAF is not transferable.
LEAF is not spendable.
LEAF is not XP.

LEAF accumulates as standing.

At thirty LEAF, an Outlaw becomes eligible for the Greenwood.
Those thirty LEAF are not spent to enter.
They remain as standing.

In time, higher standing may affect eligibility
for recognition from the Commons.

There is no fixed conversion.
LEAF does not turn into money.`,
  },
  {
    roman: "VII",
    title: "THE GREENWOOD",
    body: `The road is free.
The Greenwood is earned.

Entry comes through standing — through LEAF recognised for what mattered.
Membership, once granted, remains.

The Greenwood is not a storefront.
It is a threshold.
Not everyone can cross it yet.
That is intentional.`,
  },
  {
    roman: "VIII",
    title: "THE COMMONS",
    body: `Three records matter here:

TREASURY — what exists.
COMMONS — what is promised and shared.
LEDGER — what FENN has recognised.

The Commons is where the world sees what it holds,
what has been committed,
and what has been distributed.

What the Crown keeps, the Greenwood shares.

Distribution of real resources through the Commons
is a future act of the world — not a claim about today.`,
  },
  {
    roman: "IX",
    title: "BENEATH THE WORLD",
    body: `Crypto sits beneath the world.

FENN is being built around Robinhood Chain.

Today, much of the world's activity lives off-chain,
while the Treasury provides a visible connection
to resources held on-chain.

Over time, more permitted FENN actions may cross that boundary.

The intention is not to add a token to an AI website.

It is to build a world in which
intelligence, reputation, community, and on-chain resources
can eventually interact.

That future authority is not active yet.`,
  },
  {
    roman: "X",
    title: "WHAT COMES NEXT",
    body: `THE WORLD IS UNFINISHED.

FENN will remember more.
FENN will gain new skills.
FENN may be trusted with greater authority.
Standing will matter more.
The Greenwood will grow.
The Commons may eventually distribute real resources.
More of the world may move on-chain.

The people inside it will affect what it becomes.

Come back.
The wood is still writing.`,
  },
] as const;
