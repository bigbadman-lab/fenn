/**
 * Public-safe homepage Gathering signal DTO (client + server).
 * No member titles, summaries, hands, capacity, or identities.
 */

export type PublicHomeGatheringCall =
  | {
      active: true;
      state: "active";
      startsAt: string;
      endsAt: string;
      message: string;
      href: string;
      serverNow: string;
    }
  | {
      active: false;
      serverNow: string;
    };

export const PUBLIC_HOME_GATHERING_MESSAGE =
  "GATHERING CALLED AT THE GREENWOOD";

export const PUBLIC_HOME_GATHERING_HREF = "/greenwood?crossing=1";
