import type { Address, Hex } from "viem";

/** Parsed shape of the `getBounty` BountyView struct return value. */
export type Bounty = {
  owner: Address;
  title: string;
  rubric: string;
  reward: bigint;
  commitDeadline: bigint;
  revealDeadline: bigint;
  judged: boolean;
  finalized: boolean;
  submissionCount: bigint;
  winnerIndex: bigint;
  aiReview: Hex;
  batchHash: Hex;
};

/** getBounty returns a BountyView struct — viem decodes it to a named object. */
export function parseBounty(raw: Bounty): Bounty {
  return {
    owner: raw.owner,
    title: raw.title,
    rubric: raw.rubric,
    reward: raw.reward,
    commitDeadline: raw.commitDeadline,
    revealDeadline: raw.revealDeadline,
    judged: raw.judged,
    finalized: raw.finalized,
    submissionCount: raw.submissionCount,
    winnerIndex: raw.winnerIndex,
    aiReview: raw.aiReview,
    batchHash: raw.batchHash,
  };
}

/**
 * Lifecycle phases, derived from the two deadlines + judged/finalized flags:
 *   commit   -> commitment phase open (now < commitDeadline)
 *   reveal   -> reveal phase open (commitDeadline <= now < revealDeadline)
 *   judging  -> reveal closed, awaiting batch AI judging
 *   judged   -> AI review stored, awaiting finalization
 *   finalized
 */
export type BountyStatus =
  | "commit"
  | "reveal"
  | "judging"
  | "judged"
  | "finalized";

export function getBountyStatus(
  b: Bounty,
  nowSeconds = Date.now() / 1000,
): BountyStatus {
  if (b.finalized) return "finalized";
  if (b.judged) return "judged";
  if (nowSeconds < Number(b.commitDeadline)) return "commit";
  if (nowSeconds < Number(b.revealDeadline)) return "reveal";
  return "judging";
}

export const STATUS_META: Record<
  BountyStatus,
  { label: string; tone: "green" | "amber" | "indigo" | "zinc" }
> = {
  commit: { label: "Commitment open", tone: "green" },
  reveal: { label: "Reveal open", tone: "amber" },
  judging: { label: "Waiting for judging", tone: "amber" },
  judged: { label: "Judged", tone: "indigo" },
  finalized: { label: "Finalized", tone: "zinc" },
};

/** Can a participant still submit a commitment? */
export function canCommit(b: Bounty, nowSeconds = Date.now() / 1000): boolean {
  return (
    !b.judged && !b.finalized && Number(b.commitDeadline) > nowSeconds
  );
}

/** Is the reveal window currently open? */
export function canReveal(b: Bounty, nowSeconds = Date.now() / 1000): boolean {
  return (
    !b.judged &&
    !b.finalized &&
    Number(b.commitDeadline) <= nowSeconds &&
    Number(b.revealDeadline) > nowSeconds
  );
}

/** Has the reveal window closed (so judging is allowed)? */
export function canJudge(b: Bounty, nowSeconds = Date.now() / 1000): boolean {
  return !b.judged && !b.finalized && Number(b.revealDeadline) <= nowSeconds;
}
