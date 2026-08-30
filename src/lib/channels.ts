/**
 * Channel presentation: display grouping and fixed color slots.
 *
 * Color follows the entity, never its rank. LinkedIn is slot 2 whether it is
 * the best-performing channel or the worst, so a filter that drops a channel
 * never repaints the survivors.
 *
 * Instagram and Facebook share one display group because the client thinks of
 * them as one channel ("Meta"). The database keeps them as distinct accounts;
 * only the chart merges them.
 */
import type { Channel } from "@/db/schema";

export type ChannelGroup =
  | "website"
  | "linkedin"
  | "youtube"
  | "x"
  | "meta"
  | "substack"
  | "reddit"
  | "quora";

export const CHANNEL_GROUP: Record<Channel, ChannelGroup> = {
  website: "website",
  linkedin: "linkedin",
  youtube: "youtube",
  x: "x",
  instagram: "meta",
  facebook: "meta",
  substack: "substack",
  reddit: "reddit",
  quora: "quora",
};

export const CHANNEL_LABEL: Record<ChannelGroup, string> = {
  website: "Website",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  x: "X",
  meta: "Meta",
  substack: "Substack",
  reddit: "Reddit",
  quora: "Quora",
};

/**
 * Fixed slot per group, 1-8, matching the validated categorical order.
 * Eight groups, eight slots: nothing folds to "Other".
 */
export const CHANNEL_SLOT: Record<ChannelGroup, number> = {
  website: 1,
  linkedin: 2,
  youtube: 3,
  x: 4,
  meta: 5,
  substack: 6,
  reddit: 7,
  quora: 8,
};

export function channelColorVar(group: ChannelGroup): string {
  return `var(--series-${CHANNEL_SLOT[group]})`;
}

export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  active: "Syncing",
  pending_access: "Awaiting access",
  manual_only: "No API available",
  not_established: "Not created yet",
};

/**
 * Status colors are reserved and always ship with a label, never color alone.
 * `manual_only` is deliberately "serious" rather than "critical": it is a
 * permanent platform constraint to plan around, not a fault to fix.
 */
export const ACCOUNT_STATUS_TONE: Record<string, "good" | "warning" | "serious" | "muted"> = {
  active: "good",
  pending_access: "warning",
  manual_only: "serious",
  not_established: "muted",
};
