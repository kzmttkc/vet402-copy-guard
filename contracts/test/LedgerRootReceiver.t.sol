// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LedgerRootReceiver} from "../src/LedgerRootReceiver.sol";
import {IReceiver, IERC165} from "../src/RwaVerdictReceiver.sol";

contract LedgerRootReceiverTest is Test {
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

    bytes32 constant ROOT = keccak256("root");
    bytes32 constant MANDATE = keccak256("mandate");
    bytes32 constant LIMITS = keccak256("limits");
    bytes32 constant RULES = keccak256("rules");
    bytes32 constant WORKFLOW_ID = keccak256("vet402-trail-anchor");
    bytes10 constant WORKFLOW_NAME = bytes10("trail");
    address constant WORKFLOW_OWNER = address(0xC0FFEE);

    address forwarder = makeAddr("forwarder");
    LedgerRootReceiver receiver;

    function setUp() public {
        receiver = new LedgerRootReceiver(forwarder);
    }

    function _metadata() internal pure returns (bytes memory) {
        return abi.encodePacked(WORKFLOW_ID, WORKFLOW_NAME, WORKFLOW_OWNER, bytes2(0x0001));
    }

    function _report(uint32 decisions, uint32 full, uint32 reduced, uint32 none) internal pure returns (bytes memory) {
        return abi.encode(ROOT, MANDATE, LIMITS, RULES, decisions, full, reduced, none, uint64(87947981));
    }

    function test_emitsTheRoot() public {
        vm.expectEmit(true, true, true, true, address(receiver));
        emit LedgerAnchored(ROOT, MANDATE, LIMITS, RULES, 120, 1, 9, 110, 87947981, WORKFLOW_ID, WORKFLOW_NAME, WORKFLOW_OWNER);
        vm.prank(forwarder);
        receiver.onReport(_metadata(), _report(120, 1, 9, 110));
    }

    function test_rejectsCountsThatDoNotAddUp() public {
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(LedgerRootReceiver.BadCounts.selector, 120, 1, 9, 111));
        receiver.onReport(_metadata(), _report(120, 1, 9, 111));
    }

    function test_rejectsAnyoneButTheForwarder(address caller) public {
        vm.assume(caller != forwarder);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(LedgerRootReceiver.NotForwarder.selector, caller));
        receiver.onReport(_metadata(), _report(3, 1, 1, 1));
    }

    function test_rejectsWrongLengths() public {
        vm.startPrank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(LedgerRootReceiver.BadReport.selector, 32));
        receiver.onReport(_metadata(), abi.encode(ROOT));
        vm.expectRevert(abi.encodeWithSelector(LedgerRootReceiver.BadMetadata.selector, 10));
        receiver.onReport(new bytes(10), _report(3, 1, 1, 1));
        vm.stopPrank();
    }

    function test_rejectsZeroForwarder() public {
        vm.expectRevert(LedgerRootReceiver.ZeroForwarder.selector);
        new LedgerRootReceiver(address(0));
    }

    function test_supportsInterface() public view {
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(receiver.supportsInterface(type(IERC165).interfaceId));
        assertFalse(receiver.supportsInterface(0xffffffff));
    }

    function test_writesNoStorageAndHoldsNoEth() public {
        vm.record();
        vm.prank(forwarder);
        receiver.onReport(_metadata(), _report(3, 1, 1, 1));
        (, bytes32[] memory writes) = vm.accesses(address(receiver));
        assertEq(writes.length, 0);
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(receiver).call{value: 1}("");
        assertFalse(ok);
    }
}
