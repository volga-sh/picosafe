/**
 * @fileoverview Integration tests for Safe owner management functionality.
 *
 * These tests verify that Safe owner add/remove/threshold transactions work correctly, including:
 * - Proper encoding of addOwnerWithThreshold, removeOwner, and changeThreshold calls
 * - Correct handling of owner linked list structure
 * - Safe transaction structure validation
 * - Error handling for invalid owner operations
 *
 * Tests run against a local Anvil blockchain with real Safe contracts deployed.
 */

import { Address } from "ox";
import { encodeFunctionData, parseAbi } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOwners } from "../src/account-state";
import { deploySafeAccount } from "../src/deployment";
import {
	getAddOwnerTransaction,
	getChangeThresholdTransaction,
	getRemoveOwnerTransaction,
	getSwapOwnerTransaction,
} from "../src/owners";
import { SENTINEL_NODE, ZERO_ADDRESS } from "../src/utilities/constants";
import { createClients, snapshot } from "./fixtures/setup";
import { randomAddress } from "./utils";

// Safe owner management ABI - these functions are not in the main Safe ABI
const SAFE_OWNER_ABI = parseAbi([
	"function addOwnerWithThreshold(address owner, uint256 _threshold)",
	"function removeOwner(address prevOwner, address owner, uint256 _threshold)",
	"function swapOwner(address prevOwner, address oldOwner, address newOwner)",
	"function changeThreshold(uint256 _threshold)",
]);

