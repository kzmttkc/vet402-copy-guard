// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {RwaVerdictReceiver, IReceiver, IERC165} from "../src/RwaVerdictReceiver.sol";

/// @dev The report bytes below are what rwa-verify/workflow.ts `encodeVerdict` produces
/// for the real anchor tx 0x15f9...5c7f (MATCH) and for the same record with one
/// character changed (MISMATCH). Regenerate them from the workflow if the ABI changes.
abstract contract Fixtures {
    bytes32 constant ANCHOR_TX = 0x15f9ed8ae5dd466c2f35021c9f1291e7a624abbb52c8ac26b54d47442f585c7f;
    bytes32 constant SUBJECT = 0xa158baaf573f2b072b47acaa019ef60de680571a8a2a6ad234faf0e8a3d3bfc5;
    bytes32 constant FACTS_HASH = 0x9d0e83d968786570beebf0d322b36e0836dc81ebe896bd186304405ba8f721ee;
    bytes32 constant TAMPERED_HASH = 0x29175278b6592826d444b57a80964b250f16efc7943d393a48b6d66ced0e0d99;
    uint64 constant AS_OF = 1790737207;
    uint64 constant ANCHOR_BLOCK = 76177721;

    bytes constant MATCH_REPORT =
        hex"15f9ed8ae5dd466c2f35021c9f1291e7a624abbb52c8ac26b54d47442f585c7fa158baaf573f2b072b47acaa019ef60de680571a8a2a6ad234faf0e8a3d3bfc5000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000009d0e83d968786570beebf0d322b36e0836dc81ebe896bd186304405ba8f721ee9d0e83d968786570beebf0d322b36e0836dc81ebe896bd186304405ba8f721ee000000000000000000000000000000000000000000000000000000006abc7b3700000000000000000000000000000000000000000000000000000000048a6139";
    bytes constant MISMATCH_REPORT =
        hex"15f9ed8ae5dd466c2f35021c9f1291e7a624abbb52c8ac26b54d47442f585c7fa158baaf573f2b072b47acaa019ef60de680571a8a2a6ad234faf0e8a3d3bfc50000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012029175278b6592826d444b57a80964b250f16efc7943d393a48b6d66ced0e0d999d0e83d968786570beebf0d322b36e0836dc81ebe896bd186304405ba8f721ee000000000000000000000000000000000000000000000000000000006abc7b3700000000000000000000000000000000000000000000000000000000048a6139";

    bytes32 constant WORKFLOW_ID = keccak256("vet402-rwa-verify");
    bytes10 constant WORKFLOW_NAME = bytes10("rwa-verify");
    address constant WORKFLOW_OWNER = address(0xC0FFEE);
}

