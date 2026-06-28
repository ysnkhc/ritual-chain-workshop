// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PrecompileConsumer} from "./utils/PrecompileConsumer.sol";

interface IRitualWallet {
    function deposit(uint256 lockDuration) external payable;

    function depositFor(address user, uint256 lockDuration) external payable;

    function withdraw(uint256 amount) external;

    function balanceOf(address) external view returns (uint256);

    function lockUntil(address) external view returns (uint256);
}

/**
 * @title AIJudge
 * @notice Privacy-preserving bounty judge using a commit-reveal lifecycle.
 *
 * Lifecycle:
 *   Created -> Commitment phase -> Reveal phase -> Batch AI judging -> Finalized
 *
 * During the commitment phase participants submit only a commitment hash:
 *
 *   keccak256(abi.encode(answer, salt, msg.sender, bountyId))
 *
 * No plaintext answer ever touches storage, events or calldata before the
 * reveal phase, so participants cannot read and copy each other's work.
 *
 * After the commitment deadline, participants reveal `answer` and `salt`. The
 * contract recomputes the commitment and only accepts an exact match. Only
 * revealed submissions are eligible for batch AI judging and for winning.
 */
contract AIJudge is PrecompileConsumer {
    uint256 public constant MAX_SUBMISSIONS = 10;
    uint256 public constant MAX_ANSWER_LENGTH = 2_000;

    uint256 public nextBountyId = 1;

    IRitualWallet wallet =
        IRitualWallet(0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948);

    struct Submission {
        address submitter;
        bytes32 commitment;
        string answer;
        bool revealed;
    }

    struct Bounty {
        address owner;
        string title;
        string rubric;
        uint256 reward;
        uint256 commitDeadline;
        uint256 revealDeadline;
        bool judged;
        bool finalized;
        bytes aiReview;
        bytes32 batchHash;
        uint256 winnerIndex;
        Submission[] submissions;
    }

    struct ConvoHistory {
        string storageType;
        string path;
        string secretsName;
    }

    /// @dev Flattened, memory-friendly view of a bounty (omits the raw
    /// submissions array; use getSubmission / getSubmissionIndex for those).
    struct BountyView {
        address owner;
        string title;
        string rubric;
        uint256 reward;
        uint256 commitDeadline;
        uint256 revealDeadline;
        bool judged;
        bool finalized;
        uint256 submissionCount;
        uint256 winnerIndex;
        bytes aiReview;
        bytes32 batchHash;
    }

    mapping(uint256 => Bounty) public bounties;

    /// @dev bountyId => submitter => (submission index + 1). 0 means "none".
    /// Lets us find a participant's submission in O(1) without looping.
    mapping(uint256 => mapping(address => uint256))
        private submissionIndexPlusOne;

    /// @dev Simple non-reentrancy guard (1 = unlocked, 2 = locked).
    uint256 private _locked = 1;

    // --- Errors ---
    error BountyNotFound();
    error NotBountyOwner();
    error RewardRequired();
    error InvalidCommitDeadline();
    error InvalidRevealDeadline();
    error ZeroCommitment();
    error CommitmentClosed();
    error DuplicateCommitment();
    error AlreadyJudged();
    error AlreadyFinalized();
    error TooManySubmissions();
    error RevealNotOpen();
    error RevealClosed();
    error NoCommitment();
    error AlreadyRevealed();
    error EmptyAnswer();
    error AnswerTooLong();
    error CommitmentMismatch();
    error RevealNotEnded();
    error NoRevealedSubmissions();
    error NotJudged();
    error InvalidWinnerIndex();
    error WinnerNotRevealed();
    error PaymentFailed();
    error Reentrancy();
    error LLMError(string message);

    // --- Events ---
    event BountyCreated(
        uint256 indexed bountyId,
        address indexed owner,
        string title,
        uint256 reward,
        uint256 commitDeadline,
        uint256 revealDeadline
    );

    /// @dev Commitment phase event. Carries only non-sensitive data: never the
    /// answer or salt.
    event CommitmentSubmitted(
        uint256 indexed bountyId,
        address indexed submitter,
        bytes32 commitment,
        uint256 submissionIndex
    );

    /// @dev Reveal event. Identifies the submission as revealed but never emits
    /// the salt (or, beyond the on-chain answer store, the plaintext).
    event AnswerRevealed(
        uint256 indexed bountyId,
        uint256 indexed submissionIndex,
        address indexed submitter
    );

    event AllAnswersJudged(
        uint256 indexed bountyId,
        bytes aiReview,
        bytes32 batchHash,
        uint256 revealedCount
    );

    event WinnerFinalized(
        uint256 indexed bountyId,
        uint256 indexed winnerIndex,
        address indexed winner,
        uint256 reward
    );

    modifier onlyOwner(uint256 bountyId) {
        if (msg.sender != bounties[bountyId].owner) revert NotBountyOwner();
        _;
    }

    modifier bountyExists(uint256 bountyId) {
        if (bounties[bountyId].owner == address(0)) revert BountyNotFound();
        _;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    /**
     * @notice Create a funded bounty with a commit phase and a reveal phase.
     * @param title          Human-readable bounty title / prompt.
     * @param rubric         Judging rubric used by the AI.
     * @param commitDeadline Unix time after which commitments are closed.
     * @param revealDeadline Unix time after which reveals are closed.
     */
    function createBounty(
        string calldata title,
        string calldata rubric,
        uint256 commitDeadline,
        uint256 revealDeadline
    ) external payable returns (uint256 bountyId) {
        if (msg.value == 0) revert RewardRequired();
        if (commitDeadline <= block.timestamp) revert InvalidCommitDeadline();
        if (revealDeadline <= commitDeadline) revert InvalidRevealDeadline();

        bountyId = nextBountyId++;

        Bounty storage bounty = bounties[bountyId];

        bounty.owner = msg.sender;
        bounty.title = title;
        bounty.rubric = rubric;
        bounty.reward = msg.value;
        bounty.commitDeadline = commitDeadline;
        bounty.revealDeadline = revealDeadline;
        bounty.winnerIndex = type(uint256).max;

        emit BountyCreated(
            bountyId,
            msg.sender,
            title,
            msg.value,
            commitDeadline,
            revealDeadline
        );
    }

    /**
     * @notice Submit a commitment hash during the commitment phase.
     * @dev Stores only the commitment. The answer and salt stay off-chain until
     * the reveal phase.
     */
    function submitCommitment(
        uint256 bountyId,
        bytes32 commitment
    ) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        if (commitment == bytes32(0)) revert ZeroCommitment();
        if (bounty.finalized) revert AlreadyFinalized();
        if (bounty.judged) revert AlreadyJudged();
        if (block.timestamp >= bounty.commitDeadline) revert CommitmentClosed();
        if (submissionIndexPlusOne[bountyId][msg.sender] != 0) {
            revert DuplicateCommitment();
        }
        if (bounty.submissions.length >= MAX_SUBMISSIONS) {
            revert TooManySubmissions();
        }

        bounty.submissions.push(
            Submission({
                submitter: msg.sender,
                commitment: commitment,
                answer: "",
                revealed: false
            })
        );

        uint256 index = bounty.submissions.length - 1;
        submissionIndexPlusOne[bountyId][msg.sender] = index + 1;

        emit CommitmentSubmitted(bountyId, msg.sender, commitment, index);
    }

    /**
     * @notice Reveal an answer + salt during the reveal phase.
     * @dev The commitment is recomputed and must match exactly. Binding the
     * commitment to msg.sender and bountyId prevents replaying another wallet's
     * or another bounty's commitment.
     */
    function revealAnswer(
        uint256 bountyId,
        string calldata answer,
        bytes32 salt
    ) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        if (block.timestamp < bounty.commitDeadline) revert RevealNotOpen();
        if (block.timestamp >= bounty.revealDeadline) revert RevealClosed();

        uint256 idxPlusOne = submissionIndexPlusOne[bountyId][msg.sender];
        if (idxPlusOne == 0) revert NoCommitment();

        uint256 index = idxPlusOne - 1;
        Submission storage submission = bounty.submissions[index];

        if (submission.revealed) revert AlreadyRevealed();

        uint256 answerLength = bytes(answer).length;
        if (answerLength == 0) revert EmptyAnswer();
        if (answerLength > MAX_ANSWER_LENGTH) revert AnswerTooLong();

        bytes32 expectedCommitment = keccak256(
            abi.encode(answer, salt, msg.sender, bountyId)
        );
        if (expectedCommitment != submission.commitment) {
            revert CommitmentMismatch();
        }

        submission.answer = answer;
        submission.revealed = true;

        emit AnswerRevealed(bountyId, index, msg.sender);
    }

    /**
     * @notice Batch-judge every revealed submission in a single LLM call.
     * @dev Only revealed submissions are eligible. A canonical hash of the
     * revealed batch is stored/emitted so the off-chain `llmInput` can be
     * audited against what the contract actually considers eligible.
     *
     * Trust note: `llmInput` is constructed off-chain by the bounty owner. The
     * contract cannot inspect its contents, so an owner could in principle omit
     * or alter entries. `batchHash` lets observers detect such tampering, but
     * the contract does not enforce that `llmInput` matches `batchHash`.
     */
    function judgeAll(
        uint256 bountyId,
        bytes calldata llmInput
    ) external bountyExists(bountyId) onlyOwner(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        if (block.timestamp < bounty.revealDeadline) revert RevealNotEnded();
        if (bounty.judged) revert AlreadyJudged();
        if (bounty.finalized) revert AlreadyFinalized();

        bytes32 batchHash;
        uint256 revealedCount;
        (batchHash, revealedCount) = _revealedBatchHash(bounty, bountyId);
        if (revealedCount == 0) revert NoRevealedSubmissions();

        bytes memory output = _executePrecompile(
            LLM_INFERENCE_PRECOMPILE,
            llmInput
        );

        (
            bool hasError,
            bytes memory completionData,
            ,
            string memory errorMessage,

        ) = abi.decode(output, (bool, bytes, bytes, string, ConvoHistory));

        if (hasError) revert LLMError(errorMessage);

        bounty.judged = true;
        bounty.aiReview = completionData;
        bounty.batchHash = batchHash;

        emit AllAnswersJudged(bountyId, completionData, batchHash, revealedCount);
    }

    /**
     * @notice Finalize the winner and pay the reward. Owner only.
     * @dev Follows checks-effects-interactions and a non-reentrancy guard.
     * Only a revealed submission can win, and the reward can only be paid once.
     */
    function finalizeWinner(
        uint256 bountyId,
        uint256 winnerIndex
    ) external bountyExists(bountyId) onlyOwner(bountyId) nonReentrant {
        Bounty storage bounty = bounties[bountyId];

        if (!bounty.judged) revert NotJudged();
        if (bounty.finalized) revert AlreadyFinalized();
        if (winnerIndex >= bounty.submissions.length) {
            revert InvalidWinnerIndex();
        }

        Submission storage winnerSubmission = bounty.submissions[winnerIndex];
        if (!winnerSubmission.revealed) revert WinnerNotRevealed();

        // Effects first.
        bounty.finalized = true;
        bounty.winnerIndex = winnerIndex;

        address winner = winnerSubmission.submitter;
        uint256 reward = bounty.reward;
        bounty.reward = 0;

        // Interaction last.
        (bool ok, ) = payable(winner).call{value: reward}("");
        if (!ok) revert PaymentFailed();

        emit WinnerFinalized(bountyId, winnerIndex, winner, reward);
    }

    /**
     * @dev Build a canonical hash over the revealed submissions, in index
     * order, binding the bounty id, indices, submitters and answers together.
     */
    function _revealedBatchHash(
        Bounty storage bounty,
        uint256 bountyId
    ) private view returns (bytes32 batchHash, uint256 revealedCount) {
        uint256 len = bounty.submissions.length;

        for (uint256 i = 0; i < len; i++) {
            if (bounty.submissions[i].revealed) revealedCount++;
        }
        if (revealedCount == 0) {
            return (bytes32(0), 0);
        }

        uint256[] memory indices = new uint256[](revealedCount);
        address[] memory submitters = new address[](revealedCount);
        string[] memory answers = new string[](revealedCount);

        uint256 j;
        for (uint256 i = 0; i < len; i++) {
            Submission storage s = bounty.submissions[i];
            if (s.revealed) {
                indices[j] = i;
                submitters[j] = s.submitter;
                answers[j] = s.answer;
                j++;
            }
        }

        batchHash = keccak256(
            abi.encode(bountyId, indices, submitters, answers)
        );
    }

    // --- Views ---

    function getBounty(
        uint256 bountyId
    ) external view bountyExists(bountyId) returns (BountyView memory view_) {
        Bounty storage bounty = bounties[bountyId];

        view_ = BountyView({
            owner: bounty.owner,
            title: bounty.title,
            rubric: bounty.rubric,
            reward: bounty.reward,
            commitDeadline: bounty.commitDeadline,
            revealDeadline: bounty.revealDeadline,
            judged: bounty.judged,
            finalized: bounty.finalized,
            submissionCount: bounty.submissions.length,
            winnerIndex: bounty.winnerIndex,
            aiReview: bounty.aiReview,
            batchHash: bounty.batchHash
        });
    }

    /**
     * @notice Read one submission.
     * @dev `answer` is the empty string until the submission is revealed, so
     * this never exposes plaintext during the commitment phase.
     */
    function getSubmission(
        uint256 bountyId,
        uint256 index
    )
        external
        view
        bountyExists(bountyId)
        returns (
            address submitter,
            bytes32 commitment,
            string memory answer,
            bool revealed
        )
    {
        Bounty storage bounty = bounties[bountyId];

        require(index < bounty.submissions.length, "invalid index");

        Submission storage submission = bounty.submissions[index];

        return (
            submission.submitter,
            submission.commitment,
            submission.answer,
            submission.revealed
        );
    }

    /**
     * @notice O(1) lookup of a participant's submission index for a bounty.
     * @return exists Whether the wallet has a submission.
     * @return index  The submission index (valid only when `exists` is true).
     */
    function getSubmissionIndex(
        uint256 bountyId,
        address who
    ) external view bountyExists(bountyId) returns (bool exists, uint256 index) {
        uint256 idxPlusOne = submissionIndexPlusOne[bountyId][who];
        if (idxPlusOne == 0) return (false, 0);
        return (true, idxPlusOne - 1);
    }
}