describe("Safe Owner Management Functions - owners.ts", () => {
	const clients = createClients();
	const { testClient, publicClient, walletClients } = clients;
	const walletClient = walletClients[0];
	let resetSnapshot: () => Promise<void>;

	beforeEach(async () => {
		resetSnapshot = await snapshot(testClient);
	});

	afterEach(async () => {
		await resetSnapshot();
	});

	describe("Address casing support", () => {
		// We only test getRemoveOwnerTransaction since it is the only function that uses the owner address to do a lookup in the linked list
		it("should build identical transactions for checksum and lowercase owner addresses in getRemoveOwnerTransaction", async () => {
			const safeAddress = randomAddress();
			const ownerToRemoveLower = randomAddress();
			const ownerToRemoveChecksum = Address.checksum(ownerToRemoveLower);
			const newThreshold = 1n;

			// Build tx with lowercase input, explicit nonce to avoid reading from blockchain
			const txLower = await getRemoveOwnerTransaction(
				walletClient,
				safeAddress,
				{
					ownerToRemove: ownerToRemoveLower,
					newThreshold,
					prevOwner: SENTINEL_NODE,
				},
				{ nonce: 0n },
			);

			// Build tx with checksum input, explicit nonce to avoid reading from blockchain
			const txChecksum = await getRemoveOwnerTransaction(
				walletClient,
				safeAddress,
				{
					ownerToRemove: ownerToRemoveChecksum,
					newThreshold,
					prevOwner: SENTINEL_NODE,
				},
				{ nonce: 0n },
			);

			// Transactions should be identical
			expect(txLower.data).toBe(txChecksum.data);
			expect(txLower.to).toBe(txChecksum.to);
			expect(txLower.nonce).toBe(txChecksum.nonce);
			expect(txLower.safeTxGas).toBe(txChecksum.safeTxGas);
			expect(txLower.baseGas).toBe(txChecksum.baseGas);
			expect(txLower.gasPrice).toBe(txChecksum.gasPrice);
			expect(txLower.gasToken).toBe(txChecksum.gasToken);
			expect(txLower.refundReceiver).toBe(txChecksum.refundReceiver);
			expect(txLower.operation).toBe(txChecksum.operation);
		});
	});

	describe("getAddOwnerTransaction", () => {
		it("should build correct Safe transaction for adding an owner", async () => {
			const safeAddress = Address.checksum(randomAddress());
			const newOwner = Address.checksum(randomAddress());
			const newThreshold = 2n;

			// Build the add owner transaction with explicit nonce to avoid reading from blockchain
			const addOwnerTx = await getAddOwnerTransaction(
				walletClient,
				safeAddress,
				{ newOwner, newThreshold },
				{ nonce: 0n },
			);

			expect(addOwnerTx.safeAddress).toBe(safeAddress);
			expect(addOwnerTx.to).toBe(safeAddress);
			expect(addOwnerTx.value).toBe(0n);
			expect(addOwnerTx.operation).toBe(0); // Call operation
			expect(addOwnerTx.nonce).toBe(0n);
			expect(addOwnerTx.safeTxGas).toBe(0n);
			expect(addOwnerTx.baseGas).toBe(0n);
			expect(addOwnerTx.gasPrice).toBe(0n);
			expect(addOwnerTx.gasToken).toBe(ZERO_ADDRESS);
			expect(addOwnerTx.refundReceiver).toBe(ZERO_ADDRESS);

			// Verify the transaction data contains addOwnerWithThreshold call using ABI
			const expectedData = encodeFunctionData({
				abi: SAFE_OWNER_ABI,
				functionName: "addOwnerWithThreshold",
				args: [newOwner, BigInt(newThreshold)],
			});
			expect(addOwnerTx.data.toLowerCase()).toBe(expectedData.toLowerCase());
		});

		it("should build transaction with custom transaction options", async () => {
			const safeAddress = Address.checksum(randomAddress());
			const newOwner = Address.checksum(randomAddress());
			const gasToken = Address.checksum(randomAddress());
			const refundReceiver = Address.checksum(randomAddress());
			const newThreshold = 3n;

			// Build the add owner transaction with custom options
			const addOwnerTx = await getAddOwnerTransaction(
				walletClient,
				safeAddress,
				{ newOwner, newThreshold },
				{
					nonce: 5n,
					safeTxGas: 100000n,
					baseGas: 30000n,
					gasPrice: 1000000000n,
					gasToken,
					refundReceiver,
				},
			);

			expect(addOwnerTx.safeAddress).toBe(safeAddress);
			expect(addOwnerTx.to).toBe(safeAddress);
			expect(addOwnerTx.value).toBe(0n);
			expect(addOwnerTx.nonce).toBe(5n);
			expect(addOwnerTx.safeTxGas).toBe(100000n);
			expect(addOwnerTx.baseGas).toBe(30000n);
			expect(addOwnerTx.gasPrice).toBe(1000000000n);
			expect(addOwnerTx.gasToken).toBe(gasToken);
			expect(addOwnerTx.refundReceiver).toBe(refundReceiver);
			expect(addOwnerTx.operation).toBe(0); // Call operation
		});

		it("should handle multiple add owner operations with different owners", async () => {
			// Use random addresses - no need to deploy Safe for transaction building
			const safeAddress = Address.checksum(randomAddress());
			const newOwners = [
				Address.checksum(randomAddress()),
				Address.checksum(randomAddress()),
			] as const;
			const thresholds = [2n, 3n, 4n] as const;

			// Build add owner transactions for each owner with explicit nonce to avoid reading from blockchain
			const addOwnerTxs = await Promise.all(
				newOwners.map((newOwner, index) =>
					getAddOwnerTransaction(
						walletClient,
						safeAddress,
						{ newOwner, newThreshold: thresholds[index] || 1n },
						{
							nonce: 0n,
						},
					),
				),
			);

			// Verify all transactions have correct structure
			for (const [index, addOwnerTx] of addOwnerTxs.entries()) {
				expect(addOwnerTx.safeAddress).toBe(safeAddress);
				expect(addOwnerTx.to).toBe(safeAddress);
				expect(addOwnerTx.value).toBe(0n);
				expect(addOwnerTx.operation).toBe(0); // Call operation
				expect(addOwnerTx.nonce).toBe(0n);

				// Verify the transaction data contains correct owner address using ABI
				const newOwner = newOwners[index];
				const threshold = thresholds[index];
				if (!newOwner || threshold === undefined) {
					throw new Error(`Owner or threshold at index ${index} is undefined`);
				}
				const expectedData = encodeFunctionData({
					abi: SAFE_OWNER_ABI,
					functionName: "addOwnerWithThreshold",
					args: [newOwner, BigInt(threshold)],
				});
				expect(addOwnerTx.data.toLowerCase()).toBe(expectedData.toLowerCase());
			}
		});

		it("should read the nonce from the blockchain if not provided", async () => {
			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			// Build add owner transaction without nonce
			const addOwnerTx = await getAddOwnerTransaction(
				walletClient,
				safeAddress,
				{ newOwner: walletClients[1].account.address, newThreshold: 2n },
			);

			// Verify the transaction nonce is read from the blockchain
			expect(addOwnerTx.nonce).toBe(0n);
		});
	});

	describe("getRemoveOwnerTransaction", () => {
		it("should throw error when trying to remove an owner that doesn't exist", async () => {
			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			const nonExistentOwner = randomAddress();

			await expect(
				getRemoveOwnerTransaction(walletClient, safeAddress, {
					ownerToRemove: nonExistentOwner,
					newThreshold: 1n,
				}),
			).rejects.toThrow(
				`Owner ${nonExistentOwner} not found in Safe ${safeAddress}`,
			);
		});

		it("should build correct Safe transaction for removing an owner", async () => {
			const owner1 = walletClient.account.address;
			const owner2 = walletClients[1].account.address;
			const owner3 = walletClients[2].account.address;

			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [owner1, owner2, owner3],
				threshold: 2n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			const removeOwnerTx = await getRemoveOwnerTransaction(
				walletClient,
				safeAddress,
				{ ownerToRemove: owner2, newThreshold: 1n },
			);

			// Verify the transaction details
			expect(removeOwnerTx.safeAddress).toBe(safeAddress);
			expect(removeOwnerTx.to).toBe(safeAddress);
			expect(removeOwnerTx.value).toBe(0n);
			expect(removeOwnerTx.operation).toBe(0); // Call operation
			expect(removeOwnerTx.nonce).toBe(0n);
			expect(removeOwnerTx.safeTxGas).toBe(0n);
			expect(removeOwnerTx.baseGas).toBe(0n);
			expect(removeOwnerTx.gasPrice).toBe(0n);
			expect(removeOwnerTx.gasToken).toBe(ZERO_ADDRESS);
			expect(removeOwnerTx.refundReceiver).toBe(ZERO_ADDRESS);

			// Get owners to find the previous owner
			const owners = await getOwners(walletClient, { safeAddress });
			const ownerIndex = owners.indexOf(owner2);
			const prevOwner =
				ownerIndex === 0 ? SENTINEL_NODE : owners[ownerIndex - 1];
			if (!prevOwner) {
				throw new Error("No previous owner found");
			}

			// Verify full data encoding
			const expectedData = encodeFunctionData({
				abi: SAFE_OWNER_ABI,
				functionName: "removeOwner",
				args: [prevOwner, owner2, BigInt(1)],
			});
			expect(removeOwnerTx.data.toLowerCase()).toBe(expectedData.toLowerCase());
		});

		it("should handle removing the first owner in the linked list", async () => {
			const owner1 = walletClient.account.address;
			const owner2 = walletClients[1].account.address;
			const owner3 = walletClients[2].account.address;

			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [owner1, owner2, owner3],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			// Get initial owners to verify order
			const initialOwners = await getOwners(walletClient, { safeAddress });
			const firstOwner = initialOwners[0];
			if (!firstOwner) {
				throw new Error("No first owner found");
			}

			// Build remove owner transaction for the first owner
			const removeOwnerTx = await getRemoveOwnerTransaction(
				walletClient,
				safeAddress,
				{
					ownerToRemove: firstOwner,
					newThreshold: 1n,
				},
			);

			// Verify the transaction uses SENTINEL_NODE as prevOwner
			const expectedData = encodeFunctionData({
				abi: SAFE_OWNER_ABI,
				functionName: "removeOwner",
				args: [SENTINEL_NODE, firstOwner, BigInt(1)],
			});
			expect(removeOwnerTx.data.toLowerCase()).toBe(expectedData.toLowerCase());
		});

		it("should build transaction with custom transaction options", async () => {
			const owner1 = walletClient.account.address;
			const owner2 = walletClients[1].account.address;
			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [owner1, owner2],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			const gasToken = Address.checksum(randomAddress());
			const refundReceiver = Address.checksum(randomAddress());
			const removeOwnerTx = await getRemoveOwnerTransaction(
				walletClient,
				safeAddress,
				{ ownerToRemove: owner2, newThreshold: 1n },
				{
					nonce: 5n,
					safeTxGas: 100000n,
					baseGas: 30000n,
					gasPrice: 1000000000n,
					gasToken,
					refundReceiver,
				},
			);

			expect(removeOwnerTx.nonce).toBe(5n);
			expect(removeOwnerTx.safeTxGas).toBe(100000n);
			expect(removeOwnerTx.baseGas).toBe(30000n);
			expect(removeOwnerTx.gasPrice).toBe(1000000000n);
			expect(removeOwnerTx.gasToken).toBe(gasToken);
			expect(removeOwnerTx.refundReceiver).toBe(refundReceiver);
		});
	});

	describe("getSwapOwnerTransaction", () => {
		it("should throw error when trying to swap an owner that doesn't exist", async () => {
			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			const nonExistentOwner = randomAddress();
			const newOwner = randomAddress();

			await expect(
				getSwapOwnerTransaction(walletClient, safeAddress, {
					oldOwner: nonExistentOwner,
					newOwner,
				}),
			).rejects.toThrow(
				`Owner ${nonExistentOwner} not found in Safe ${safeAddress}`,
			);
		});

		it("should build correct Safe transaction for swapping an owner", async () => {
			const owner1 = walletClient.account.address;
			const owner2 = walletClients[1].account.address;
			const owner3 = walletClients[2].account.address;
			const newOwner = randomAddress();

			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [owner1, owner2, owner3],
				threshold: 2n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			const swapOwnerTx = await getSwapOwnerTransaction(
				walletClient,
				safeAddress,
				{
					oldOwner: owner2,
					newOwner,
				},
			);

			// Verify the transaction details
			expect(swapOwnerTx.safeAddress).toBe(safeAddress);
			expect(swapOwnerTx.to).toBe(safeAddress);
			expect(swapOwnerTx.value).toBe(0n);
			expect(swapOwnerTx.operation).toBe(0); // Call operation
			expect(swapOwnerTx.nonce).toBe(0n);
			expect(swapOwnerTx.safeTxGas).toBe(0n);
			expect(swapOwnerTx.baseGas).toBe(0n);
			expect(swapOwnerTx.gasPrice).toBe(0n);
			expect(swapOwnerTx.gasToken).toBe(ZERO_ADDRESS);
			expect(swapOwnerTx.refundReceiver).toBe(ZERO_ADDRESS);

			// Get owners to find the previous owner
			const owners = await getOwners(walletClient, { safeAddress });
			const ownerIndex = owners.indexOf(owner2);
			const prevOwner =
				ownerIndex === 0 ? SENTINEL_NODE : owners[ownerIndex - 1];
			if (!prevOwner) {
				throw new Error("No previous owner found");
			}

			// Verify full data encoding
			const expectedData = encodeFunctionData({
				abi: SAFE_OWNER_ABI,
				functionName: "swapOwner",
				args: [prevOwner, owner2, newOwner],
			});
			expect(swapOwnerTx.data.toLowerCase()).toBe(expectedData.toLowerCase());
		});

		it("should handle swapping the first owner in the linked list", async () => {
			const owner1 = walletClient.account.address;
			const owner2 = walletClients[1].account.address;
			const owner3 = walletClients[2].account.address;
			const newOwner = randomAddress();

			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [owner1, owner2, owner3],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			// Get initial owners to verify order
			const initialOwners = await getOwners(walletClient, { safeAddress });
			const firstOwner = initialOwners[0];
			if (!firstOwner) {
				throw new Error("No first owner found");
			}

			// Build swap owner transaction for the first owner
			const swapOwnerTx = await getSwapOwnerTransaction(
				walletClient,
				safeAddress,
				{
					oldOwner: firstOwner,
					newOwner,
				},
			);

			// Verify the transaction uses SENTINEL_NODE as prevOwner
			const expectedData = encodeFunctionData({
				abi: SAFE_OWNER_ABI,
				functionName: "swapOwner",
				args: [SENTINEL_NODE, firstOwner, newOwner],
			});
			expect(swapOwnerTx.data.toLowerCase()).toBe(expectedData.toLowerCase());
		});

		it("should build transaction with custom transaction options", async () => {
			const owner1 = walletClient.account.address;
			const owner2 = walletClients[1].account.address;
			const newOwner = randomAddress();
			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [owner1, owner2],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			const gasToken = Address.checksum(randomAddress());
			const refundReceiver = Address.checksum(randomAddress());
			const swapOwnerTx = await getSwapOwnerTransaction(
				walletClient,
				safeAddress,
				{ oldOwner: owner2, newOwner },
				{
					nonce: 5n,
					safeTxGas: 100000n,
					baseGas: 30000n,
					gasPrice: 1000000000n,
					gasToken,
					refundReceiver,
				},
			);

			expect(swapOwnerTx.nonce).toBe(5n);
			expect(swapOwnerTx.safeTxGas).toBe(100000n);
			expect(swapOwnerTx.baseGas).toBe(30000n);
			expect(swapOwnerTx.gasPrice).toBe(1000000000n);
			expect(swapOwnerTx.gasToken).toBe(gasToken);
			expect(swapOwnerTx.refundReceiver).toBe(refundReceiver);
		});

		it("should build identical transactions for checksum and lowercase owner addresses", async () => {
			const safeAddress = randomAddress();
			const oldOwnerLower = randomAddress();
			const oldOwnerChecksum = Address.checksum(oldOwnerLower);
			const newOwner = randomAddress();

			// Build tx with lowercase input, explicit nonce and prevOwner to avoid reading from blockchain
			const txLower = await getSwapOwnerTransaction(
				walletClient,
				safeAddress,
				{
					oldOwner: oldOwnerLower,
					newOwner,
					prevOwner: SENTINEL_NODE,
				},
				{ nonce: 0n },
			);

			// Build tx with checksum input, explicit nonce and prevOwner to avoid reading from blockchain
			const txChecksum = await getSwapOwnerTransaction(
				walletClient,
				safeAddress,
				{
					oldOwner: oldOwnerChecksum,
					newOwner,
					prevOwner: SENTINEL_NODE,
				},
				{ nonce: 0n },
			);

			// Transactions should be identical
			expect(txLower.data).toBe(txChecksum.data);
			expect(txLower.to).toBe(txChecksum.to);
			expect(txLower.nonce).toBe(txChecksum.nonce);
		});

		it("should handle explicit prevOwner parameter", async () => {
			const owner1 = walletClient.account.address;
			const owner2 = walletClients[1].account.address;
			const owner3 = walletClients[2].account.address;
			const newOwner = randomAddress();

			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [owner1, owner2, owner3],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			// Get owners to find the previous owner manually
			const owners = await getOwners(walletClient, { safeAddress });
			const ownerIndex = owners.indexOf(owner2);
			const prevOwner = owners[ownerIndex - 1];
			if (!prevOwner) {
				throw new Error("No previous owner found");
			}

			// Build swap owner transaction with explicit prevOwner
			const swapOwnerTx = await getSwapOwnerTransaction(
				walletClient,
				safeAddress,
				{
					oldOwner: owner2,
					newOwner,
					prevOwner,
				},
			);

			// Verify the transaction uses the provided prevOwner
			const expectedData = encodeFunctionData({
				abi: SAFE_OWNER_ABI,
				functionName: "swapOwner",
				args: [prevOwner, owner2, newOwner],
			});
			expect(swapOwnerTx.data.toLowerCase()).toBe(expectedData.toLowerCase());
		});
	});

	describe("getChangeThresholdTransaction", () => {
		it("should build correct Safe transaction for changing threshold", async () => {
			// Use random addresses - no need to deploy Safe for transaction building
			const safeAddress = Address.checksum(randomAddress());
			const newThreshold = 3n;

			// Build the change threshold transaction with explicit nonce to avoid reading from blockchain
			const changeThresholdTx = await getChangeThresholdTransaction(
				walletClient,
				safeAddress,
				newThreshold,
				{ nonce: 0n },
			);

			// Verify the transaction details
			expect(changeThresholdTx.safeAddress).toBe(safeAddress);
			expect(changeThresholdTx.to).toBe(safeAddress);
			expect(changeThresholdTx.value).toBe(0n);
			expect(changeThresholdTx.operation).toBe(0); // Call operation
			expect(changeThresholdTx.nonce).toBe(0n);
			expect(changeThresholdTx.safeTxGas).toBe(0n);
			expect(changeThresholdTx.baseGas).toBe(0n);
			expect(changeThresholdTx.gasPrice).toBe(0n);
			expect(changeThresholdTx.gasToken).toBe(ZERO_ADDRESS);
			expect(changeThresholdTx.refundReceiver).toBe(ZERO_ADDRESS);

			// Verify the transaction data contains changeThreshold call using ABI
			const expectedData = encodeFunctionData({
				abi: SAFE_OWNER_ABI,
				functionName: "changeThreshold",
				args: [BigInt(newThreshold)],
			});
			expect(changeThresholdTx.data.toLowerCase()).toBe(
				expectedData.toLowerCase(),
			);
		});

		it("should build transaction with custom transaction options", async () => {
			// Use random addresses - no need to deploy Safe for transaction building
			const safeAddress = Address.checksum(randomAddress());
			const newThreshold = 2n;
			const gasToken = Address.checksum(randomAddress());
			const refundReceiver = Address.checksum(randomAddress());

			// Build the change threshold transaction with custom options
			const changeThresholdTx = await getChangeThresholdTransaction(
				walletClient,
				safeAddress,
				newThreshold,
				{
					nonce: 10n,
					safeTxGas: 50000n,
					baseGas: 25000n,
					gasPrice: 2000000000n,
					gasToken,
					refundReceiver,
				},
			);

			// Verify the transaction structure includes custom options
			expect(changeThresholdTx.nonce).toBe(10n);
			expect(changeThresholdTx.safeTxGas).toBe(50000n);
			expect(changeThresholdTx.baseGas).toBe(25000n);
			expect(changeThresholdTx.gasPrice).toBe(2000000000n);
			expect(changeThresholdTx.gasToken).toBe(gasToken);
			expect(changeThresholdTx.refundReceiver).toBe(refundReceiver);
		});
	});

	describe("Error handling", () => {
		it("should handle invalid Safe addresses for add owner transactions", async () => {
			const invalidSafeAddress = "0x0000000000000000000000000000000000000000";
			const newOwner = randomAddress();

			// getAddOwnerTransaction should throw when trying to read nonce from invalid address that doesn't contain Safe code
			await expect(
				getAddOwnerTransaction(walletClient, invalidSafeAddress, {
					newOwner,
					newThreshold: 1n,
				}),
			).rejects.toThrow();
		});

		it("should handle invalid Safe addresses for remove owner transactions", async () => {
			const invalidSafeAddress = "0x0000000000000000000000000000000000000000";
			const ownerToRemove = randomAddress();

			// getRemoveOwnerTransaction should throw when trying to read owners from invalid address that doesn't contain Safe code
			await expect(
				getRemoveOwnerTransaction(walletClient, invalidSafeAddress, {
					ownerToRemove,
					newThreshold: 1n,
				}),
			).rejects.toThrow();
		});

		it("should handle invalid Safe addresses for swap owner transactions", async () => {
			const invalidSafeAddress = "0x0000000000000000000000000000000000000000";
			const oldOwner = randomAddress();
			const newOwner = randomAddress();

			// getSwapOwnerTransaction should throw when trying to read owners from invalid address that doesn't contain Safe code
			await expect(
				getSwapOwnerTransaction(walletClient, invalidSafeAddress, {
					oldOwner,
					newOwner,
				}),
			).rejects.toThrow();
		});

		it("should handle invalid Safe addresses for change threshold transactions", async () => {
			const invalidSafeAddress = "0x0000000000000000000000000000000000000000";

			// getChangeThresholdTransaction should throw when trying to read nonce from address that doesn't contain Safe code
			await expect(
				getChangeThresholdTransaction(walletClient, invalidSafeAddress, 2n),
			).rejects.toThrow();
		});
	});
});
