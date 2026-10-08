// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The interface a CRE forwarder calls (docs.chain.link/cre, "Building consumer contracts").
interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// @title RwaVerdictReceiver
/// @notice Receives the verdict of the vet402 /rwa CRE workflow and emits it as an event.
///
/// The workflow re-hashes a vet402 /rwa record and compares it with the anchor that
/// RwaAnchor (0x1955...c22d, Robinhood Chain 4663) holds for it. This contract only
/// records the result. It has no owner, no admin, no storage of its own, no upgrade
/// path, and it cannot receive ETH (no payable function, no receive, no fallback).
///
/// Only the CRE forwarder fixed at deployment can call onReport. Any workflow can be
/// routed through that forwarder, so the event carries the workflow id, name and
/// owner from the forwarder's metadata: a reader filters on the workflow it trusts.
contract RwaVerdictReceiver is IReceiver, IERC165 {
    /// @notice The CRE forwarder allowed to deliver reports. Set once, never changed.
    address public immutable FORWARDER;

    /// @param anchorTx       the Robinhood Chain tx that holds the anchor
    /// @param subject        keccak256 of the lower-cased wallet address in the record
    /// @param isMatch        true when every check passed
    /// @param reasons        one bit per failed check (see rwa-verify/verify.ts, `Reason`)
    /// @param recomputedFactsHash factsHash recomputed from the record
    /// @param anchoredFactsHash   factsHash in the Anchored log (zero when no log was found)
    /// @param asOf           record as_of, unix seconds
    /// @param anchorBlock    block of the anchor tx on Robinhood Chain
    /// @param workflowId     from the forwarder metadata
    /// @param workflowName   from the forwarder metadata
    /// @param workflowOwner  from the forwarder metadata
    event RecordChecked(
        bytes32 indexed anchorTx,
        bytes32 indexed subject,
        bool indexed isMatch,
        uint32 reasons,
        bytes32 recomputedFactsHash,
        bytes32 anchoredFactsHash,
        uint64 asOf,
        uint64 anchorBlock,
        bytes32 workflowId,
        bytes10 workflowName,
        address workflowOwner
    );

    error ZeroForwarder();
    error NotForwarder(address sender);
    error BadMetadata(uint256 length);
    error BadReport(uint256 length);

    /// @dev 8 static ABI words: bytes32, bytes32, bool, uint32, bytes32, bytes32, uint64, uint64.
    uint256 internal constant REPORT_LENGTH = 8 * 32;

    constructor(address forwarder) {
        if (forwarder == address(0)) revert ZeroForwarder();
        FORWARDER = forwarder;
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != FORWARDER) revert NotForwarder(msg.sender);
        // workflowId (32) | workflowName (10) | workflowOwner (20) | reportId (2)
        if (metadata.length < 64) revert BadMetadata(metadata.length);
        if (report.length != REPORT_LENGTH) revert BadReport(report.length);

        bytes32 workflowId = bytes32(metadata[0:32]);
        bytes10 workflowName = bytes10(metadata[32:42]);
        address workflowOwner = address(bytes20(metadata[42:62]));

        (
            bytes32 anchorTx,
            bytes32 subject,
            bool isMatch,
            uint32 reasons,
            bytes32 recomputedFactsHash,
            bytes32 anchoredFactsHash,
            uint64 asOf,
            uint64 anchorBlock
        ) = abi.decode(report, (bytes32, bytes32, bool, uint32, bytes32, bytes32, uint64, uint64));

        emit RecordChecked(
            anchorTx,
            subject,
            isMatch,
            reasons,
            recomputedFactsHash,
            anchoredFactsHash,
            asOf,
            anchorBlock,
            workflowId,
            workflowName,
            workflowOwner
        );
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
