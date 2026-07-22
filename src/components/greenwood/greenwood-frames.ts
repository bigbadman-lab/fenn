export type CrossingFrameVariant =
  | "dense"
  | "sparse"
  | "center"
  | "left"
  | "right"
  | "bottom"
  | "glitch"
  | "tear"
  | "empty"
  | "final";

export type CrossingFrameMotion =
  | "none"
  | "jitter"
  | "shift-x"
  | "shift-y"
  | "scale-burst";

export type CrossingFrameAccent = "none" | "greenwood" | "leaf" | "invert";

export type CrossingFrame = {
  text: string;
  variant: CrossingFrameVariant;
  holdMs: number;
  motion: CrossingFrameMotion;
  accent: CrossingFrameAccent;
};

/** Curated chaos — fixed frames + irregular timings. No Math.random. */
export const GREENWOOD_CROSSING_FRAMES: readonly CrossingFrame[] = [
  {
    variant: "left",
    motion: "none",
    accent: "none",
    holdMs: 150,
    text: `THE ROAD ENDS HERE

/////\\\\\\\\\\/////\\\\\\\\\\/////\\\\\\\\\\
   /\\      /\\      /\\      /\\
  /  \\    /  \\    /  \\    /  \\
 /____\\  /____\\  /____\\  /____\\
 ||||||  ||||||  ||||||  ||||||`,
  },
  {
    variant: "dense",
    motion: "shift-x",
    accent: "greenwood",
    holdMs: 100,
    text: `finding the path...
\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\
////////////////////////////
\\\\\\\\  ////  \\\\\\\\  ////  \\\\\\\\
  /\\/\\/\\/\\/\\/\\/\\/\\/\\/\\/\\
 //||\\\\||//||\\\\||//||\\\\||
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
path recalculating`,
  },
  {
    variant: "center",
    motion: "jitter",
    accent: "none",
    holdMs: 170,
    text: `>>>>>>>>>>>>>>>
     WRONG TURN
<<<<<<<<<<<<<<<

        /\\
       ////\\\\
      //////\\\\\\
     ||||||||||
      \\\\\\////
        \\/`,
  },
  {
    variant: "right",
    motion: "none",
    accent: "none",
    holdMs: 120,
    text: `                    keep walking
                 · · · · · · ·
            /\\        /\\
           /||\\      /||\\
          //||\\\\    //||\\\\
         ///||\\\\\\  ///||\\\\\\
        ////||\\\\\\\\////||\\\\\\\\
                       >>>`,
  },
  {
    variant: "dense",
    motion: "scale-burst",
    accent: "leaf",
    holdMs: 210,
    text: `||||| ||||||| || |||||||||| |||||
\\\\  //////  \\\\\\\\  //////  \\\\\\\\
   >>>>>>>>>>>>>>>>>>>>>>>>>>
        /\\      /\\      /\\
   /\\  /  \\ /\\ /  \\ /\\ /  \\
  /  \\/ /\\ V  V /\\ V  \\/ /\\ \\
 /____/_/_\\____\\_/_\\____/_/_\\_\\
||||||||||||||||||||||||||||||||||||
something moved
you were seen`,
  },
  {
    variant: "sparse",
    motion: "shift-y",
    accent: "none",
    holdMs: 90,
    text: `not this way


            < < <`,
  },
  {
    variant: "glitch",
    motion: "jitter",
    accent: "invert",
    holdMs: 140,
    text: `[ SIGNAL LOST ]
|| |||    |||||||
 \\\\\\\\  //////
   >>>>>>
      /\\
  ////  \\\\\\\\
      ||
  <<<<<<
the trees are closer now`,
  },
  {
    variant: "tear",
    motion: "shift-x",
    accent: "greenwood",
    holdMs: 180,
    text: `do not look back
########################################
#  still moving          still moving  #
########################################
/////\\\\\\\\\\/////\\\\\\\\\\/////\\\\\\\\\\/////
||||  x  ||||  ?  ||||  x  ||||  ?  ||||
the wood is awake`,
  },
  {
    variant: "bottom",
    motion: "none",
    accent: "none",
    holdMs: 110,
    text: `no road found


continue anyway
||||||||||||||||||||||||||||||||
\\\\\\\\\\\\\\\\\\\\\\\\//////////////
        ················`,
  },
  {
    variant: "dense",
    motion: "jitter",
    accent: "none",
    holdMs: 230,
    text: `        /\\          /\\       /\\
   /\\  /  \\   /\\   /  \\ /\\  /  \\
  /  \\/ /\\ \\ /  \\ / /\\ V  \\/ /\\ \\
 /_____/__\\_V____V_/__\\_____/__\\_\\
 |||||||||||||||||||||||||||||||||||
 | /\\ | /\\ | /\\ | /\\ | /\\ | /\\ | /\\ |
 |/__\\|/__\\|/__\\|/__\\|/__\\|/__\\|/__\\|
the crown cannot follow
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`,
  },
  {
    variant: "left",
    motion: "shift-y",
    accent: "leaf",
    holdMs: 100,
    text: `you were seen
  ////
 ////\\\\
///  \\\\\\
||    ||
|| ?? ||
||    ||
 path?
   \\/`,
  },
  {
    variant: "center",
    motion: "scale-burst",
    accent: "none",
    holdMs: 95,
    text: `almost there

      |||||
      |||||
      |||||
       |||
        |`,
  },
  {
    variant: "dense",
    motion: "shift-x",
    accent: "greenwood",
    holdMs: 160,
    text: `/////\\\\\\\\\\/////\\\\\\\\\\/////\\\\\\\\\\/////\\\\\\
keep walking keep walking keep walking
\\\\\\\\/////\\\\\\\\/////\\\\\\\\/////\\\\\\\\/////
   /\\/\\    /\\/\\    /\\/\\    /\\/\\
  //||\\\\  //||\\\\  //||\\\\  //||\\\\
 wrong path wrong path wrong path
<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<`,
  },
  {
    variant: "glitch",
    motion: "jitter",
    accent: "invert",
    holdMs: 190,
    text: `signal lost
+--+--+--+--+--+--+--+--+
|\\\\|//|\\\\|//|\\\\|//|\\\\|//|
+--+--+--+--+--+--+--+--+
  the wood is checking
······· ····· ········
     STILL MOVING
······· ····· ········`,
  },
  {
    variant: "right",
    motion: "none",
    accent: "none",
    holdMs: 115,
    text: `                         continue anyway
                      /\\/\\/\\/\\/\\
                     <<<<<<<<<<
                      \\/\\/\\/\\/\\
                           >>>`,
  },
  {
    variant: "sparse",
    motion: "shift-y",
    accent: "none",
    holdMs: 85,
    text: `


. . .


`,
  },
  {
    variant: "empty",
    motion: "none",
    accent: "none",
    holdMs: 240,
    text: `



`,
  },
  {
    variant: "final",
    motion: "none",
    accent: "none",
    holdMs: 300,
    text: `



THE ROAD ENDS HERE.



`,
  },
] as const;

/** Sum of holdMs ≈ 2.9s */
export const GREENWOOD_CROSSING_REDUCED_MS = 700;

export const GREENWOOD_GATE_ASCII = `                         /\\
              /\\        /  \\       /\\
        /\\   /  \\   /\\ / /\\ \\  /\\ /  \\
       /  \\ / /\\ \\ /  \\  ||  /  \\ /\\ \\
      /____V_/__\\_V____\\_ || /____V__\\_\\
        ||    ||    ||    ||    ||   ||
     ||||||||||||||||||||||||||||||||||||
     |  |  |  |  |  |  |  |  |  |  |  |
     '''  '''  '''  '''  '''  '''  '''`;
