// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TokenCheckReceiver} from "../src/TokenCheckReceiver.sol";
import {IReceiver, IERC165} from "../src/RwaVerdictReceiver.sol";

contract TokenCheckReceiverTest is Test {
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

    bytes32 constant HASH = keccak256("rows");
    bytes32 constant LIST = keccak256("list");
    bytes32 constant BLOCK_HASH = keccak256("block");
    uint64 constant BLOCK = 87990000;
    bytes32 constant WORKFLOW_ID = keccak256("vet402-token-check");
    bytes10 constant WORKFLOW_NAME = bytes10("tokencheck");
    address constant WORKFLOW_OWNER = address(0xC0FFEE);

    address forwarder = makeAddr("forwarder");
    TokenCheckReceiver receiver;

    function setUp() public {
        receiver = new TokenCheckReceiver(forwarder);
    }

    function _metadata() internal pure returns (bytes memory) {
        return abi.encodePacked(WORKFLOW_ID, WORKFLOW_NAME, WORKFLOW_OWNER, bytes2(0x0001));
    }

    function _report(uint8 kind, bytes32 blockHash, uint32 tokens, uint32 issuerTokens, uint32 runs)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(kind, HASH, LIST, blockHash, BLOCK, tokens, issuerTokens, runs);
    }

    function test_kind1EmitsTheBatch() public {
        vm.expectEmit(true, true, true, true, address(receiver));
        emit TokenBatchChecked(HASH, LIST, BLOCK, BLOCK_HASH, 43, 35, WORKFLOW_ID, WORKFLOW_NAME, WORKFLOW_OWNER);
        vm.prank(forwarder);
        receiver.onReport(_metadata(), _report(1, BLOCK_HASH, 43, 35, 1));
    }

    function test_kind2EmitsTheResultsFile() public {
        vm.expectEmit(true, true, true, true, address(receiver));
        emit TokenCheckResultsAnchored(HASH, LIST, 43, 35, 2, BLOCK, WORKFLOW_ID, WORKFLOW_NAME, WORKFLOW_OWNER);
        vm.prank(forwarder);
        receiver.onReport(_metadata(), _report(2, bytes32(0), 43, 35, 2));
    }

    function test_theBatchTopicIsTheOneTheWorkflowLooksFor() public pure {
        assertEq(
            TokenBatchChecked.selector,
            keccak256("TokenBatchChecked(bytes32,bytes32,uint64,bytes32,uint32,uint32,bytes32,bytes10,address)")
        );
    }

    function test_rejectsAnUnknownKind(uint8 kind) public {
        vm.assume(kind != 1 && kind != 2);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(TokenCheckReceiver.BadKind.selector, kind));
        receiver.onReport(_metadata(), _report(kind, BLOCK_HASH, 3, 1, 1));
    }

    function test_rejectsCountsThatCannotBe() public {
        vm.startPrank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(TokenCheckReceiver.BadCounts.selector, 0, 0, 1));
        receiver.onReport(_metadata(), _report(1, BLOCK_HASH, 0, 0, 1));
        vm.expectRevert(abi.encodeWithSelector(TokenCheckReceiver.BadCounts.selector, 3, 4, 1));
        receiver.onReport(_metadata(), _report(1, BLOCK_HASH, 3, 4, 1));
        vm.expectRevert(abi.encodeWithSelector(TokenCheckReceiver.BadCounts.selector, 3, 1, 0));
        receiver.onReport(_metadata(), _report(2, bytes32(0), 3, 1, 0));
        vm.stopPrank();
    }

    function test_rejectsAnyoneButTheForwarder(address caller) public {
        vm.assume(caller != forwarder);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(TokenCheckReceiver.NotForwarder.selector, caller));
        receiver.onReport(_metadata(), _report(1, BLOCK_HASH, 3, 1, 1));
    }

    function test_rejectsWrongLengths() public {
        vm.startPrank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(TokenCheckReceiver.BadReport.selector, 32));
        receiver.onReport(_metadata(), abi.encode(HASH));
        vm.expectRevert(abi.encodeWithSelector(TokenCheckReceiver.BadMetadata.selector, 10));
        receiver.onReport(new bytes(10), _report(1, BLOCK_HASH, 3, 1, 1));
        vm.stopPrank();
    }

    function test_rejectsZeroForwarder() public {
        vm.expectRevert(TokenCheckReceiver.ZeroForwarder.selector);
        new TokenCheckReceiver(address(0));
    }

    function test_supportsInterface() public view {
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(receiver.supportsInterface(type(IERC165).interfaceId));
        assertFalse(receiver.supportsInterface(0xffffffff));
    }

    function test_writesNoStorageAndHoldsNoEth() public {
        vm.record();
        vm.prank(forwarder);
        receiver.onReport(_metadata(), _report(1, BLOCK_HASH, 3, 1, 1));
        (, bytes32[] memory writes) = vm.accesses(address(receiver));
        assertEq(writes.length, 0);
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(receiver).call{value: 1}("");
        assertFalse(ok);
    }
}