contract RwaVerdictReceiverTest is Test, Fixtures {
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

    address forwarder = makeAddr("forwarder");
    RwaVerdictReceiver receiver;

    function setUp() public {
        receiver = new RwaVerdictReceiver(forwarder);
    }

    function _metadata() internal pure returns (bytes memory) {
        return abi.encodePacked(WORKFLOW_ID, WORKFLOW_NAME, WORKFLOW_OWNER, bytes2(0x0001));
    }

    function test_constructor_rejectsZeroForwarder() public {
        vm.expectRevert(RwaVerdictReceiver.ZeroForwarder.selector);
        new RwaVerdictReceiver(address(0));
    }

    function test_forwarderIsFixed() public view {
        assertEq(receiver.FORWARDER(), forwarder);
    }

    function test_match_emitsVerdict() public {
        vm.expectEmit(true, true, true, true, address(receiver));
        emit RecordChecked(
            ANCHOR_TX,
            SUBJECT,
            true,
            0,
            FACTS_HASH,
            FACTS_HASH,
            AS_OF,
            ANCHOR_BLOCK,
            WORKFLOW_ID,
            WORKFLOW_NAME,
            WORKFLOW_OWNER
        );
        vm.prank(forwarder);
        receiver.onReport(_metadata(), MATCH_REPORT);
    }

    function test_mismatch_emitsVerdictWithReasons() public {
        // 288 = FACTS_HASH (32) | RECORD_FACTS_HASH (256)
        vm.expectEmit(true, true, true, true, address(receiver));
        emit RecordChecked(
            ANCHOR_TX,
            SUBJECT,
            false,
            288,
            TAMPERED_HASH,
            FACTS_HASH,
            AS_OF,
            ANCHOR_BLOCK,
            WORKFLOW_ID,
            WORKFLOW_NAME,
            WORKFLOW_OWNER
        );
        vm.prank(forwarder);
        receiver.onReport(_metadata(), MISMATCH_REPORT);
    }

    function test_onReport_rejectsAnyoneButTheForwarder(address caller) public {
        vm.assume(caller != forwarder);
        vm.expectRevert(abi.encodeWithSelector(RwaVerdictReceiver.NotForwarder.selector, caller));
        vm.prank(caller);
        receiver.onReport(_metadata(), MATCH_REPORT);
    }

    function test_onReport_rejectsShortMetadata() public {
        vm.expectRevert(abi.encodeWithSelector(RwaVerdictReceiver.BadMetadata.selector, 63));
        vm.prank(forwarder);
        receiver.onReport(new bytes(63), MATCH_REPORT);
    }

    function test_onReport_rejectsWrongReportLength() public {
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(RwaVerdictReceiver.BadReport.selector, 255));
        receiver.onReport(_metadata(), new bytes(255));

        bytes memory longer = abi.encodePacked(MATCH_REPORT, bytes32(0));
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(RwaVerdictReceiver.BadReport.selector, 288));
        receiver.onReport(_metadata(), longer);
    }

    function test_onReport_rejectsNonBooleanMatch() public {
        bytes memory bad = MATCH_REPORT;
        bad[95] = 0x02; // isMatch word = 2
        vm.prank(forwarder);
        vm.expectRevert();
        receiver.onReport(_metadata(), bad);
    }

    function test_supportsInterface() public view {
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(receiver.supportsInterface(type(IERC165).interfaceId));
        assertFalse(receiver.supportsInterface(0xffffffff));
        assertFalse(receiver.supportsInterface(0x00000000));
    }

    function test_cannotReceiveEth() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(receiver).call{value: 1 wei}("");
        assertFalse(ok);
        vm.prank(forwarder);
        vm.deal(forwarder, 1 ether);
        (ok,) = address(receiver).call{value: 1 wei}(
            abi.encodeCall(RwaVerdictReceiver.onReport, (_metadata(), MATCH_REPORT))
        );
        assertFalse(ok);
        assertEq(address(receiver).balance, 0);
    }

    function test_hasNoOwnerFunctions() public {
        bytes4[4] memory sels = [
            bytes4(keccak256("owner()")),
            bytes4(keccak256("transferOwnership(address)")),
            bytes4(keccak256("renounceOwnership()")),
            bytes4(keccak256("upgradeTo(address)"))
        ];
        for (uint256 i = 0; i < sels.length; i++) {
            (bool ok,) = address(receiver).call(abi.encodePacked(sels[i], bytes32(0)));
            assertFalse(ok);
        }
    }

    function test_writesNoStorage() public {
        vm.record();
        vm.prank(forwarder);
        receiver.onReport(_metadata(), MATCH_REPORT);
        (, bytes32[] memory writes) = vm.accesses(address(receiver));
        assertEq(writes.length, 0);
    }
}

interface IMockKeystoneForwarder {
    function report(
        address receiver,
        bytes calldata rawReport,
        bytes calldata reportContext,
        bytes[] calldata signatures
    ) external;
}

/// @notice Runs the real MockKeystoneForwarder that `cre workflow simulate` uses on
/// Robinhood Testnet, in a local fork. Nothing is sent to the network.
/// Set ROBINHOOD_TESTNET_RPC to run it, for example https://rpc.testnet.chain.robinhood.com
contract RwaVerdictReceiverForkTest is Test, Fixtures {
    /// MockKeystoneForwarder on robinhood-testnet (docs.chain.link/cre forwarder directory)
    address constant MOCK_FORWARDER = 0x0b93082D9b3C7C97fAcd250082899BAcf3af3885;

    event ReportProcessed(
        address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result
    );

    function test_fork_mockForwarderDeliversTheMatchReport() public {
        string memory rpc = vm.envOr("ROBINHOOD_TESTNET_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        assertGt(MOCK_FORWARDER.code.length, 0);

        RwaVerdictReceiver receiver = new RwaVerdictReceiver(MOCK_FORWARDER);
        bytes memory payload = MATCH_REPORT;

        // Forwarder metadata (109 bytes): version 1 | executionId 32 | timestamp 4 | donId 4 |
        // donConfigVersion 4 | workflowId 32 | workflowName 10 | workflowOwner 20 | reportId 2
        bytes32 execId = keccak256("execution-1");
        bytes memory raw = abi.encodePacked(
            uint8(1),
            execId,
            uint32(block.timestamp),
            uint32(1),
            uint32(1),
            WORKFLOW_ID,
            WORKFLOW_NAME,
            WORKFLOW_OWNER,
            bytes2(0x0001),
            payload
        );
        assertEq(raw.length, 109 + 256);

        vm.recordLogs();
        IMockKeystoneForwarder(MOCK_FORWARDER).report(address(receiver), raw, "", new bytes[](0));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bool sawVerdict;
        bool delivered;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(receiver)) {
                sawVerdict = true;
                assertEq(logs[i].topics[1], ANCHOR_TX);
                assertEq(logs[i].topics[2], SUBJECT);
                assertEq(logs[i].topics[3], bytes32(uint256(1)));
            }
            if (logs[i].emitter == MOCK_FORWARDER && logs[i].topics[0] == ReportProcessed.selector) {
                delivered = abi.decode(logs[i].data, (bool));
            }
        }
        assertTrue(sawVerdict, "receiver emitted no RecordChecked");
        assertTrue(delivered, "forwarder reported a failed delivery");
    }
}
