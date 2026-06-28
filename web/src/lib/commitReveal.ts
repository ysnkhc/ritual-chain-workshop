import {
  encodeAbiParameters,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";

/**
 * ============================================================================
 *  Commit-reveal helpers (browser side)
 * ============================================================================
 *
 * The contract verifies, at reveal time:
 *
 *   keccak256(abi.encode(answer, salt, msg.sender, bountyId))
 *
 * We MUST reproduce that exact ABI encoding here — never a manually
 * concatenated string — so the commitment computed in the browser matches the
 * one the contract recomputes on-chain.
 */

/** Generate a cryptographically-random 32-byte salt using the Web Crypto API. */
export function generateSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/**
 * Compute the commitment exactly like the contract:
 * keccak256(abi.encode(answer, salt, account, bountyId)).
 */
export function computeCommitment(params: {
  answer: string;
  salt: Hex;
  account: Address;
  bountyId: bigint;
}): Hex {
  const encoded = encodeAbiParameters(
    [
      { type: "string" },
      { type: "bytes32" },
      { type: "address" },
      { type: "uint256" },
    ],
    [params.answer, params.salt, params.account, params.bountyId],
  );
  return keccak256(encoded);
}

// ---- Local reveal-secret persistence (workshop demo only) ----

export type RevealSecret = {
  bountyId: string;
  account: Address;
  answer: string;
  salt: Hex;
  commitment: Hex;
};

const STORAGE_PREFIX = "aijudge:reveal";

/** Fired in-tab after save/clear, since the native `storage` event does not. */
export const REVEAL_CHANGED_EVENT = "aijudge:reveal-changed";

function notifyRevealChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(REVEAL_CHANGED_EVENT));
}

export function revealStorageKey(bountyId: bigint, account: Address): string {
  return `${STORAGE_PREFIX}:${bountyId.toString()}:${account.toLowerCase()}`;
}

function storageKey(bountyId: bigint, account: Address): string {
  return revealStorageKey(bountyId, account);
}

/**
 * Persist a reveal secret in localStorage.
 *
 * ⚠️ Workshop demo only. localStorage is not secure storage. If the user loses
 * this data (cleared storage, different browser/device) they CANNOT reveal and
 * their submission becomes ineligible.
 */
export function saveRevealSecret(secret: RevealSecret): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    storageKey(BigInt(secret.bountyId), secret.account),
    JSON.stringify(secret),
  );
  notifyRevealChanged();
}

export function loadRevealSecret(
  bountyId: bigint,
  account?: Address,
): RevealSecret | null {
  if (typeof window === "undefined" || !account) return null;
  const raw = window.localStorage.getItem(storageKey(bountyId, account));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RevealSecret;
  } catch {
    return null;
  }
}

export function clearRevealSecret(bountyId: bigint, account?: Address): void {
  if (typeof window === "undefined" || !account) return;
  window.localStorage.removeItem(storageKey(bountyId, account));
  notifyRevealChanged();
}
