"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { parseEther, parseEventLogs } from "viem";
import { contractAddress, isContractConfigured } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import aiJudgeAbi from "@/abi/AIJudge";
import { useWriteTx } from "@/hooks/useWriteTx";
import {
  Card,
  CardHeader,
  CardBody,
  Field,
  Input,
  Textarea,
  Button,
  TxStatus,
  Notice,
} from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;

/** datetime-local value = now + `minutes`, formatted as YYYY-MM-DDTHH:mm. */
function offsetDeadline(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function CreateBountyForm({ onCreated }: { onCreated?: (bountyId: bigint) => void }) {
  const { isConnected } = useAccount();
  const [title, setTitle] = useState("");
  const [rubric, setRubric] = useState("");
  const [commitDeadline, setCommitDeadline] = useState(offsetDeadline(60));
  const [revealDeadline, setRevealDeadline] = useState(offsetDeadline(120));
  const [reward, setReward] = useState("");
  const [createdId, setCreatedId] = useState<bigint | null>(null);

  // Once confirmed, pull the new bountyId out of the BountyCreated event log.
  const tx = useWriteTx((receipt) => {
    try {
      const logs = parseEventLogs({
        abi: aiJudgeAbi,
        eventName: "BountyCreated",
        logs: receipt.logs,
      });
      const id = logs[0]?.args?.bountyId;
      if (id !== undefined) {
        setCreatedId(id);
        onCreated?.(id);
      }
    } catch {
      /* couldn't decode — not fatal */
    }
  });

  // Pure, render-safe validation (no clock reads here — see handleSubmit).
  const validation = useMemo(() => {
    if (!title.trim()) return "Title is required.";
    if (!rubric.trim()) return "Rubric is required.";
    if (!commitDeadline) return "Pick a commitment deadline.";
    if (!revealDeadline) return "Pick a reveal deadline.";
    const commitTs = new Date(commitDeadline).getTime();
    const revealTs = new Date(revealDeadline).getTime();
    if (!Number.isFinite(commitTs)) return "Invalid commitment deadline.";
    if (!Number.isFinite(revealTs)) return "Invalid reveal deadline.";
    if (revealTs <= commitTs) return "Reveal deadline must be after the commitment deadline.";
    if (reward === "" ) return "Reward is required.";
    try {
      if (parseEther(reward) <= 0n) return "Reward must be greater than zero.";
    } catch {
      return "Reward must be a valid number.";
    }
    return null;
  }, [title, rubric, commitDeadline, revealDeadline, reward]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validation || !contractAddress) return;

    const commitMs = new Date(commitDeadline).getTime();
    const revealMs = new Date(revealDeadline).getTime();
    if (commitMs <= Date.now()) {
      window.alert("Commitment deadline must be in the future.");
      return;
    }

    const commitTs = BigInt(Math.floor(commitMs / 1000));
    const revealTs = BigInt(Math.floor(revealMs / 1000));
    const value = parseEther(reward.trim());
    setCreatedId(null);

    try {
      await tx.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "createBounty",
        args: [title.trim(), rubric.trim(), commitTs, revealTs],
        value,
        chainId: ritualChain.id,
      });
    } catch {
      /* surfaced via tx.state */
    }
  }

  return (
    <Card>
      <CardHeader
        title="Create a bounty"
        subtitle="Fund a reward, set a commitment + reveal window, and define the rubric."
      />
      <CardBody>
        {!isContractConfigured && (
          <Notice tone="amber">
            Set <code className="font-mono">NEXT_PUBLIC_CONTRACT_ADDRESS</code> in your{" "}
            <code className="font-mono">.env.local</code> to enable transactions.
          </Notice>
        )}

        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Best gas-optimization writeup"
              maxLength={200}
            />
          </Field>

          <Field label="Rubric" hint="How submissions are scored. The AI judges only against this.">
            <Textarea
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
              rows={4}
              placeholder="Correctness 50%, clarity 30%, novelty 20%…"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Commitment deadline" hint="Commitments close at this time.">
              <Input
                type="datetime-local"
                value={commitDeadline}
                onChange={(e) => setCommitDeadline(e.target.value)}
              />
            </Field>
            <Field label="Reveal deadline" hint="Must be after the commitment deadline.">
              <Input
                type="datetime-local"
                value={revealDeadline}
                onChange={(e) => setRevealDeadline(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Reward (RITUAL)" hint="Locked in the contract on create.">
            <Input
              type="number"
              min="0"
              step="any"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              placeholder="1.0"
            />
          </Field>

          {validation && (title || rubric || reward) ? (
            <p className="text-xs text-amber-300">{validation}</p>
          ) : null}

          <Button
            type="submit"
            disabled={!isConnected || !isContractConfigured || !!validation || tx.isBusy}
            className="w-full"
          >
            {tx.isBusy ? "Creating…" : "Create bounty"}
          </Button>

          {!isConnected && (
            <p className="text-xs text-zinc-500">Connect your wallet to create a bounty.</p>
          )}

          <TxStatus state={tx.state} error={tx.error} hash={tx.hash} explorerBase={explorerBase} />

          {createdId !== null && (
            <Notice tone="green">
              Bounty created with id{" "}
              <span className="font-mono font-semibold">#{createdId.toString()}</span>. Loaded
              below.
            </Notice>
          )}
        </form>
      </CardBody>
    </Card>
  );
}
