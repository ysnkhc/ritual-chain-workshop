# Submission — Privacy-Preserving AI Bounty Judge

## Repository

| Field | Value |
| --- | --- |
| GitHub fork URL | _pending — push requires GitHub auth (see "Remaining blockers")_ |
| Branch | `feature/commit-reveal-bounty` |
| Latest commit hash | `62b6cd855b76ff70c9fbb7e04bb1a6aa96a08deb` (branch tip before push; will advance if you push deploy artifacts) |

## Deployment

| Field | Value |
| --- | --- |
| Network name | Ritual Chain |
| Chain ID | 1979 (`0x7bb`, verified live via `eth_chainId`) |
| RPC URL | https://rpc.ritualfoundation.org |
| Deployed contract address | _pending — requires funded `DEPLOYER_PRIVATE_KEY`_ |
| Deployment transaction hash | _pending — requires funded `DEPLOYER_PRIVATE_KEY`_ |
| Deployment command | `npx hardhat ignition deploy --network ritual ignition/modules/AIJudge.ts` |
| Constructor arguments | none (`AIJudge` has no constructor) |
| Timestamp | _set at deploy time_ |
| Explorer base | https://explorer.ritualfoundation.org |

Explorer links (fill the values after deploying):

- Contract: `https://explorer.ritualfoundation.org/address/<contract address>`
- Deploy tx: `https://explorer.ritualfoundation.org/tx/<tx hash>`

## Proof of Building form values

```
GitHub Fork URL: <your fork URL, e.g. https://github.com/<you>/ritual-chain-workshop>
Deployed Contract Address: <0x… 20-byte address from the Ignition deploy receipt>
Deploy Transaction Hash: <0x… 32-byte tx hash from the Ignition deploy receipt>
A step you struggled with: Returning the full bounty from getBounty hit a Solidity "stack too deep" error because the view returned twelve values at once; I resolved it by returning a single in-memory BountyView struct instead of a wide tuple, which also let me drop the verbose positional tuple parser in the frontend.
```

> These three values cannot be fabricated. The contract address and tx hash come
> from the actual Ignition deploy receipt; the fork URL comes from your GitHub
> account. See "Remaining blockers" for exactly what is needed to fill them.

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
- [ ] Deployed to Ritual Chain (needs funded `DEPLOYER_PRIVATE_KEY`)
- [ ] Pushed to GitHub fork (needs GitHub auth)
- [ ] Proof of Building form values filled with real address + tx hash

## Remaining blockers

1. **Deployment** needs a funded deployer key. Provide it as
   `DEPLOYER_PRIVATE_KEY` in `hardhat/.env` (gitignored) or via
   `npx hardhat keystore set DEPLOYER_PRIVATE_KEY`. The matching account must
   hold RITUAL on chain 1979 for gas. Do **not** paste the key into chat.
2. **GitHub push** needs auth for your fork (a git credential / token, or `gh`
   CLI login). Once authenticated I can add the remote and push
   `feature/commit-reveal-bounty`.
