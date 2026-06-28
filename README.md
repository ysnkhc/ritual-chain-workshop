# Privacy-Preserving AI Bounty Judge (Commit-Reveal)

A Ritual-Chain bounty system where participants compete for a reward judged by
an on-chain LLM — without leaking their answers to competitors.

The original starter stored every answer in plaintext on-chain the moment it was
submitted, so anyone could read, copy, and improve on other people's work before
the deadline. This project replaces that with a **commit-reveal lifecycle**:
during the commitment phase only a hash is published; plaintext is revealed only
after commitments close.

```
/hardhat   Smart contract (AIJudge.sol), tests, deployment
/web       Next.js frontend (commit → reveal → judge → finalize)
```

## Assignment objective

Implement a secure commit-reveal bounty judge:

1. Participants submit only a **commitment hash** during the commitment phase.
2. After the commitment deadline, participants **reveal** their answer + salt.
3. The contract verifies `keccak256(abi.encode(answer, salt, msg.sender, bountyId))`.
4. Only valid revealed answers are eligible for AI judging.
5. All eligible answers are judged in **one batch** (one LLM call, not one per answer).
6. The winner is finalized only after judging.

## Contract lifecycle

```
Bounty created → Commitment phase → Reveal phase → Batch AI judging → Winner finalized
```

| Phase | Window | What happens |
| --- | --- | --- |
| Commitment | `now < commitDeadline` | `submitCommitment(bountyId, commitment)` stores only a hash |
| Reveal | `commitDeadline ≤ now < revealDeadline` | `revealAnswer(bountyId, answer, salt)` verifies and stores plaintext |
| Judging | `now ≥ revealDeadline` | `judgeAll(bountyId, llmInput)` batch-judges revealed answers |
| Finalized | after judging | `finalizeWinner(bountyId, winnerIndex)` pays a revealed winner |

`createBounty` enforces `commitDeadline > block.timestamp` and
`revealDeadline > commitDeadline`.

### Public / external functions

```solidity
function createBounty(string title, string rubric, uint256 commitDeadline, uint256 revealDeadline) payable returns (uint256 bountyId);
function submitCommitment(uint256 bountyId, bytes32 commitment);
function revealAnswer(uint256 bountyId, string answer, bytes32 salt);
function judgeAll(uint256 bountyId, bytes llmInput);              // owner only
function finalizeWinner(uint256 bountyId, uint256 winnerIndex);   // owner only
```

## Commitment calculation

The commitment binds the answer to a salt, the submitter, and the bounty:

```solidity
bytes32 commitment = keccak256(abi.encode(answer, salt, msg.sender, bountyId));
```

In the browser the **exact same ABI encoding** is reproduced with viem (never a
manually concatenated string), so the commitment computed off-chain matches the
one the contract recomputes at reveal time:

```ts
const encoded = encodeAbiParameters(
  [{ type: "string" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }],
  [answer, salt, account, bountyId],
);
const commitment = keccak256(encoded); // see web/src/lib/commitReveal.ts
```

### Salt generation

Salts are 32 random bytes from the Web Crypto API:

```ts
const bytes = new Uint8Array(32);
crypto.getRandomValues(bytes);
const salt = toHex(bytes);
```

## Frontend flow

```
Enter answer → generate random bytes32 salt → compute commitment
  → save {bountyId, account, answer, salt, commitment} in localStorage
  → submit commitment → wait for reveal phase
  → reveal answer + salt → answer becomes eligible for batch judging
```

The UI shows the live phase (Commitment open / Reveal open / Waiting for judging
/ Judged / Finalized), hides answers during the commitment phase, and warns:

> Keep your reveal secret safe. If you lose the answer or salt, you cannot reveal
> your submission.

`localStorage` is acceptable for a workshop demo only. It is not secure storage.

## Batch AI judging

`judgeAll` runs only after the reveal deadline, requires at least one revealed
submission, and forwards a single `llmInput` payload to the Ritual LLM inference
precompile (`0x0802`) via the existing `PrecompileConsumer`. The frontend gathers
**only revealed** submissions and builds one batch prompt — never one LLM call
per answer. The contract also computes a canonical `batchHash` over the revealed
submissions and stores/emits it so the off-chain `llmInput` can be audited.

See `ARCHITECTURE.md` for the trust model and an honest note on what the
`batchHash` does and does not guarantee.

## Winner finalization

`finalizeWinner` (owner only) requires the bounty to be judged, the winner index
to be in range, and the selected submission to be **revealed**. It follows
checks-effects-interactions with a non-reentrancy guard, saves the winner and
zeroes the reward before transferring, so the reward cannot be paid twice.

