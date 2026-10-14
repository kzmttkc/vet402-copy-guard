// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IReceiver, IERC165} from "./RwaVerdictReceiver.sol";

/// @title LedgerRootReceiver
/// @notice Receives the Merkle root of one walk of the copy-guard practice ledger and emits it.
///
/// A walk decides many moves, one after another. Each decision is a JSON trail, and the
/// keccak256 of its canonical JSON is a leaf. The CRE trail workflow recomputes the root
/// from the leaves it is given and delivers it here with the hashes of the mandate, the
/// user's limits and the rules, and the number of decisions by size. Anyone holding the
/// trails can hash them, rebuild the root and find this event.
///
/// Same shape as the other two receivers: no owner, no admin, no storage, no upgrade
/// path, cannot receive ETH, and only the forwarder fixed at deployment may call onReport.
contract LedgerRootReceiver is IReceiver, IERC165 {
    address public immutable FORWARDER;

    /// @param root        Merkle root over the trail hashes, in walk order
    /// @param mandateHash keccak256 of the canonical JSON of the mandate every decision names
    /// @param limitsHash  keccak256 of the canonical JSON of the user's limits
    /// @param rulesHash   keccak256 of the canonical JSON naming the rules (id, version, source hashes)
    /// @param decisions   how many decisions the root covers
    /// @param full        decisions that opened a full practice position
    /// @param reduced     decisions that opened a reduced practice position
    /// @param none        decisions that opened nothing
    /// @param markBlock   the Robinhood Chain block the ledger was marked at
    event LedgerAnchored(
        bytes32 indexed root,
        bytes32 indexed mandateHash,
        bytes32 indexed limitsHash,
        bytes32 rulesHash,
        uint32 decisions,
        uint32 full,
        uint32 reduced,
        uint32 none,
        uint64 markBlock,
        bytes32 workflowId,
        bytes10 workflowName,
        address workflowOwner
    );

    error ZeroForwarder();
    error NotForwarder(address sender);
    error BadMetadata(uint256 length);
    error BadReport(uint256 length);
    error BadCounts(uint32 decisions, uint32 full, uint32 reduced, uint32 none);

    /// @dev 9 static ABI words.
    uint256 internal constant REPORT_LENGTH = 9 * 32;

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
            bytes32 root,
            bytes32 mandateHash,
            bytes32 limitsHash,
            bytes32 rulesHash,
            uint32 decisions,
            uint32 full,
            uint32 reduced,
            uint32 none,
            uint64 markBlock
        ) = abi.decode(report, (bytes32, bytes32, bytes32, bytes32, uint32, uint32, uint32, uint32, uint64));
        if (uint256(full) + reduced + none != decisions) revert BadCounts(decisions, full, reduced, none);

        emit LedgerAnchored(
            root,
            mandateHash,
            limitsHash,
            rulesHash,
            decisions,
            full,
            reduced,
            none,
            markBlock,
            bytes32(metadata[0:32]),
            bytes10(metadata[32:42]),
            address(bytes20(metadata[42:62]))
        );
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
