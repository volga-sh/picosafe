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

    // The Safe address that is currently authorized to call incrementCounter
    address private currentExecutingSafe;

    // Event emitted when the counter is incremented
    event CounterIncremented(address indexed safe, uint256 newCount);

    // Modifier to restrict access to only the currently executing Safe
    modifier onlySafe() {
        require(msg.sender == currentExecutingSafe, "Only the executing Safe can call this");
        _;
    }

    /**
     * @notice Execute a self-call from the Safe to increment counter
     * @param safe The Safe contract to execute from
     * @dev This demonstrates module execution but only calls back to itself
     */
    function executeFromSafe(address safe) external {
        // Set the Safe as authorized for this execution
        currentExecutingSafe = safe;

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

        (bool success, bytes memory returnData) = safe.call(moduleTransactionData);
        require(success, "Module call to Safe failed");

        // Verify that the Safe returned data indicating the inner transaction succeeded
        require(returnData.length > 0, "Safe returned no data");
        bool moduleSuccess = abi.decode(returnData, (bool));
        require(moduleSuccess, "Module execution failed in Safe");

        // Clear the authorized Safe after execution
        currentExecutingSafe = address(0);
    }

    /**
     * @notice Increment the call counter
     * @dev This can only be called by the Safe through the module execution flow
     */
    function incrementCounter() external onlySafe {
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