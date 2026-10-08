// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ReasoningTrailReceiver} from "../src/ReasoningTrailReceiver.sol";
import {IReceiver, IERC165} from "../src/RwaVerdictReceiver.sol";

contract ReasoningTrailReceiverTest is Test {
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

    bytes32 constant TRAIL = keccak256("trail");
    bytes32 constant SUBJECT = 0xa158baaf573f2b072b47acaa019ef60de680571a8a2a6ad234faf0e8a3d3bfc5;
    bytes32 constant FACTS = keccak256("facts");
    bytes32 constant MOVE = keccak256("move");
    bytes32 constant VERDICT = keccak256("verdict");
    bytes32 constant WORKFLOW_ID = keccak256("vet402-trail-anchor");
    bytes10 constant WORKFLOW_NAME = bytes10("trail");
    address constant WORKFLOW_OWNER = address(0xC0FFEE);

    address forwarder = makeAddr("forwarder");
    ReasoningTrailReceiver receiver;

    function setUp() public {
        receiver = new ReasoningTrailReceiver(forwarder);
    }

    function _metadata() internal pure returns (bytes memory) {
        return abi.encodePacked(WORKFLOW_ID, WORKFLOW_NAME, WORKFLOW_OWNER, bytes2(0x0001));
    }

    function _report(uint8 conclusion) internal pure returns (bytes memory) {
        return abi.encode(TRAIL, SUBJECT, conclusion, FACTS, MOVE, VERDICT, bytes32(0), uint16(1));
    }

    function test_emitsDecision() public {
        vm.expectEmit(true, true, true, true, address(receiver));
        emit DecisionRecorded(
            TRAIL, SUBJECT, 1, FACTS, MOVE, VERDICT, bytes32(0), 1, WORKFLOW_ID, WORKFLOW_NAME, WORKFLOW_OWNER
        );
        vm.prank(forwarder);
        receiver.onReport(_metadata(), _report(1));
    }

    function test_rejectsZeroForwarder() public {
        vm.expectRevert(ReasoningTrailReceiver.ZeroForwarder.selector);
        new ReasoningTrailReceiver(address(0));
    }

    function test_rejectsAnyoneButTheForwarder(address caller) public {
        vm.assume(caller != forwarder);
        vm.expectRevert(abi.encodeWithSelector(ReasoningTrailReceiver.NotForwarder.selector, caller));
        vm.prank(caller);
        receiver.onReport(_metadata(), _report(0));
    }

    function test_rejectsUnknownConclusion() public {
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ReasoningTrailReceiver.BadConclusion.selector, 3));
        receiver.onReport(_metadata(), _report(3));
    }

    function test_rejectsWrongLengths() public {
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ReasoningTrailReceiver.BadMetadata.selector, 63));
        receiver.onReport(new bytes(63), _report(0));
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ReasoningTrailReceiver.BadReport.selector, 224));
        receiver.onReport(_metadata(), new bytes(224));
    }

    function test_writesNoStorageAndHoldsNoEth() public {
        vm.record();
        vm.prank(forwarder);
        receiver.onReport(_metadata(), _report(2));
        (, bytes32[] memory writes) = vm.accesses(address(receiver));
        assertEq(writes.length, 0);
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(receiver).call{value: 1}("");
        assertFalse(ok);
    }

    function test_supportsInterface() public view {
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(receiver.supportsInterface(type(IERC165).interfaceId));
        assertFalse(receiver.supportsInterface(0xffffffff));
    }
}