## Installation

Prerequisites: Node.js 20.12+ (22 recommended), and [pnpm](https://pnpm.io).

```shell
# Contracts
cd hardhat
pnpm install
npx hardhat compile

# Frontend
cd ../web
pnpm install
```

## Environment variables

### hardhat/.env (gitignored — copy from `.env.example`)

| Variable | Purpose |
| --- | --- |
| `DEPLOYER_PRIVATE_KEY` | 0x-prefixed key that deploys to Ritual Chain (must hold RITUAL for gas) |
| `SEPOLIA_RPC_URL` / `SEPOLIA_PRIVATE_KEY` | Optional, only for Sepolia |

### web/.env.local (copy from `web/.env.example`)

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | Deployed AIJudge address |
| `NEXT_PUBLIC_RITUAL_RPC_URL` | `https://rpc.ritualfoundation.org` |
| `NEXT_PUBLIC_RITUAL_CHAIN_ID` | `1979` |
| `NEXT_PUBLIC_RITUAL_EXECUTOR_ADDRESS` | LLM executor address used when encoding `judgeAll` input |

Secrets live only in `.env` / `.env.local`, which are gitignored. `.env.example`
files contain placeholders only.

## Testing commands

```shell
cd hardhat
npx hardhat compile            # compile
npx tsc --noEmit               # typecheck tests + scripts
npx hardhat test               # run all tests (31 passing)
npx hardhat test nodejs        # just the TypeScript/viem tests
```

Frontend checks:

```shell
cd web
npx eslint .                   # lint
npx tsc --noEmit               # typecheck
npx next build                 # production build
```

See `TEST_PLAN.md` for every scenario and the recorded results.

## Deployment commands

The deployment network is **Ritual Chain** (`chainId 1979`,
`https://rpc.ritualfoundation.org`), configured in `hardhat.config.ts`.

```shell
cd hardhat

# 1. Set the deployer key (either in hardhat/.env or via the keystore):
#    echo "DEPLOYER_PRIVATE_KEY=0x..." > .env
#    -- or --
#    npx hardhat keystore set DEPLOYER_PRIVATE_KEY

# 2. Preflight: confirm network, deployer address and balance (no tx sent):
npx hardhat run scripts/deploy-preflight.ts --network ritual

# 3. Deploy:
npx hardhat ignition deploy --network ritual ignition/modules/AIJudge.ts
```

`AIJudge` has no constructor arguments.

After deploying, copy the address into `web/.env.local` as
`NEXT_PUBLIC_CONTRACT_ADDRESS` and regenerate the frontend ABI if the contract
changed:

```shell
npx hardhat run scripts/export-abi.ts
```

## Contract address after deployment

| Field | Value |
| --- | --- |
| Network | Ritual Chain |
| Chain ID | 1979 |
| Contract address | _pending deployment — see SUBMISSION.md_ |
| Deploy tx hash | _pending deployment — see SUBMISSION.md_ |

Deployment requires a funded `DEPLOYER_PRIVATE_KEY`. See SUBMISSION.md for the
exact values once deployed.

## Known limitations

- **Owner-built `llmInput`.** The bounty owner constructs the judging payload
  off-chain. The contract cannot read its contents, so a malicious owner could
  omit or alter entries. `batchHash` makes tampering detectable but does not
  prevent it on-chain. See ARCHITECTURE.md.
- **Revealed answers are public.** In the commit-reveal track, revealed answers
  are stored on-chain in plaintext (this is by design for auditable judging).
  An encrypted, TEE-based design that keeps answers hidden through judging is
  described in ARCHITECTURE.md (advanced track).
- **localStorage reveal secrets.** Demo-only persistence. Losing the
  answer/salt makes a submission unrevealable.
- **AI is advisory.** The owner picks the final winner; the AI result is a
  recommendation.
- **Mocked LLM ABI.** The exact LLM precompile request ABI is a best-effort
  layout (`web/src/lib/ritualLlm.ts`), isolated so it can be updated once the
  real ABI is pinned.

## Security assumptions

- Block timestamps are trusted within normal validator tolerance for deadlines.
- `keccak256` is collision-resistant, so a commitment does not leak the answer.
- The Ritual LLM precompile and its TEE executor behave honestly.
- The bounty owner is trusted to build a faithful `llmInput` and to finalize
  fairly; `batchHash` provides auditability, not enforcement.

See `ARCHITECTURE.md` for the full threat model and design rationale, and
`SUBMISSION.md` for deployment artifacts and the reflection question.
