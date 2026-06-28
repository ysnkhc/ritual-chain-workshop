// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockLLMPrecompile
 * @notice Test-only stand-in for the Ritual LLM inference precompile (0x0802).
 *
 * On Ritual Chain the real precompile returns:
 *   abi.encode(bytes simmedInput, bytes actualOutput)
 * where `actualOutput` itself decodes (in AIJudge) to:
 *   abi.encode(bool hasError, bytes completionData, bytes, string errorMessage,
 *              (string,string,string) convoHistory)
 *
 * In tests we deploy this mock, copy its runtime bytecode to address 0x0802 via
 * the test client's `setCode`, and let it echo a deterministic judge result so
 * the commit-reveal + judging path can be exercised without a live TEE.
 */
contract MockLLMPrecompile {
    struct ConvoHistory {
        string storageType;
        string path;
        string secretsName;
    }

    /// @dev Configurable response. Defaults to a valid JSON judge result.
    bytes public completionData =
        bytes('{"winnerIndex":0,"summary":"ok","ranking":[]}');
    bool public hasError;
    string public errorMessage;

    function setCompletion(bytes calldata data) external {
        completionData = data;
    }

    function setError(bool _hasError, string calldata _message) external {
        hasError = _hasError;
        errorMessage = _message;
    }

    /// @dev Any call that isn't one of the setters above lands here and is
    /// treated as the precompile invocation.
    fallback(bytes calldata input) external returns (bytes memory) {
        bytes memory actualOutput = abi.encode(
            hasError,
            completionData,
            bytes(""),
            errorMessage,
            ConvoHistory("", "", "")
        );
        return abi.encode(input, actualOutput);
    }
}
