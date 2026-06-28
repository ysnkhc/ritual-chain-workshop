# Submission — Privacy-Preserving AI Bounty Judge

## Repository

| Field | Value |
| --- | --- |
| GitHub fork URL | https://github.com/ysnkhc/ritual-chain-workshop |
| Branch | `feature/commit-reveal-bounty` |
| Branch URL | https://github.com/ysnkhc/ritual-chain-workshop/tree/feature/commit-reveal-bounty |
| Latest commit hash | see `git log -1` on `feature/commit-reveal-bounty`; reported in the final Proof of Building output |

## Deployment

| Field | Value |
| --- | --- |
| Network name | Ritual Chain |
| Chain ID | 1979 (`0x7bb`, verified live via `eth_chainId`) |
| RPC URL | https://rpc.ritualfoundation.org |
| Deployed contract address | `0xB55F2eEE3a9C80a11d0c39516C010C07dE3757A7` |
| Deployment transaction hash | `0xc10985e03d6791668ce30ad5f39fb179eed570558de1f295e6b878e83e79adb2` |
| Block number | 38806866 |
| Block hash | `0x606f1cf7c82a660f07b5699c7b0083d964c80048d0bf90cb9856e573d3753219` |
| Deployer address | `0xdeb0c9690beefbba42ec1ceb8b2c90d9b1bf045d` |
| Deployment command | `npx hardhat ignition deploy --network ritual ignition/modules/AIJudge.ts` |
| Constructor arguments | none (`AIJudge` has no constructor) |
| Deploy tooling | Hardhat 3 + Ignition (`AIJudgeModule`) |

Explorer links:

- Contract: https://explorer.ritualfoundation.org/address/0xB55F2eEE3a9C80a11d0c39516C010C07dE3757A7
- Deploy tx: https://explorer.ritualfoundation.org/tx/0xc10985e03d6791668ce30ad5f39fb179eed570558de1f295e6b878e83e79adb2

### On-chain verification

- `eth_getCode(0xB55F2eEE3a9C80a11d0c39516C010C07dE3757A7)` returns non-empty
  runtime bytecode (prefix `0x6080604052…`), not `0x`.
- `nextBountyId()` reads `1` (the deployed initial value), confirming the
  contract responds to calls.
- Ignition receipt status: `SUCCESS`.

## Proof of Building form values

```
GitHub Fork URL: https://github.com/ysnkhc/ritual-chain-workshop
Deployed Contract Address: 0xB55F2eEE3a9C80a11d0c39516C010C07dE3757A7
Deploy Transaction Hash: 0xc10985e03d6791668ce30ad5f39fb179eed570558de1f295e6b878e83e79adb2
A step you struggled with: Returning the full bounty from getBounty caused a Solidity stack-too-deep error because the view returned twelve values. I fixed it by returning a single in-memory BountyView struct, which also simplified the frontend parser.
```

## A step that was genuinely difficult

Two real issues during implementation:

1. **Stack too deep in `getBounty`.** Adding `commitDeadline`, `revealDeadline`,
   and `batchHash` pushed the view's return list to twelve values, and solc
   0.8.24 failed with `CompilerError: Stack too deep`. Rather than enabling
   `viaIR` (slower compiles) I redesigned `getBounty` to build and return a
   single `BountyView` memory struct. This fixed compilation and simplified the
   frontend, which now reads a named object instead of a 12-element tuple.

2. **React `set-state-in-effect` lint error.** Loading the locally-stored reveal
   secret with `useEffect` + `setState` tripped the `react-hooks/set-state-in-effect`
   rule. I replaced it with a `useSyncExternalStore` hook (`useRevealSecret`)
   that returns the raw localStorage string from `getSnapshot` and parses it via
   `useMemo`, avoiding the infinite-render trap of returning a fresh object.

## Reflection question

**"What should be public, what should stay hidden, and what should be decided by
AI versus by a human in a bounty system?"**

The bounty's rules, rubric, deadlines, reward, the submitted commitment hashes,
and the final result should be public so the competition is transparent and
verifiable. Each participant's answer and salt must stay hidden before the
reveal phase so no one can copy or improve on another entry while the bounty is
still open. In a normal commit-reveal track the revealed answers then become
public, which keeps judging auditable and lets anyone check the outcome against
the rubric. The AI should score and compare the revealed submissions in one
batch, applying the rubric consistently across every entry. Humans should define
that rubric up front and resolve disputes or edge cases the model gets wrong,
since the AI's role is advisory rather than final. Finalization must remain
transparent and auditable on-chain, so that the winner, the reward transfer, and
the canonical batch that was judged can all be independently verified.

## Final checklist

- [x] Audit of the starter contract completed
- [x] Commit-reveal lifecycle implemented (`submitCommitment`, `revealAnswer`, `judgeAll`, `finalizeWinner`)
- [x] Commitment = `keccak256(abi.encode(answer, salt, msg.sender, bountyId))`
- [x] No plaintext stored/emitted during commitment phase; salt never emitted
- [x] Deadlines enforced (`commitDeadline > now`, `revealDeadline > commitDeadline`)
- [x] Only revealed submissions are eligible for judging and winning
- [x] One batch LLM call (not one per answer); canonical `batchHash` for audit
- [x] Reentrancy guard + checks-effects-interactions on payout; reward paid once
- [x] Custom errors; access control on judge/finalize
- [x] 31 automated tests pass (deterministic time, mocked precompile)
- [x] Frontend updated to full commit → reveal → judge → finalize flow
- [x] Secure salt via `crypto.getRandomValues`; viem ABI encoding matches Solidity
- [x] localStorage reveal-secret warning shown; answers hidden during commitment
- [x] Docs: README, ARCHITECTURE (with Mermaid + advanced TEE design), TEST_PLAN, SUBMISSION
- [x] `.env` gitignored; `.env.example` placeholders only; no secrets committed
- [x] Deployment network confirmed (Ritual Chain, chainId 1979) — not guessed
- [x] Deployed to Ritual Chain (`0xB55F2eEE3a9C80a11d0c39516C010C07dE3757A7`, tx `0xc10985…79adb2`)
- [x] Deployed bytecode verified on-chain via `eth_getCode` + `nextBountyId()` read
- [x] Pushed to GitHub fork `ysnkhc/ritual-chain-workshop`, branch `feature/commit-reveal-bounty`
- [x] Proof of Building form values filled with real address + tx hash

## Remaining blockers

None. Code, tests, frontend build, deployment, on-chain verification, docs, and
the GitHub push are all complete. The contract is live on Ritual Chain and the
branch with final deployment docs is pushed to the fork.
