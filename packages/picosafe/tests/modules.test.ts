/**
 * @fileoverview Integration tests for Safe module management functionality.
 *
 * These tests verify that Safe module enable/disable transactions work correctly, including:
 * - Proper encoding of enableModule and disableModule calls
 * - Correct handling of module linked list structure
 * - Safe transaction structure validation
 * - Error handling for invalid module operations
 *
 * Tests run against a local Anvil blockchain with real Safe contracts deployed.
 */

import { Address, Hex as HexUtils } from "ox";
import {
	encodeFunctionData,
	type Hex,
	keccak256,
	pad,
	parseAbi,
	type Address as ViemAddress,
} from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deploySafeAccount } from "../src/deployment";
import {
	getDisableModuleTransaction,
	UNSAFE_getEnableModuleTransaction,
} from "../src/modules";
import { computeModulesMappingSlot, SAFE_STORAGE_SLOTS } from "../src/storage";
import { Operation } from "../src/types";
import { SENTINEL_NODE, ZERO_ADDRESS } from "../src/utilities/constants";
import { createClients, snapshot } from "./fixtures/setup";
import { randomAddress } from "./utils";

/**
 * Directly writes a linked list of modules into Safe storage.
 *
 * The resulting structure is: SENTINEL -> modules[0] -> modules[1] -> ... -> SENTINEL
 * so that the Safe's `getModulesPaginated` call returns the provided list in order.
 *
 * @param testClient Viem testClient connected to Anvil
 * @param safeAddress Address of the deployed Safe contract
 * @param modules Array of module addresses to mark as enabled (in order)
 */
async function writeModulesToStorage(
	testClient: ReturnType<typeof createClients>["testClient"],
	safeAddress: ViemAddress,
	modules: ViemAddress[],
): Promise<void> {
	// Build forward pointers for SENTINEL and every module
	const forwardPointers: Record<ViemAddress, ViemAddress> = {};

	// SENTINEL points to first module or back to itself if none
	forwardPointers[SENTINEL_NODE] = modules[0] ?? SENTINEL_NODE;

	// Each module points to the next one; last points back to sentinel
	for (let i = 0; i < modules.length; i++) {
		const current = modules[i];
		if (!current) {
			throw new Error("Invalid module address");
		}

		const next = modules[i + 1] ?? SENTINEL_NODE;
		if (!next) {
			throw new Error("Invalid module address");
		}

		forwardPointers[current] = next;
	}

	// Write mapping entries
	for (const [key, value] of Object.entries(forwardPointers)) {
		const slot = computeModulesMappingSlot(key as ViemAddress);
		const paddedValue = HexUtils.padLeft(value, 32);
		await testClient.setStorageAt({
			address: safeAddress,
			index: slot,
			value: paddedValue,
		});
	}

	// Mine a block so the state change is visible to subsequent eth_call
	await testClient.mine({ blocks: 1 });
}

// Safe module management ABI - these functions are not in the main Safe ABI
const SAFE_MODULE_ABI = parseAbi([
	"function enableModule(address module)",
	"function disableModule(address prevModule, address module)",
]);

