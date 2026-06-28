import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import {
  encodeAbiParameters,
  keccak256,
  parseEther,
  toHex,
  type Address,
  type Hex,
  type WalletClient,
  type PublicClient,
} from "viem";

/**
 * Commit-reveal lifecycle tests for AIJudge.
 *
 * Time is manipulated deterministically with networkHelpers.time so the commit
 * and reveal phases can be entered on demand. The Ritual LLM precompile (0x0802)
 * is mocked by copying MockLLMPrecompile's runtime bytecode to that address.
 */

const LLM_PRECOMPILE: Address = "0x0000000000000000000000000000000000000802";
const ZERO_BYTES32: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const { viem, networkHelpers } = await network.connect();
const publicClient = (await viem.getPublicClient()) as unknown as PublicClient;
const walletClients = (await viem.getWalletClients()) as unknown as WalletClient[];

const owner = walletClients[0];
const alice = walletClients[1];
const bob = walletClients[2];
const carol = walletClients[3];

const ownerAddr = owner.account!.address;
const aliceAddr = alice.account!.address;
const bobAddr = bob.account!.address;
const carolAddr = carol.account!.address;

// Deployed once to grab its ABI; redeployed fresh per test.
let abi: readonly unknown[];

/** keccak256(abi.encode(answer, salt, sender, bountyId)) — matches the contract. */
function computeCommitment(
  answer: string,
  salt: Hex,
  sender: Address,
  bountyId: bigint,
): Hex {
  const encoded = encodeAbiParameters(
    [{ type: "string" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }],
    [answer, salt, sender, bountyId],
  );
  return keccak256(encoded);
}

function randomSalt(seed: number): Hex {
  return toHex(BigInt(seed) * 1_000_003n + 7n, { size: 32 });
}

async function deployFresh(): Promise<Address> {
  const c = await viem.deployContract("AIJudge");
  abi = c.abi as readonly unknown[];

  // Install the mock LLM precompile at 0x0802.
  const mock = await viem.deployContract("MockLLMPrecompile");
  const code = await publicClient.getCode({ address: mock.address });
  assert.ok(code && code !== "0x", "mock runtime code present");
  await networkHelpers.setCode(LLM_PRECOMPILE, code as Hex);

  return c.address;
}

