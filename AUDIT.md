# Starter audit (Phase 1)

Audit of the starter `AIJudge.sol` before changes. No assignment PDF was present
in the repository or workspace; this audit uses the announcement and the
repository itself as the source of truth.

## Current contract lifecycle (before)

```
createBounty → submitAnswer (plaintext, repeatable) → judgeAll (owner) → finalizeWinner (owner)
```

- `createBounty(title, rubric, deadline)` payable, single `deadline`.
- `submitAnswer(bountyId, answer)` pushed `{submitter, answer}` directly.
- `judgeAll(bountyId, llmInput)` owner-only, calls LLM precompile `0x0802`,
  stores `aiReview`.
- `finalizeWinner(bountyId, winnerIndex)` owner-only, pays the winner.

## Exact privacy vulnerability

`submitAnswer` stored the plaintext `answer` in contract storage immediately,
and `getSubmission` returned it publicly. During the open submission window any
participant could read every other answer and copy or improve it. The deadline
check in `submitAnswer` was even commented out, so there was no commitment phase
and no confidentiality at all.

## Existing access controls

- `onlyOwner(bountyId)` — `msg.sender == bounties[bountyId].owner` on `judgeAll`
  and `finalizeWinner`.
- `bountyExists(bountyId)` — owner `!= address(0)`.
- `submitAnswer` had no access control (anyone can submit) — appropriate.

## Current bounty data structures

```solidity
struct Submission { address submitter; string answer; }
struct Bounty { address owner; string title; string rubric; uint256 reward;
                uint256 deadline; bool judged; bool finalized; bytes aiReview;
                uint256 winnerIndex; Submission[] submissions; }
mapping(uint256 => Bounty) public bounties;
```

Constants: `MAX_SUBMISSIONS = 10`, `MAX_ANSWER_LENGTH = 2000`.

## Existing AI judging flow

`judgeAll` calls `_executePrecompile(LLM_INFERENCE_PRECOMPILE, llmInput)` (single
batch call), decodes `(bool hasError, bytes completionData, bytes, string, ConvoHistory)`,
stores `completionData` as `aiReview`. The frontend (`web/src/lib/ritualLlm.ts`)
builds `llmInput` off-chain from all submissions.

## Existing deployment method

Hardhat 3 + Ignition. `ignition/modules/AIJudge.ts` deploys `AIJudge` (no args).
`hardhat.config.ts` defines a `ritual` network (chainId 1979,
`https://rpc.ritualfoundation.org`, `DEPLOYER_PRIVATE_KEY`) and `sepolia`.

## Files that must be modified

- `hardhat/contracts/AIJudge.sol` — commit-reveal lifecycle.
- `hardhat/test/` — new test suite (none existed).
- `hardhat/ignition/modules/AIJudge.ts` — unchanged (no constructor args).
- `web/src/abi/AIJudge.ts` — regenerated ABI.
- `web/src/lib/bounty.ts`, `web/src/components/*`, new commit-reveal lib/hook.

## Risks that could break compatibility

- Changing `getBounty` shape (single `deadline` → two deadlines + struct) breaks
  the frontend tuple parser — frontend updated accordingly.
- Removing `submitAnswer` (the vulnerability) removes a public function the old
  UI used — replaced by `submitCommitment` + `revealAnswer`.
- `judgeAll` decode path and owner-only gating preserved to keep the Ritual
  integration intact.
- Keeping the contract name `AIJudge` preserves the Ignition module and ABI
  import paths.
