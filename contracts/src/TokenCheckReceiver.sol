// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IReceiver, IERC165} from "./RwaVerdictReceiver.sol";

/// @title TokenCheckReceiver
/// @notice Receives the hashes the CRE workflow `token-check` writes and emits them.
///
/// The workflow checks many token addresses at once: for each, is the token at that
/// address the issuer's Robinhood Stock Token, on which grounds, and how many times
/// its share multiplier was changed. One run gives one map of rows. The keccak256 of
/// the canonical JSON of that map arrives here as a report of kind 1.
///
/// Several runs make one results file. The workflow anchors the file only after it
/// has read, for every run the file names, the receipt that holds the kind 1 event
/// for the rows of that run. The keccak256 of the file arrives here as kind 2.
///
/// Anyone holding the file can hash it, split its rows by run, hash those, and find
/// both events.
///
/// Same shape as the other receivers: no owner, no admin, no storage, no upgrade
/// path, cannot receive ETH, and only the forwarder fixed at deployment may call onReport.
contract TokenCheckReceiver is IReceiver, IERC165 {
    address public immutable FORWARDER;

    /// @param batchHash        keccak256 of the canonical JSON of the rows of one run
    /// @param listHash         keccak256 of the registry file the issuer's list was cut from
    /// @param checkedBlock     the Robinhood Chain block the state was read at
    /// @param checkedBlockHash the hash of that block
    /// @param tokens           how many addresses the run checked
    /// @param issuerTokens     how many of them are the issuer's Stock Token
    event TokenBatchChecked(
        bytes32 indexed batchHash,
        bytes32 indexed listHash,
        uint64 indexed checkedBlock,
        bytes32 checkedBlockHash,
        uint32 tokens,
        uint32 issuerTokens,
        bytes32 workflowId,
        bytes10 workflowName,
        address workflowOwner
    );

    /// @param resultsHash      keccak256 of the results file, byte for byte
    /// @param listHash         keccak256 of the registry file the issuer's list was cut from
    /// @param tokens           how many addresses the file holds
    /// @param issuerTokens     how many of them are the issuer's Stock Token
    /// @param runs             how many runs the file names
    /// @param lastCheckedBlock the highest block any row was checked at
    event TokenCheckResultsAnchored(
        bytes32 indexed resultsHash,
        bytes32 indexed listHash,
        uint32 tokens,
        uint32 issuerTokens,
        uint32 runs,
        uint64 lastCheckedBlock,
        bytes32 workflowId,
        bytes10 workflowName,
        address workflowOwner
    );

    error ZeroForwarder();
    error NotForwarder(address sender);
    error BadMetadata(uint256 length);
    error BadReport(uint256 length);
    error BadKind(uint8 kind);
    error BadCounts(uint32 tokens, uint32 issuerTokens, uint32 runs);

    uint8 internal constant KIND_BATCH = 1;
    uint8 internal constant KIND_RESULTS = 2;
    /// @dev 8 static ABI words.
    uint256 internal constant REPORT_LENGTH = 8 * 32;

    constructor(address forwarder) {
        if (forwarder == address(0)) revert ZeroForwarder();
        FORWARDER = forwarder;
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != FORWARDER) revert NotForwarder(msg.sender);
        if (metadata.length < 64) revert BadMetadata(metadata.length);
        if (report.length != REPORT_LENGTH) revert BadReport(report.length);

        (
            uint8 kind,
            bytes32 hash,
            bytes32 listHash,
            bytes32 blockHash,
            uint64 checkedBlock,
            uint32 tokens,
            uint32 issuerTokens,
            uint32 runs
        ) = abi.decode(report, (uint8, bytes32, bytes32, bytes32, uint64, uint32, uint32, uint32));
        if (tokens == 0 || issuerTokens > tokens || runs == 0) revert BadCounts(tokens, issuerTokens, runs);

        bytes32 workflowId = bytes32(metadata[0:32]);
        bytes10 workflowName = bytes10(metadata[32:42]);
        address workflowOwner = address(bytes20(metadata[42:62]));
        if (kind == KIND_BATCH) {
            emit TokenBatchChecked(
                hash, listHash, checkedBlock, blockHash, tokens, issuerTokens, workflowId, workflowName, workflowOwner
            );
        } else if (kind == KIND_RESULTS) {
            emit TokenCheckResultsAnchored(
                hash, listHash, tokens, issuerTokens, runs, checkedBlock, workflowId, workflowName, workflowOwner
            );
        } else {
            revert BadKind(kind);
        }
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
