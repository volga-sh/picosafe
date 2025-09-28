// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title ITransactionGuard
 * @notice Interface for Safe transaction guards
 */
interface ITransactionGuard {
    function checkTransaction(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures,
        address msgSender
    ) external;

    function checkAfterExecution(bytes32 hash, bool success) external;
}

/**
 * @title TestGuard
 * @notice A simple test guard for Safe accounts that allows all transactions
 * @dev This guard is for testing purposes only and should not be used in production
 */
contract TestGuard is ITransactionGuard {
    uint256 public transactionCount;
    uint256 public executionCount;

    event TransactionChecked(
        address indexed to,
        uint256 value,
        uint8 operation,
        address msgSender
    );

    event ExecutionChecked(
        bytes32 indexed hash,
        bool success
    );

    /**
     * @notice Check a transaction before execution
     * @dev This test implementation allows all transactions and increments counter
     */
    function checkTransaction(
        address to,
        uint256 value,
        bytes memory,
        uint8 operation,
        uint256,
        uint256,
        uint256,
        address,
        address payable,
        bytes memory,
        address msgSender
    ) external override {
        transactionCount++;
        emit TransactionChecked(to, value, operation, msgSender);
    }

    /**
     * @notice Check after transaction execution
     * @dev This test implementation logs the execution result
     */
    function checkAfterExecution(bytes32 hash, bool success) external override {
        executionCount++;
        emit ExecutionChecked(hash, success);
    }

    /**
     * @notice Check if this contract implements the ITransactionGuard interface
     * @dev EIP-165 supportsInterface implementation
     */
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(ITransactionGuard).interfaceId;
    }
}