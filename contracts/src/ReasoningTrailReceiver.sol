// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IReceiver, IERC165} from "./RwaVerdictReceiver.sol";

/// @title ReasoningTrailReceiver
/// @notice Receives one decision of the copy-guard agent from the CRE trail workflow and emits it.
///
/// The agent writes a JSON trail per decision: what it read, which rules it ran, every
/// rule row and the conclusion. The CRE trail workflow runs the same rules on the trail's
/// own inputs, refuses to write when the conclusion does not follow, checks the movement
/// (and the payment, when there was one) on Robinhood Chain, and then delivers the trail's
/// keccak256 here. Anyone holding the JSON can hash it and find this event.
///
/// Same shape as RwaVerdictReceiver: no owner, no admin, no storage, no upgrade path, cannot
/// receive ETH, and only the forwarder fixed at deployment may call onReport.
contract ReasoningTrailReceiver is IReceiver, IERC165 {
    address public immutable FORWARDER;

    /// @param trailHash       keccak256 of the canonical JSON of the trail
    /// @param subject         keccak256 of the lower-cased watched wallet (same as RwaAnchor's subject)
    /// @param conclusion      0 HOLD, 1 DO_NOT_COPY, 2 COPY (a paper trade, never a real one)
    /// @param recordFactsHash vet402 factsHash of the record the decision read
    /// @param movementTx      the watched wallet's tx on Robinhood Chain 4663 that was judged
    /// @param verdictTx       the RwaVerdictReceiver tx of the CRE re-verification (zero when only simulated)
    /// @param paymentTx       the x402 settlement tx on Robinhood Chain 4663 (zero in a dry run)
    /// @param rulesVersion    version of the copy-guard rules
    event DecisionRecorded(
        bytes32 indexed trailHash,
        bytes32 indexed subject,
        uint8 indexed conclusion,
        bytes32 recordFactsHash,
        bytes32 movementTx,
        bytes32 verdictTx,
        bytes32 paymentTx,
        uint16 rulesVersion,
        bytes32 workflowId,
        bytes10 workflowName,
        address workflowOwner
    );

    error ZeroForwarder();
    error NotForwarder(address sender);
    error BadMetadata(uint256 length);
    error BadReport(uint256 length);
    error BadConclusion(uint8 conclusion);

    /// @dev 8 static ABI words: bytes32, bytes32, uint8, bytes32, bytes32, bytes32, bytes32, uint16.
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
            bytes32 trailHash,
            bytes32 subject,
            uint8 conclusion,
            bytes32 recordFactsHash,
            bytes32 movementTx,
            bytes32 verdictTx,
            bytes32 paymentTx,
            uint16 rulesVersion
        ) = abi.decode(report, (bytes32, bytes32, uint8, bytes32, bytes32, bytes32, bytes32, uint16));
        if (conclusion > 2) revert BadConclusion(conclusion);

        emit DecisionRecorded(
            trailHash,
            subject,
            conclusion,
            recordFactsHash,
            movementTx,
            verdictTx,
            paymentTx,
            rulesVersion,
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
