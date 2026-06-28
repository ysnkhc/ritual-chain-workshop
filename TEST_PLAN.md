# Test Plan

Automated tests live in `hardhat/test/AIJudge.test.ts` (Node.js test runner +
viem). Blockchain time is manipulated deterministically with
`networkHelpers.time.increaseTo(...)`. The Ritual LLM precompile at `0x0802` is
mocked by copying `MockLLMPrecompile`'s runtime bytecode to that address with
`networkHelpers.setCode`, so the judging path runs without a live TEE.

## Commands used

```shell
cd hardhat
npx hardhat compile        # solc 0.8.24 — success
npx tsc --noEmit           # typecheck — exit 0
npx hardhat test           # 31 passing
```

Frontend:

```shell
cd web
npx tsc --noEmit           # exit 0
npx eslint .               # 0 errors (2 pre-existing starter warnings)
npx next build             # compiled successfully
```

## Scenarios

| # | Scenario | Expected | Actual |
| --- | --- | --- | --- |
| 1 | Bounty creation with valid deadlines | Created, fields stored | ✅ PASS |
| 2 | Invalid commitment deadline (past) fails | revert `InvalidCommitDeadline` | ✅ PASS |
| 3 | Reveal deadline before commit deadline fails | revert `InvalidRevealDeadline` | ✅ PASS |
| 4 | Bounty with no reward fails | revert `RewardRequired` | ✅ PASS |
| 5 | Valid commitment accepted | stored, count = 1 | ✅ PASS |
| 6 | Commitment stores no plaintext answer | `answer == ""`, `revealed == false` | ✅ PASS |
| 7 | Zero commitment fails | revert `ZeroCommitment` | ✅ PASS |
| 8 | Duplicate commitment (same wallet) fails | revert `DuplicateCommitment` | ✅ PASS |
| 9 | Commitment after deadline fails | revert `CommitmentClosed` | ✅ PASS |
| 10 | Commitment on invalid bounty id fails | revert `BountyNotFound` | ✅ PASS |
| 11 | Reveal before commit deadline fails | revert `RevealNotOpen` | ✅ PASS |
| 12 | Valid answer + salt reveal succeeds | `answer` stored, `revealed == true` | ✅ PASS |
| 13 | Wrong answer fails | revert `CommitmentMismatch` | ✅ PASS |
| 14 | Wrong salt fails | revert `CommitmentMismatch` | ✅ PASS |
| 15 | Different wallet fails | revert `NoCommitment` | ✅ PASS |
| 16 | Different bounty id → different commitment | hashes differ | ✅ PASS |
| 17 | Double reveal fails | revert `AlreadyRevealed` | ✅ PASS |
| 18 | Empty answer fails | revert `EmptyAnswer` | ✅ PASS |
| 19 | Oversized answer (>2000) fails | revert `AnswerTooLong` | ✅ PASS |
| 20 | Reveal after reveal deadline fails | revert `RevealClosed` | ✅ PASS |
| 21 | Judge before reveal deadline fails | revert `RevealNotEnded` | ✅ PASS |
| 22 | Judge with zero valid reveals fails | revert `NoRevealedSubmissions` | ✅ PASS |
| 23 | Unrevealed submissions excluded from judging | bob (unrevealed) excluded; `batchHash` set | ✅ PASS |
| 24 | Multiple valid reveals in one batch | alice + carol judged in one call | ✅ PASS |
| 25 | Invalid winner index fails | revert `InvalidWinnerIndex` | ✅ PASS |
| 26 | Unrevealed submission cannot win | revert `WinnerNotRevealed` | ✅ PASS |
| 27 | Winner receives the reward | winner balance += reward; `finalized` | ✅ PASS |
| 28 | Reward cannot be paid twice / second finalization fails | revert `AlreadyFinalized` | ✅ PASS |
| 29 | Finalization before judging fails | revert `NotJudged` | ✅ PASS |
| 30 | Unauthorized judging fails | revert `NotBountyOwner` | ✅ PASS |
| 31 | Unauthorized finalization fails | revert `NotBountyOwner` | ✅ PASS |
| 32 | Second judging fails | revert `AlreadyJudged` | ✅ PASS |

Scenarios 23 and 24 are covered by the single test
"excludes unrevealed submissions and judges only revealed ones in one batch"
(three commitments, two reveals, one `judgeAll`).

## Final test status

```
31 passing (31 nodejs)
```

All required scenarios pass. Compilation, typecheck, lint, contract tests, and
the frontend production build all succeed. No tests are failing.

## Deployment verification (Ritual Chain)

After deployment to Ritual Chain (chainId 1979) the contract was verified live:

- `eth_getCode(0xB55F2eEE3a9C80a11d0c39516C010C07dE3757A7)` → non-empty runtime
  bytecode (prefix `0x6080604052…`), not `0x`.
- `nextBountyId()` → `1` (deployed initial value).
- Ignition deploy receipt status: `SUCCESS`, block `38806866`,
  tx `0xc10985e03d6791668ce30ad5f39fb179eed570558de1f295e6b878e83e79adb2`.

### Note

The test suite uses the (functional but deprecated) `network.connect()` API,
which prints a deprecation warning to stderr. This does not affect results.
