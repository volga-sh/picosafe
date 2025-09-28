// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title TestModule
 * @notice A minimal test module for Safe accounts that only increments its own counter
 * @dev This module is for testing/example purposes only
 */
contract TestModule {
    // Counter to track how many times the module executed
    uint256 public callCount;

    // Event emitted when the counter is incremented
    event CounterIncremented(address indexed safe, uint256 newCount);

    /**
     * @notice Execute a self-call from the Safe to increment counter
     * @param safe The Safe contract to execute from
     * @dev This demonstrates module execution but only calls back to itself
     */
    function executeFromSafe(address safe) external {
        // Prepare the calldata to increment our own counter
        bytes memory incrementCalldata = abi.encodeWithSignature("incrementCounter()");

        // Call execTransactionFromModule on the Safe to execute incrementCounter on this contract
        bytes memory moduleTransactionData = abi.encodeWithSignature(
            "execTransactionFromModule(address,uint256,bytes,uint8)",
            address(this), // to: this module contract
            0,             // value: 0 ETH
            incrementCalldata, // data: call incrementCounter()
            0              // operation: Call
        );

        (bool success, ) = safe.call(moduleTransactionData);
        require(success, "Module execution failed");
    }

    /**
     * @notice Increment the call counter
     * @dev This can only be called by the Safe through the module
     */
    function incrementCounter() external {
        callCount++;
        emit CounterIncremented(msg.sender, callCount);
    }

    /**
     * @notice Get the current call count
     * @return The number of times incrementCounter has been called
     */
    function getCallCount() external view returns (uint256) {
        return callCount;
    }
}