describe("Safe Module Management Functions", () => {
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

	describe("getEnableModuleTransaction", () => {
		it("should build correct Safe transaction for enabling a module", async () => {
			// Use random addresses - no need to deploy Safe for transaction building
			const safeAddress = Address.checksum(randomAddress());
			const moduleAddress = Address.checksum(randomAddress());

			// Build the enable module transaction with explicit nonce to avoid reading from blockchain
			const enableTx = await UNSAFE_getEnableModuleTransaction(
				walletClient,
				safeAddress,
				moduleAddress,
				{ nonce: 0n },
			);

			expect(enableTx.safeAddress).toBe(safeAddress);
			expect(enableTx.to).toBe(safeAddress);
			expect(enableTx.value).toBe(0n);
			expect(enableTx.operation).toBe(Operation.Call);
			expect(enableTx.gasToken).toBe(ZERO_ADDRESS);
			expect(enableTx.refundReceiver).toBe(ZERO_ADDRESS);
			expect(enableTx.gasPrice).toBe(0n);
			expect(enableTx.baseGas).toBe(0n);
			expect(enableTx.safeTxGas).toBe(0n);

			// Verify the transaction data contains enableModule call using ABI
			const expectedData = encodeFunctionData({
				abi: SAFE_MODULE_ABI,
				functionName: "enableModule",
				args: [moduleAddress],
			});
			expect(enableTx.data).toBe(expectedData);
		});

		it("should build transaction with custom transaction options", async () => {
			// Use random addresses - no need to deploy Safe for transaction building
			const safeAddress = Address.checksum(randomAddress());
			const moduleAddress = Address.checksum(randomAddress());
			const gasToken = Address.checksum(randomAddress());
			const refundReceiver = Address.checksum(randomAddress());

			// Build the enable module transaction with custom options
			const enableTx = await UNSAFE_getEnableModuleTransaction(
				walletClient,
				safeAddress,
				moduleAddress,
				{
					nonce: 5n,
					safeTxGas: 100000n,
					baseGas: 30000n,
					gasPrice: 1000000000n,
					gasToken,
					refundReceiver,
				},
			);

			// Verify the transaction structure includes custom options
			expect(enableTx.safeAddress).toBe(safeAddress);
			expect(enableTx.to).toBe(safeAddress);
			expect(enableTx.value).toBe(0n);
			expect(enableTx.operation).toBe(Operation.Call);
			expect(enableTx.nonce).toBe(5n);
			expect(enableTx.safeTxGas).toBe(100000n);
			expect(enableTx.baseGas).toBe(30000n);
			expect(enableTx.gasPrice).toBe(1000000000n);
			expect(enableTx.gasToken).toBe(gasToken);
			expect(enableTx.refundReceiver).toBe(refundReceiver);
		});

		it("should handle multiple enable operations with different modules", async () => {
			// Use random addresses - no need to deploy Safe for transaction building
			const safeAddress = Address.checksum(randomAddress());
			const moduleAddresses = [
				Address.checksum(randomAddress()),
				Address.checksum(randomAddress()),
				Address.checksum(randomAddress()),
			];

			// Build enable transactions for each module with explicit nonce to avoid reading from blockchain
			const enableTxs = await Promise.all(
				moduleAddresses.map((moduleAddress) =>
					UNSAFE_getEnableModuleTransaction(
						walletClient,
						safeAddress,
						moduleAddress,
						{
							nonce: 0n,
						},
					),
				),
			);

			// Verify all transactions have correct structure
			for (const [index, enableTx] of enableTxs.entries()) {
				expect(enableTx.safeAddress).toBe(safeAddress);
				expect(enableTx.to).toBe(safeAddress);
				expect(enableTx.value).toBe(0n);
				expect(enableTx.operation).toBe(Operation.Call);
				expect(enableTx.gasToken).toBe(ZERO_ADDRESS);
				expect(enableTx.refundReceiver).toBe(ZERO_ADDRESS);
				expect(enableTx.gasPrice).toBe(0n);
				expect(enableTx.baseGas).toBe(0n);
				expect(enableTx.safeTxGas).toBe(0n);

				// Verify the transaction data contains correct module address using ABI
				const moduleAddress = moduleAddresses[index];
				if (!moduleAddress) {
					throw new Error(`Module address at index ${index} is undefined`);
				}
				const expectedData = encodeFunctionData({
					abi: SAFE_MODULE_ABI,
					functionName: "enableModule",
					args: [moduleAddress],
				});
				expect(enableTx.data).toBe(expectedData);
			}
		});

		it("should build identical enableModule transactions for checksum and lowercase addresses", async () => {
			const safeAddress = Address.checksum(randomAddress());
			const moduleLower = Address.checksum(randomAddress());
			const moduleChecksum = Address.checksum(moduleLower);

			// explicitly set nonce to 0 to avoid reading from blockchain
			const txLower = await UNSAFE_getEnableModuleTransaction(
				walletClient,
				safeAddress,
				moduleLower,
				{ nonce: 0n },
			);

			// explicitly set nonce to 0 to avoid reading from blockchain
			const txChecksum = await UNSAFE_getEnableModuleTransaction(
				walletClient,
				safeAddress,
				moduleChecksum,
				{ nonce: 0n },
			);

			expect(txLower.data).toBe(txChecksum.data);
			expect(txLower.to).toBe(txChecksum.to);
			expect(txLower.value).toBe(txChecksum.value);
			expect(txLower.operation).toBe(txChecksum.operation);
			expect(txLower.gasToken).toBe(txChecksum.gasToken);
			expect(txLower.refundReceiver).toBe(txChecksum.refundReceiver);
			expect(txLower.gasPrice).toBe(txChecksum.gasPrice);
			expect(txLower.baseGas).toBe(txChecksum.baseGas);
			expect(txLower.safeTxGas).toBe(txChecksum.safeTxGas);
		});
	});

	describe("getDisableModuleTransaction", () => {
		it("should throw error when trying to disable a module that is not enabled", async () => {
			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			// Try to disable a module that was never enabled
			const nonExistentModuleAddress = randomAddress();

			await expect(
				getDisableModuleTransaction(
					walletClient,
					safeAddress,
					nonExistentModuleAddress,
				),
			).rejects.toThrow(
				`Module ${nonExistentModuleAddress} not found in Safe ${safeAddress}`,
			);
		});

		it("should build correct Safe transaction for disabling a module", async () => {
			// Deploy a fresh Safe
			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });

			const safeAddress = safeDeployment.data.safeAddress;
			const moduleAddress = randomAddress();

			// Directly mark the module as enabled in storage so getModulesPaginated sees it
			await writeModulesToStorage(testClient, safeAddress, [moduleAddress]);

			const disableTx = await getDisableModuleTransaction(
				walletClient,
				safeAddress,
				moduleAddress,
				{ nonce: 0n }, // avoid reading nonce from chain
			);

			expect(disableTx.safeAddress).toBe(safeAddress);
			expect(disableTx.to).toBe(safeAddress);
			expect(disableTx.value).toBe(0n);
			expect(disableTx.operation).toBe(Operation.Call);

			const expectedData = encodeFunctionData({
				abi: SAFE_MODULE_ABI,
				functionName: "disableModule",
				args: [SENTINEL_NODE, moduleAddress],
			});
			expect(disableTx.data).toBe(expectedData);
		});

		it("should build transaction with custom transaction options", async () => {
			// Deploy Safe
			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });

			const safeAddress = safeDeployment.data.safeAddress;
			const moduleAddress = randomAddress();

			// Enable module via storage manipulation
			await writeModulesToStorage(testClient, safeAddress, [moduleAddress]);

			const gasToken = Address.checksum(randomAddress());
			const refundReceiver = Address.checksum(randomAddress());

			const disableTx = await getDisableModuleTransaction(
				walletClient,
				safeAddress,
				moduleAddress,
				{
					nonce: 7n,
					safeTxGas: 123_456n,
					baseGas: 50_000n,
					gasPrice: 1_000_000_000n,
					gasToken,
					refundReceiver,
				},
			);

			expect(disableTx.nonce).toBe(7n);
			expect(disableTx.safeTxGas).toBe(123_456n);
			expect(disableTx.baseGas).toBe(50_000n);
			expect(disableTx.gasPrice).toBe(1_000_000_000n);
			expect(disableTx.gasToken).toBe(gasToken);
			expect(disableTx.refundReceiver).toBe(refundReceiver);
		});

		it("should handle multiple disable operations with different modules", async () => {
			// Deploy Safe
			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });

			const safeAddress = safeDeployment.data.safeAddress;
			const moduleAddresses = [
				randomAddress(),
				randomAddress(),
				randomAddress(),
			];

			// Create linked list SENTINEL -> m1 -> m2 -> m3 -> SENTINEL
			await writeModulesToStorage(testClient, safeAddress, moduleAddresses);

			// Build disable transactions for each module
			const disableTxs = await Promise.all(
				moduleAddresses.map((moduleAddress) =>
					getDisableModuleTransaction(
						walletClient,
						safeAddress,
						moduleAddress,
						{
							nonce: 0n,
						},
					),
				),
			);

			// Verify each transaction has correct prevModule encoding
			for (const [index, disableTx] of disableTxs.entries()) {
				expect(disableTx.safeAddress).toBe(safeAddress);
				expect(disableTx.to).toBe(safeAddress);
				expect(disableTx.value).toBe(0n);
				expect(disableTx.operation).toBe(Operation.Call);

				const prevModule =
					index === 0 ? SENTINEL_NODE : moduleAddresses[index - 1];

				if (!prevModule || !moduleAddresses[index]) {
					throw new Error("Invalid module address");
				}

				const expectedData = encodeFunctionData({
					abi: SAFE_MODULE_ABI,
					functionName: "disableModule",
					args: [prevModule, moduleAddresses[index]],
				});
				expect(disableTx.data).toBe(expectedData);
			}
		});

		it("should build identical disableModule transactions for checksum and lowercase addresses", async () => {
			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });

			const safeAddress = safeDeployment.data.safeAddress;
			const moduleAddress = randomAddress();
			await writeModulesToStorage(testClient, safeAddress, [moduleAddress]);
			const moduleChecksum = Address.checksum(moduleAddress);

			const txLower = await getDisableModuleTransaction(
				walletClient,
				safeAddress,
				moduleAddress,
			);

			const txChecksum = await getDisableModuleTransaction(
				walletClient,
				safeAddress,
				moduleChecksum,
			);

			expect(txLower.data).toBe(txChecksum.data);
			expect(txLower.to).toBe(txChecksum.to);
			expect(txLower.value).toBe(txChecksum.value);
			expect(txLower.operation).toBe(txChecksum.operation);
			expect(txLower.gasToken).toBe(txChecksum.gasToken);
			expect(txLower.refundReceiver).toBe(txChecksum.refundReceiver);
			expect(txLower.gasPrice).toBe(txChecksum.gasPrice);
			expect(txLower.baseGas).toBe(txChecksum.baseGas);
			expect(txLower.safeTxGas).toBe(txChecksum.safeTxGas);
		});
	});

	describe("Error handling", () => {
		it("should handle invalid Safe addresses for enable transactions", async () => {
			const invalidSafeAddress = "0x0000000000000000000000000000000000000000";
			const moduleAddress = randomAddress();

			// UNSAFE_getEnableModuleTransaction should throw when trying to read nonce from invalid address
			await expect(
				UNSAFE_getEnableModuleTransaction(
					walletClient,
					invalidSafeAddress,
					moduleAddress,
				),
			).rejects.toThrow();
		});

		it("should handle invalid Safe addresses for disable transactions", async () => {
			const invalidSafeAddress = "0x0000000000000000000000000000000000000000";
			const moduleAddress = randomAddress();

			// getDisableModuleTransaction should throw when trying to read modules from invalid address
			await expect(
				getDisableModuleTransaction(
					walletClient,
					invalidSafeAddress,
					moduleAddress,
				),
			).rejects.toThrow();
		});
	});

	describe("computeModulesMappingSlot", () => {
		it("should compute the correct storage slot for a given module address", () => {
			const moduleAddress = "0x0000000000000000000000000000000000000001";
			// The expected slot is keccak256(abi.encodePacked(moduleAddress, uint256(1)))
			// where moduleAddress is 0x...0001 and the slot is 1 (for modules mapping)
			const expectedSlot = keccak256(
				HexUtils.concat(
					pad(moduleAddress, { size: 32 }),
					pad(SAFE_STORAGE_SLOTS.modulesMapping as Hex, { size: 32 }),
				),
			);
			const slot = computeModulesMappingSlot(moduleAddress);
			expect(slot).toBe(expectedSlot);
		});

		it("should compute the correct storage slot for the sentinel address", () => {
			// The expected slot is keccak256(abi.encodePacked(SENTINEL_NODE, uint256(1)))
			// where SENTINEL_NODE is 0x...0001 and the slot is 1 (for modules mapping)
			const expectedSlot = keccak256(
				HexUtils.concat(
					pad(SENTINEL_NODE, { size: 32 }),
					pad(SAFE_STORAGE_SLOTS.modulesMapping as Hex, { size: 32 }),
				),
			);
			const slot = computeModulesMappingSlot(SENTINEL_NODE);
			expect(slot).toBe(expectedSlot);
		});

		it("should produce different slots for different module addresses", () => {
			const moduleAddress1 = "0x0000000000000000000000000000000000000001";
			const moduleAddress2 = "0x0000000000000000000000000000000000000002";
			const slot1 = computeModulesMappingSlot(moduleAddress1);
			const slot2 = computeModulesMappingSlot(moduleAddress2);
			expect(slot1).not.toBe(slot2);
		});

		it("should return the same slot for checksummed and lowercase addresses", () => {
			const moduleLower = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
			const moduleChecksum = Address.checksum(moduleLower);
			const slot1 = computeModulesMappingSlot(moduleLower);
			const slot2 = computeModulesMappingSlot(moduleChecksum);
			expect(slot1).toBe(slot2);
		});
	});
});
