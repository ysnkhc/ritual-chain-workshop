"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import type { Address } from "viem";
import { useNow } from "@/hooks/useNow";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import { canCommit, canReveal, type Bounty } from "@/lib/bounty";
import {
  computeCommitment,
  generateSalt,
  saveRevealSecret,
  clearRevealSecret,
} from "@/lib/commitReveal";
import { useRevealSecret } from "@/hooks/useRevealSecret";
import { useWriteTx } from "@/hooks/useWriteTx";
import {
  Card,
  CardHeader,
  CardBody,
  Field,
  Textarea,
  Button,
  TxStatus,
  Notice,
} from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;

/**
 * Participant flow:
 *   commit phase  -> enter answer, generate salt, compute commitment, save the
 *                    secret locally, submit only the commitment hash.
 *   reveal phase  -> load saved secret, submit answer + salt.
 *
 * Plaintext answers never leave the browser during the commitment phase.
 */
export function CommitReveal({
  bountyId,
  bounty,
  onChanged,
}: {
  bountyId: bigint;
  bounty: Bounty;
  onChanged: () => void;
}) {
  const { address, isConnected } = useAccount();
  const now = useNow();
  const publicClient = usePublicClient({ chainId: ritualChain.id });

  const inCommit = canCommit(bounty, now / 1000);
  const inReveal = canReveal(bounty, now / 1000);

  if (!inCommit && !inReveal) return null;

  return (
    <Card>
      <CardHeader
        title={inCommit ? "Submit a commitment" : "Reveal your answer"}
        subtitle={
          inCommit
            ? "Only a hash of your answer is published now. Nobody can read it."
            : "Reveal your saved answer + salt. The contract verifies the commitment."
        }
      />
      <CardBody className="space-y-3">
        {inCommit ? (
          <CommitForm
            bountyId={bountyId}
            account={address}
            isConnected={isConnected}
            onChanged={onChanged}
          />
        ) : (
          <RevealForm
            bountyId={bountyId}
            account={address}
            isConnected={isConnected}
            publicClient={publicClient}
            onChanged={onChanged}
          />
        )}
      </CardBody>
    </Card>
  );
}

function CommitForm({
  bountyId,
  account,
  isConnected,
  onChanged,
}: {
  bountyId: bigint;
  account?: Address;
  isConnected: boolean;
  onChanged: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const existing = useRevealSecret(bountyId, account);
  const tx = useWriteTx(() => {
    setAnswer("");
    onChanged();
  });

  async function handleCommit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim() || !contractAddress || !account) return;

    // 1. Secure random salt. 2. Compute commitment with Solidity-matching ABI.
    const salt = generateSalt();
    const commitment = computeCommitment({
      answer: answer.trim(),
      salt,
      account,
      bountyId,
    });

    // 3. Persist the reveal secret locally BEFORE sending, so a confirmed
    //    commitment is never left without a recoverable answer/salt.
    saveRevealSecret({
      bountyId: bountyId.toString(),
      account,
      answer: answer.trim(),
      salt,
      commitment,
    });

    try {
      await tx.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "submitCommitment",
        args: [bountyId, commitment],
        chainId: ritualChain.id,
      });
    } catch {
      /* surfaced via tx.state */
    }
  }

  if (existing) {
    return (
      <Notice tone="green">
        Commitment already saved for this wallet. Come back during the reveal
        phase to reveal your answer.
      </Notice>
    );
  }

  return (
    <form onSubmit={handleCommit} className="space-y-3">
      <Notice tone="amber">
        Keep your reveal secret safe. If you lose the answer or salt, you cannot
        reveal your submission. It is saved in this browser&apos;s local storage
        only.
      </Notice>
      <Field label="Your answer (stays in your browser until reveal)">
        <Textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={5}
          placeholder="Write your submission…"
        />
      </Field>
      <Button
        type="submit"
        disabled={!isConnected || !answer.trim() || tx.isBusy}
        className="w-full"
      >
        {tx.isBusy ? "Committing…" : "Generate salt + submit commitment"}
      </Button>
      {!isConnected && (
        <p className="text-xs text-zinc-500">Connect your wallet to commit.</p>
      )}
      <TxStatus state={tx.state} error={tx.error} hash={tx.hash} explorerBase={explorerBase} />
    </form>
  );
}

function RevealForm({
  bountyId,
  account,
  isConnected,
  publicClient,
  onChanged,
}: {
  bountyId: bigint;
  account?: Address;
  isConnected: boolean;
  publicClient: ReturnType<typeof usePublicClient>;
  onChanged: () => void;
}) {
  const [manualAnswer, setManualAnswer] = useState("");
  const [manualSalt, setManualSalt] = useState("");
  const [alreadyRevealed, setAlreadyRevealed] = useState<boolean | null>(null);
  const tx = useWriteTx(() => onChanged());

  const stored = useRevealSecret(bountyId, account);

  // Check on-chain whether this wallet's submission is already revealed.
  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!publicClient || !contractAddress || !account) return;
      try {
        const [exists, index] = (await publicClient.readContract({
          address: contractAddress,
          abi: aiJudgeAbi,
          functionName: "getSubmissionIndex",
          args: [bountyId, account],
        })) as [boolean, bigint];
        if (!exists) {
          if (!cancelled) setAlreadyRevealed(null);
          return;
        }
        const sub = (await publicClient.readContract({
          address: contractAddress,
          abi: aiJudgeAbi,
          functionName: "getSubmission",
          args: [bountyId, index],
        })) as [Address, `0x${string}`, string, boolean];
        if (!cancelled) setAlreadyRevealed(sub[3]);
      } catch {
        if (!cancelled) setAlreadyRevealed(null);
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [bountyId, account, publicClient, tx.isConfirmed]);

  const answer = stored?.answer ?? manualAnswer;
  const salt = (stored?.salt ?? manualSalt) as `0x${string}`;

  async function handleReveal(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim() || !salt || !contractAddress) return;
    try {
      await tx.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "revealAnswer",
        args: [bountyId, answer.trim(), salt],
        chainId: ritualChain.id,
      });
      clearRevealSecret(bountyId, account);
    } catch {
      /* surfaced via tx.state */
    }
  }

  if (alreadyRevealed === true) {
    return <Notice tone="green">Your answer is already revealed and eligible for judging.</Notice>;
  }

  return (
    <form onSubmit={handleReveal} className="space-y-3">
      {stored ? (
        <Notice tone="indigo">
          Loaded your saved answer and salt from local storage. Reveal to make
          your submission eligible for AI judging.
        </Notice>
      ) : (
        <Notice tone="amber">
          No saved secret found in this browser. Paste the exact answer and salt
          you used when committing.
        </Notice>
      )}

      {!stored && (
        <>
          <Field label="Answer">
            <Textarea
              value={manualAnswer}
              onChange={(e) => setManualAnswer(e.target.value)}
              rows={4}
              placeholder="Your original answer…"
            />
          </Field>
          <Field label="Salt (0x… 32 bytes)">
            <Textarea
              value={manualSalt}
              onChange={(e) => setManualSalt(e.target.value)}
              rows={2}
              placeholder="0x…"
            />
          </Field>
        </>
      )}

      <Button
        type="submit"
        disabled={!isConnected || !answer.trim() || !salt || tx.isBusy}
        className="w-full"
      >
        {tx.isBusy ? "Revealing…" : "Reveal answer"}
      </Button>
      <TxStatus state={tx.state} error={tx.error} hash={tx.hash} explorerBase={explorerBase} />
    </form>
  );
}
