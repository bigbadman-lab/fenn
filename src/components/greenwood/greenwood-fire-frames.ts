/**
 * AT THE FIRE — static ASCII clearing scenes.
 * Waiting vs seated states only. No frame animation.
 */

/** Quiet, smaller fire — invitation to sit. */
export const GREENWOOD_FIRE_CLEARING_WAITING_DESKTOP = `
          .              .
      /\\                    /\\
     /  \\      .    .      /  \\
    /_/\\_\\                /_/\\_\\
              \\  |  /
               \\ | /
                \\|/
               (   )
                )_(
               /___\\
            __/_____\\__
           /___________\\
`.trim();

/** Fuller, warmer fire — place held. */
export const GREENWOOD_FIRE_CLEARING_SEATED_DESKTOP = `
          .     *        .
      /\\         .          /\\
     /  \\   .  *   *  .    /  \\
    /_/\\_\\      \\ | /     /_/\\_\\
                 \\|/
              \\  ( )  /
               \\ )_( /
                /___\\
             __/_____\\__
            /  \\_____/  \\
           /_____________\\
`.trim();

/** Compact waiting fire for narrow screens. */
export const GREENWOOD_FIRE_CLEARING_WAITING_MOBILE = `
     /\\        /\\
    /  \\  .   /  \\
   /_/\\_\\    /_/\\_\\
        \\ | /
         \\|/
        (   )
         )_(
        /___\\
     __/_____\\__
`.trim();

/** Compact seated fire for narrow screens. */
export const GREENWOOD_FIRE_CLEARING_SEATED_MOBILE = `
     /\\   *    /\\
    /  \\ .*.  /  \\
   /_/\\_\\  \\|/ /_/\\_\\
         \\( )/
          )_(
         /___\\
      __/_____\\__
     /  \\___/  \\
`.trim();

/** Low-detail mark used while the Fire is listening. */
export const GREENWOOD_FIRE_CLEARING_LISTENING = `
         |
        ( )
         ^
        /_\\
`.trim();

export const GREENWOOD_FIRE_CLEARING_WAITING_LIMIT = 6;
export const GREENWOOD_FIRE_CLEARING_WAITING_LIMIT_NARROW = 4;

export const GREENWOOD_FIRE_A11Y_WAITING =
  "A quiet campfire in a small woodland clearing. The fire waits.";

export const GREENWOOD_FIRE_A11Y_SEATED =
  "A warmer campfire in a woodland clearing. Your place by the fire is held.";

export const GREENWOOD_FIRE_A11Y_LISTENING =
  "A small fire mark while the Greenwood listens.";