async function write(
  address: Address,
  client: WalletClient,
  functionName: string,
  args: readonly unknown[],
  value?: bigint,
): Promise<Hex> {
  const hash = await client.writeContract({
    address,
    abi,
    functionName,
    args,
    value,
    account: client.account!,
    chain: null,
  } as never);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function expectRevert(
  address: Address,
  client: WalletClient,
  functionName: string,
  args: readonly unknown[],
  expected: string,
  value?: bigint,
): Promise<void> {
  try {
    await publicClient.simulateContract({
      address,
      abi,
      functionName,
      args,
      value,
      account: client.account!,
    } as never);
    assert.fail(`Expected revert "${expected}" but call succeeded`);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    assert.ok(
      msg.includes(expected),
      `Expected revert containing "${expected}", got:\n${msg}`,
    );
  }
}

async function read(address: Address, functionName: string, args: readonly unknown[] = []) {
  return publicClient.readContract({ address, abi, functionName, args } as never);
}

type BountyView = {
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

async function getBounty(address: Address, bountyId: bigint): Promise<BountyView> {
  return (await read(address, "getBounty", [bountyId])) as BountyView;
}

/** Create a bounty and return its id, plus the two phase deadlines used. */
async function createBounty(
  address: Address,
  opts?: { reward?: bigint; commitOffset?: number; revealOffset?: number },
): Promise<{ bountyId: bigint; commitDeadline: bigint; revealDeadline: bigint }> {
  const now = await networkHelpers.time.latest();
  const commitDeadline = BigInt(now + (opts?.commitOffset ?? 1000));
  const revealDeadline = BigInt(now + (opts?.revealOffset ?? 2000));
  const reward = opts?.reward ?? parseEther("1");

  await write(
    address,
    owner,
    "createBounty",
    ["Test bounty", "Correctness 100%", commitDeadline, revealDeadline],
    reward,
  );
  return { bountyId: 1n, commitDeadline, revealDeadline };
}

const LLM_INPUT: Hex = "0x1234"; // arbitrary non-empty payload for the mock

describe("AIJudge — commit-reveal lifecycle", () => {
  before(async () => {
    // Populate the ABI for the helpers.
    await deployFresh();
  });

  // ---- Bounty creation ----

  it("creates a bounty with valid deadlines", async () => {
    const address = await deployFresh();
    const { bountyId } = await createBounty(address);
    const b = await getBounty(address, bountyId);
    assert.equal(b.owner.toLowerCase(), ownerAddr.toLowerCase());
    assert.equal(b.reward, parseEther("1"));
    assert.equal(b.judged, false);
    assert.equal(b.finalized, false);
    assert.equal(b.submissionCount, 0n);
  });

  it("rejects an invalid commit deadline (in the past)", async () => {
    const address = await deployFresh();
    const now = await networkHelpers.time.latest();
    await expectRevert(
      address,
      owner,
      "createBounty",
      ["t", "r", BigInt(now - 10), BigInt(now + 1000)],
      "InvalidCommitDeadline",
      parseEther("1"),
    );
  });

  it("rejects reveal deadline before commit deadline", async () => {
    const address = await deployFresh();
    const now = await networkHelpers.time.latest();
    await expectRevert(
      address,
      owner,
      "createBounty",
      ["t", "r", BigInt(now + 2000), BigInt(now + 1000)],
      "InvalidRevealDeadline",
      parseEther("1"),
    );
  });

  it("rejects a bounty with no reward", async () => {
    const address = await deployFresh();
    const now = await networkHelpers.time.latest();
    await expectRevert(
      address,
      owner,
      "createBounty",
      ["t", "r", BigInt(now + 1000), BigInt(now + 2000)],
      "RewardRequired",
      0n,
    );
  });

  // ---- Commitment phase ----

  it("accepts a valid commitment", async () => {
    const address = await deployFresh();
    const { bountyId } = await createBounty(address);
    const salt = randomSalt(1);
    const commitment = computeCommitment("answer-a", salt, aliceAddr, bountyId);
    await write(address, alice, "submitCommitment", [bountyId, commitment]);

    const b = await getBounty(address, bountyId);
    assert.equal(b.submissionCount, 1n);
    const sub = (await read(address, "getSubmission", [bountyId, 0n])) as [
      Address,
      Hex,
      string,
      boolean,
    ];
    assert.equal(sub[0].toLowerCase(), aliceAddr.toLowerCase());
    assert.equal(sub[1], commitment);
  });

  it("stores NO plaintext answer during the commitment phase", async () => {
    const address = await deployFresh();
    const { bountyId } = await createBounty(address);
    const salt = randomSalt(2);
    const commitment = computeCommitment("secret-answer", salt, aliceAddr, bountyId);
    await write(address, alice, "submitCommitment", [bountyId, commitment]);

    const sub = (await read(address, "getSubmission", [bountyId, 0n])) as [
      Address,
      Hex,
      string,
      boolean,
    ];
    assert.equal(sub[2], "", "answer must be empty before reveal");
    assert.equal(sub[3], false, "revealed flag must be false");
  });

  it("rejects a zero commitment", async () => {
    const address = await deployFresh();
    const { bountyId } = await createBounty(address);
    await expectRevert(
      address,
      alice,
      "submitCommitment",
      [bountyId, ZERO_BYTES32],
      "ZeroCommitment",
    );
  });

  it("rejects a duplicate commitment from the same wallet", async () => {
    const address = await deployFresh();
    const { bountyId } = await createBounty(address);
    const c1 = computeCommitment("a1", randomSalt(3), aliceAddr, bountyId);
    await write(address, alice, "submitCommitment", [bountyId, c1]);
    const c2 = computeCommitment("a2", randomSalt(4), aliceAddr, bountyId);
    await expectRevert(
      address,
      alice,
      "submitCommitment",
      [bountyId, c2],
      "DuplicateCommitment",
    );
  });

  it("rejects a commitment after the commit deadline", async () => {
    const address = await deployFresh();
    const { bountyId, commitDeadline } = await createBounty(address);
    await networkHelpers.time.increaseTo(commitDeadline);
    const c = computeCommitment("late", randomSalt(5), aliceAddr, bountyId);
    await expectRevert(
      address,
      alice,
      "submitCommitment",
      [bountyId, c],
      "CommitmentClosed",
    );
  });

  it("rejects a commitment on an invalid bounty id", async () => {
    const address = await deployFresh();
    await createBounty(address);
    const c = computeCommitment("x", randomSalt(6), aliceAddr, 999n);
    await expectRevert(
      address,
      alice,
      "submitCommitment",
      [999n, c],
      "BountyNotFound",
    );
  });

  // ---- Reveal phase ----

  it("rejects a reveal before the commit deadline", async () => {
    const address = await deployFresh();
    const { bountyId } = await createBounty(address);
    const salt = randomSalt(7);
    const commitment = computeCommitment("ans", salt, aliceAddr, bountyId);
    await write(address, alice, "submitCommitment", [bountyId, commitment]);
    await expectRevert(
      address,
      alice,
      "revealAnswer",
      [bountyId, "ans", salt],
      "RevealNotOpen",
    );
  });

  it("reveals a valid answer + salt successfully", async () => {
    const address = await deployFresh();
    const { bountyId, commitDeadline } = await createBounty(address);
    const salt = randomSalt(8);
    const commitment = computeCommitment("the-answer", salt, aliceAddr, bountyId);
    await write(address, alice, "submitCommitment", [bountyId, commitment]);

    await networkHelpers.time.increaseTo(commitDeadline + 1n);
    await write(address, alice, "revealAnswer", [bountyId, "the-answer", salt]);

    const sub = (await read(address, "getSubmission", [bountyId, 0n])) as [
      Address,
      Hex,
      string,
      boolean,
    ];
    assert.equal(sub[2], "the-answer");
    assert.equal(sub[3], true);
  });

  it("rejects a reveal with the wrong answer", async () => {
    const address = await deployFresh();
    const { bountyId, commitDeadline } = await createBounty(address);
    const salt = randomSalt(9);
    const commitment = computeCommitment("right", salt, aliceAddr, bountyId);
    await write(address, alice, "submitCommitment", [bountyId, commitment]);
    await networkHelpers.time.increaseTo(commitDeadline + 1n);
    await expectRevert(
      address,
      alice,
      "revealAnswer",
      [bountyId, "wrong", salt],
      "CommitmentMismatch",
    );
  });

  it("rejects a reveal with the wrong salt", async () => {
    const address = await deployFresh();
    const { bountyId, commitDeadline } = await createBounty(address);
    const salt = randomSalt(10);
    const commitment = computeCommitment("ans", salt, aliceAddr, bountyId);
    await write(address, alice, "submitCommitment", [bountyId, commitment]);
    await networkHelpers.time.increaseTo(commitDeadline + 1n);
    await expectRevert(
      address,
      alice,
      "revealAnswer",
      [bountyId, "ans", randomSalt(999)],
      "CommitmentMismatch",
    );
  });

  it("rejects a reveal from a different wallet", async () => {
    const address = await deployFresh();
    const { bountyId, commitDeadline } = await createBounty(address);
    const salt = randomSalt(11);
    // Commitment is bound to alice.
    const commitment = computeCommitment("ans", salt, aliceAddr, bountyId);
    await write(address, alice, "submitCommitment", [bountyId, commitment]);
    await networkHelpers.time.increaseTo(commitDeadline + 1n);
    // Bob has no commitment at all -> NoCommitment.
    await expectRevert(
      address,
      bob,
      "revealAnswer",
      [bountyId, "ans", salt],
      "NoCommitment",
    );
  });

  it("produces a different commitment for a different bounty id", async () => {
    const salt = randomSalt(12);
    const c1 = computeCommitment("ans", salt, aliceAddr, 1n);
    const c2 = computeCommitment("ans", salt, aliceAddr, 2n);
    assert.notEqual(c1, c2);
  });

  it("rejects a double reveal", async () => {
    const address = await deployFresh();
    const { bountyId, commitDeadline } = await createBounty(address);
    const salt = randomSalt(13);
    const commitment = computeCommitment("ans", salt, aliceAddr, bountyId);
    await write(address, alice, "submitCommitment", [bountyId, commitment]);
    await networkHelpers.time.increaseTo(commitDeadline + 1n);
    await write(address, alice, "revealAnswer", [bountyId, "ans", salt]);
    await expectRevert(
      address,
      alice,
      "revealAnswer",
      [bountyId, "ans", salt],
      "AlreadyRevealed",
    );
  });

  it("rejects an empty answer at reveal", async () => {
    const address = await deployFresh();
    const { bountyId, commitDeadline } = await createBounty(address);
    const salt = randomSalt(14);
    // Commit to the empty string so the only failing check is EmptyAnswer.
    const commitment = computeCommitment("", salt, aliceAddr, bountyId);
    await write(address, alice, "submitCommitment", [bountyId, commitment]);
    await networkHelpers.time.increaseTo(commitDeadline + 1n);
    await expectRevert(
      address,
      alice,
      "revealAnswer",
      [bountyId, "", salt],
      "EmptyAnswer",
    );
  });

  it("rejects an oversized answer at reveal", async () => {
    const address = await deployFresh();
    const { bountyId, commitDeadline } = await createBounty(address);
    const salt = randomSalt(15);
    const big = "x".repeat(2001);
    const commitment = computeCommitment(big, salt, aliceAddr, bountyId);
    await write(address, alice, "submitCommitment", [bountyId, commitment]);
    await networkHelpers.time.increaseTo(commitDeadline + 1n);
    await expectRevert(
      address,
      alice,
      "revealAnswer",
      [bountyId, big, salt],
      "AnswerTooLong",
    );
  });

  it("rejects a reveal after the reveal deadline", async () => {
    const address = await deployFresh();
    const { bountyId, revealDeadline } = await createBounty(address);
    const salt = randomSalt(16);
    const commitment = computeCommitment("ans", salt, aliceAddr, bountyId);
    await write(address, alice, "submitCommitment", [bountyId, commitment]);
    await networkHelpers.time.increaseTo(revealDeadline);
    await expectRevert(
      address,
      alice,
      "revealAnswer",
      [bountyId, "ans", salt],
      "RevealClosed",
    );
  });

  // ---- Judging ----

  it("rejects judging before the reveal deadline", async () => {
    const address = await deployFresh();
    const { bountyId, commitDeadline } = await createBounty(address);
    const salt = randomSalt(17);
    const commitment = computeCommitment("ans", salt, aliceAddr, bountyId);
    await write(address, alice, "submitCommitment", [bountyId, commitment]);
    await networkHelpers.time.increaseTo(commitDeadline + 1n);
    await write(address, alice, "revealAnswer", [bountyId, "ans", salt]);
    await expectRevert(
      address,
      owner,
      "judgeAll",
      [bountyId, LLM_INPUT],
      "RevealNotEnded",
    );
  });

  it("rejects judging with zero valid reveals", async () => {
    const address = await deployFresh();
    const { bountyId, revealDeadline } = await createBounty(address);
    const salt = randomSalt(18);
    const commitment = computeCommitment("ans", salt, aliceAddr, bountyId);
    await write(address, alice, "submitCommitment", [bountyId, commitment]);
    // Never reveal.
    await networkHelpers.time.increaseTo(revealDeadline + 1n);
    await expectRevert(
      address,
      owner,
      "judgeAll",
      [bountyId, LLM_INPUT],
      "NoRevealedSubmissions",
    );
  });

  it("excludes unrevealed submissions and judges only revealed ones in one batch", async () => {
    const address = await deployFresh();
    const { bountyId, commitDeadline, revealDeadline } = await createBounty(address);

    const saltA = randomSalt(19);
    const saltB = randomSalt(20);
    const saltC = randomSalt(21);
    await write(address, alice, "submitCommitment", [
      bountyId,
      computeCommitment("answer-A", saltA, aliceAddr, bountyId),
    ]);
    await write(address, bob, "submitCommitment", [
      bountyId,
      computeCommitment("answer-B", saltB, bobAddr, bountyId),
    ]);
    await write(address, carol, "submitCommitment", [
      bountyId,
      computeCommitment("answer-C", saltC, carolAddr, bountyId),
    ]);

    await networkHelpers.time.increaseTo(commitDeadline + 1n);
    // Only alice and carol reveal; bob stays hidden.
    await write(address, alice, "revealAnswer", [bountyId, "answer-A", saltA]);
    await write(address, carol, "revealAnswer", [bountyId, "answer-C", saltC]);

    await networkHelpers.time.increaseTo(revealDeadline + 1n);
    await write(address, owner, "judgeAll", [bountyId, LLM_INPUT]);

    const b = await getBounty(address, bountyId);
    assert.equal(b.judged, true);
    assert.notEqual(b.batchHash, ZERO_BYTES32);

    // bob's submission stays unrevealed.
    const bobSub = (await read(address, "getSubmission", [bountyId, 1n])) as [
      Address,
      Hex,
      string,
      boolean,
    ];
    assert.equal(bobSub[3], false);
    assert.equal(bobSub[2], "");
  });

  it("rejects judging by a non-owner (access control)", async () => {
    const address = await deployFresh();
    const { bountyId, commitDeadline, revealDeadline } = await createBounty(address);
    const salt = randomSalt(22);
    await write(address, alice, "submitCommitment", [
      bountyId,
      computeCommitment("ans", salt, aliceAddr, bountyId),
    ]);
    await networkHelpers.time.increaseTo(commitDeadline + 1n);
    await write(address, alice, "revealAnswer", [bountyId, "ans", salt]);
    await networkHelpers.time.increaseTo(revealDeadline + 1n);
    await expectRevert(
      address,
      alice,
      "judgeAll",
      [bountyId, LLM_INPUT],
      "NotBountyOwner",
    );
  });

  it("rejects a second judging", async () => {
    const address = await deployFresh();
    const { bountyId, commitDeadline, revealDeadline } = await createBounty(address);
    const salt = randomSalt(23);
    await write(address, alice, "submitCommitment", [
      bountyId,
      computeCommitment("ans", salt, aliceAddr, bountyId),
    ]);
    await networkHelpers.time.increaseTo(commitDeadline + 1n);
    await write(address, alice, "revealAnswer", [bountyId, "ans", salt]);
    await networkHelpers.time.increaseTo(revealDeadline + 1n);
    await write(address, owner, "judgeAll", [bountyId, LLM_INPUT]);
    await expectRevert(
      address,
      owner,
      "judgeAll",
      [bountyId, LLM_INPUT],
      "AlreadyJudged",
    );
  });

  // ---- Finalization ----

  async function setupJudged(address: Address) {
    const { bountyId, commitDeadline, revealDeadline } = await createBounty(address);
    const saltA = randomSalt(30);
    const saltB = randomSalt(31);
    await write(address, alice, "submitCommitment", [
      bountyId,
      computeCommitment("answer-A", saltA, aliceAddr, bountyId),
    ]);
    await write(address, bob, "submitCommitment", [
      bountyId,
      computeCommitment("answer-B", saltB, bobAddr, bountyId),
    ]);
    await networkHelpers.time.increaseTo(commitDeadline + 1n);
    await write(address, alice, "revealAnswer", [bountyId, "answer-A", saltA]);
    // bob never reveals -> index 1 is unrevealed.
    await networkHelpers.time.increaseTo(revealDeadline + 1n);
    await write(address, owner, "judgeAll", [bountyId, LLM_INPUT]);
    return { bountyId };
  }

  it("rejects an invalid winner index", async () => {
    const address = await deployFresh();
    const { bountyId } = await setupJudged(address);
    await expectRevert(
      address,
      owner,
      "finalizeWinner",
      [bountyId, 99n],
      "InvalidWinnerIndex",
    );
  });

  it("rejects finalizing an unrevealed submission as winner", async () => {
    const address = await deployFresh();
    const { bountyId } = await setupJudged(address);
    // index 1 = bob, who never revealed.
    await expectRevert(
      address,
      owner,
      "finalizeWinner",
      [bountyId, 1n],
      "WinnerNotRevealed",
    );
  });

  it("pays the reward to the winner", async () => {
    const address = await deployFresh();
    const { bountyId } = await setupJudged(address);

    const before = await publicClient.getBalance({ address: aliceAddr });
    await write(address, owner, "finalizeWinner", [bountyId, 0n]);
    const after = await publicClient.getBalance({ address: aliceAddr });

    assert.equal(after - before, parseEther("1"));
    const b = await getBounty(address, bountyId);
    assert.equal(b.finalized, true);
    assert.equal(b.winnerIndex, 0n);
    assert.equal(b.reward, 0n);
  });

  it("cannot pay the reward twice / rejects a second finalization", async () => {
    const address = await deployFresh();
    const { bountyId } = await setupJudged(address);
    await write(address, owner, "finalizeWinner", [bountyId, 0n]);
    await expectRevert(
      address,
      owner,
      "finalizeWinner",
      [bountyId, 0n],
      "AlreadyFinalized",
    );
  });

  it("rejects finalization before judging", async () => {
    const address = await deployFresh();
    const { bountyId, commitDeadline, revealDeadline } = await createBounty(address);
    const salt = randomSalt(40);
    await write(address, alice, "submitCommitment", [
      bountyId,
      computeCommitment("ans", salt, aliceAddr, bountyId),
    ]);
    await networkHelpers.time.increaseTo(commitDeadline + 1n);
    await write(address, alice, "revealAnswer", [bountyId, "ans", salt]);
    await networkHelpers.time.increaseTo(revealDeadline + 1n);
    await expectRevert(
      address,
      owner,
      "finalizeWinner",
      [bountyId, 0n],
      "NotJudged",
    );
  });

  it("rejects finalization by a non-owner (access control)", async () => {
    const address = await deployFresh();
    const { bountyId } = await setupJudged(address);
    await expectRevert(
      address,
      alice,
      "finalizeWinner",
      [bountyId, 0n],
      "NotBountyOwner",
    );
  });
});
