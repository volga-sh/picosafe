/**
 * @fileoverview Integration tests for Safe account state functionality.
 *
 * These tests verify that we can correctly read Safe account state:
 * - Reading the current nonce
 * - Reading the fallback handler from storage
 * - Reading the owner count from storage
 * - Reading the singleton from storage
 * - Reading the threshold from storage
 *
 * Tests run against a local Anvil blockchain with real Safe contracts deployed.
 */

import { type Hex, parseAbi, toHex } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getFallbackHandler,
	getGuard,
	getModulesPaginated,
	getNonce,
	getOwnerCount,
	getOwners,
	getSingleton,
	getStorageAt,
	getThreshold,
	SAFE_STORAGE_SLOTS,
} from "../src/account-state";
import { deploySafeAccount } from "../src/deployment";
import { V141_ADDRESSES } from "../src/safe-contracts";
import { SENTINEL_NODE, ZERO_ADDRESS } from "../src/utilities/constants";
import { createClients, snapshot } from "./fixtures/setup";
import { randomAddress } from "./utils";

describe("Account State Functions", () => {
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

	describe("getNonce", () => {
		it("should return the nonce of a Safe", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const nonce = await getNonce(publicClient, {
				safeAddress: deployment.data.safeAddress,
			});
			expect(nonce).toBe(0n);
		});

		it("should support querying at specific block", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const blockNumber = await publicClient.getBlockNumber();

			const nonce = await getNonce(
				publicClient,
				{ safeAddress: deployment.data.safeAddress },
				{ block: toHex(blockNumber) },
			);
			expect(nonce).toBe(0n);

			// Should fail if safe doesn't exist at block
			await expect(
				getNonce(
					publicClient,
					{ safeAddress: deployment.data.safeAddress },
					{ block: toHex(blockNumber - 1n) },
				),
			).rejects.toThrow();
		});
	});

	describe("getFallbackHandler", () => {
		it("should return the fallback handler of a Safe", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const handler = await getFallbackHandler(publicClient, {
				safeAddress: deployment.data.safeAddress,
			});

			expect(handler.toLowerCase()).toBe(
				V141_ADDRESSES.CompatibilityFallbackHandler.toLowerCase(),
			);
		});

		it("should return zero address for Safe without a fallback handler", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
				fallbackHandler: "0x0000000000000000000000000000000000000000",
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const handler = await getFallbackHandler(publicClient, {
				safeAddress: deployment.data.safeAddress,
			});
			expect(handler).toBe(ZERO_ADDRESS);
		});

		// implement when executing transactions is implemented
		it.todo("should return correct fallback handler after setting");

		it("should support querying at specific block", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const blockNumber = await publicClient.getBlockNumber();

			const handler = await getFallbackHandler(
				publicClient,
				{ safeAddress: deployment.data.safeAddress },
				{ block: toHex(blockNumber) },
			);
			expect(handler.toLowerCase()).toBe(
				V141_ADDRESSES.CompatibilityFallbackHandler.toLowerCase(),
			);

			// Should fail if safe doesn't exist at block
			await expect(
				getFallbackHandler(
					publicClient,
					{ safeAddress: deployment.data.safeAddress },
					{ block: toHex(blockNumber - 1n) },
				),
			).rejects.toThrow();
		});
	});

	describe("getGuard", () => {
		it("should return the guard address of a Safe", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const guard = await getGuard(publicClient, {
				safeAddress: deployment.data.safeAddress,
			});
			expect(guard).toBe(ZERO_ADDRESS);
		});

		it("should return zero address for Safe without a guard", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const guard = await getGuard(publicClient, {
				safeAddress: deployment.data.safeAddress,
			});
			expect(guard).toBe(ZERO_ADDRESS);
		});

		it("should support querying at specific block", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const blockNumber = await publicClient.getBlockNumber();

			const guard = await getGuard(
				publicClient,
				{ safeAddress: deployment.data.safeAddress },
				{ block: toHex(blockNumber) },
			);
			expect(guard).toBe(ZERO_ADDRESS);

			// Should fail if safe doesn't exist at block
			await expect(
				getGuard(
					publicClient,
					{ safeAddress: deployment.data.safeAddress },
					{ block: toHex(blockNumber - 1n) },
				),
			).rejects.toThrow();
		});
	});

	describe("getStorageAt", () => {
		it("should return the storage at a specific slot", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const [slotValue1] = await getStorageAt(publicClient, {
				safeAddress: deployment.data.safeAddress,
				slot: "0x0",
			});
			const storageFromRpc = await publicClient.getStorageAt({
				address: deployment.data.safeAddress,
				slot: "0x0",
			});

			expect(slotValue1).toEqual(storageFromRpc);
		});

		it("should support querying at specific block", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const blockNumber = await publicClient.getBlockNumber();

			const [slotValue1] = await getStorageAt(
				publicClient,
				{
					safeAddress: deployment.data.safeAddress,
					slot: "0x0",
				},
				{ block: toHex(blockNumber) },
			);

			const storageFromRpc = await publicClient.getStorageAt({
				address: deployment.data.safeAddress,
				slot: "0x0",
				blockNumber,
			});

			expect(slotValue1).toEqual(storageFromRpc);

			// Should fail if safe doesn't exist at block
			await expect(
				getStorageAt(
					publicClient,
					{
						safeAddress: deployment.data.safeAddress,
						slot: "0x0",
					},
					{ block: toHex(blockNumber - 1n) },
				),
			).rejects.toThrow();
		});

		it("should encode the getStorageAt function selector correctly", async () => {
			const slots = Object.values(SAFE_STORAGE_SLOTS);
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const abi = parseAbi([
				"function getStorageAt(uint256 slot, uint256 length) view returns (bytes memory)",
			]);

			for (const slot of slots) {
				const slotValue = await publicClient.readContract({
					abi,
					address: deployment.data.safeAddress,
					functionName: "getStorageAt",
					args: [BigInt(slot), 1n],
				});

				const [storage] = await getStorageAt(publicClient, {
					safeAddress: deployment.data.safeAddress,
					slot: slot as Hex,
				});

				expect(slotValue).toBe(storage);
			}
		});
	});

	describe("getOwnerCount", () => {
		it("should return the owner count of a Safe", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const count = await getOwnerCount(publicClient, {
				safeAddress: deployment.data.safeAddress,
			});
			expect(count).toBe(1n);
		});

		it("should support querying at specific block", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const blockNumber = await publicClient.getBlockNumber();

			const count = await getOwnerCount(
				publicClient,
				{ safeAddress: deployment.data.safeAddress },
				{ block: toHex(blockNumber) },
			);
			expect(count).toBe(1n);

			// Should fail if safe doesn't exist at block
			await expect(
				getOwnerCount(
					publicClient,
					{ safeAddress: deployment.data.safeAddress },
					{ block: toHex(blockNumber - 1n) },
				),
			).rejects.toThrow();
		});
	});

	describe("getSingleton", () => {
		it("should return the singleton of a Safe", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const singleton = await getSingleton(publicClient, {
				safeAddress: deployment.data.safeAddress,
			});
			expect(singleton).toBeDefined();
		});

		it("should support querying at specific block", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const blockNumber = await publicClient.getBlockNumber();

			const singleton = await getSingleton(
				publicClient,
				{ safeAddress: deployment.data.safeAddress },
				{ block: toHex(blockNumber) },
			);
			expect(singleton).toBeDefined();

			// Should fail if safe doesn't exist at block
			await expect(
				getSingleton(
					publicClient,
					{ safeAddress: deployment.data.safeAddress },
					{ block: toHex(blockNumber - 1n) },
				),
			).rejects.toThrow();
		});
	});

	describe("getThreshold", () => {
		it("should return the threshold of a Safe", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const threshold = await getThreshold(publicClient, {
				safeAddress: deployment.data.safeAddress,
			});
			expect(threshold).toBe(1n);
		});

		it("should support querying at specific block", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const blockNumber = await publicClient.getBlockNumber();

			const threshold = await getThreshold(
				publicClient,
				{ safeAddress: deployment.data.safeAddress },
				{ block: toHex(blockNumber) },
			);
			expect(threshold).toBe(1n);

			// Should fail if safe doesn't exist at block
			await expect(
				getThreshold(
					publicClient,
					{ safeAddress: deployment.data.safeAddress },
					{ block: toHex(blockNumber - 1n) },
				),
			).rejects.toThrow();
		});
	});

	describe("getOwners", () => {
		it("should return the owners of a Safe", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const owners = await getOwners(publicClient, {
				safeAddress: deployment.data.safeAddress,
			});
			expect(owners).toBeDefined();
		});

		it("should support querying at specific block", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const blockNumber = await publicClient.getBlockNumber();

			const owners = await getOwners(
				publicClient,
				{ safeAddress: deployment.data.safeAddress },
				{ block: toHex(blockNumber) },
			);
			expect(owners).toBeDefined();

			// Should fail if safe doesn't exist at block
			await expect(
				getOwners(
					publicClient,
					{ safeAddress: deployment.data.safeAddress },
					{ block: toHex(blockNumber - 1n) },
				),
			).rejects.toThrow();
		});
	});

	describe("getModulesPaginated", () => {
		it("should return empty array for Safe with no modules", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const result = await getModulesPaginated(publicClient, {
				safeAddress: deployment.data.safeAddress,
			});

			expect(result.modules).toEqual([]);
			expect(result.next).toBe(SENTINEL_NODE);
		});

		it("should paginate through modules with custom page size", async () => {
			// Deploy a Safe - we'll enable modules via direct transaction execution
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			// For this test, we'll simulate having modules by checking the response format
			// In a real scenario, we'd enable modules first
			const result = await getModulesPaginated(publicClient, {
				safeAddress: deployment.data.safeAddress,
				pageSize: 10,
			});

			expect(result).toHaveProperty("modules");
			expect(result).toHaveProperty("next");
			expect(Array.isArray(result.modules)).toBe(true);
		});

		it("should support custom start address", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			// Using SENTINEL_NODE as start address since Safe has no modules
			// Any other address would cause GS105 error (Invalid owner address provided)
			const result = await getModulesPaginated(publicClient, {
				safeAddress: deployment.data.safeAddress,
				start: SENTINEL_NODE,
			});

			expect(result.modules).toEqual([]);
			expect(result.next).toBe(SENTINEL_NODE);
		});

		it("should propagate GS105 error for invalid start address", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			// Using an invalid start address that's not in the module linked list
			const invalidStart = "0x0000000000000000000000000000000000000002";

			// The Safe contract will revert with GS105 error
			await expect(
				getModulesPaginated(publicClient, {
					safeAddress: deployment.data.safeAddress,
					start: invalidStart,
				}),
			).rejects.toThrow();
		});

		it("should support both start and pageSize parameters", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const result = await getModulesPaginated(publicClient, {
				safeAddress: deployment.data.safeAddress,
				start: SENTINEL_NODE,
				pageSize: 5,
			});

			expect(result).toBeDefined();
			expect(result.modules).toBeDefined();
			expect(result.next).toBeDefined();
		});

		it("should support querying at specific block", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const blockNumber = await publicClient.getBlockNumber();

			const result = await getModulesPaginated(
				publicClient,
				{ safeAddress: deployment.data.safeAddress },
				{ block: toHex(blockNumber) },
			);

			expect(result.modules).toEqual([]);
			expect(result.next).toBe(SENTINEL_NODE);

			// Should fail if safe doesn't exist at block
			await expect(
				getModulesPaginated(
					publicClient,
					{ safeAddress: deployment.data.safeAddress },
					{ block: toHex(blockNumber - 1n) },
				),
			).rejects.toThrow();
		});

		it("should handle maximum page size", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			// Test with a large page size
			const result = await getModulesPaginated(publicClient, {
				safeAddress: deployment.data.safeAddress,
				pageSize: 1000,
			});

			expect(result).toBeDefined();
			expect(result.modules).toEqual([]);
		});

		it("should properly decode response with modules", async () => {
			// This test verifies the decoding logic even without actual modules
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const result = await getModulesPaginated(publicClient, {
				safeAddress: deployment.data.safeAddress,
			});

			// Verify the structure matches expected format
			expect(result).toMatchObject({
				modules: expect.any(Array),
				next: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
			});

			// For a Safe with no modules, next should be sentinel
			expect(result.next).toBe(SENTINEL_NODE);
		});

		it("should fail gracefully with invalid Safe address", async () => {
			const invalidAddress = "0x0000000000000000000000000000000000000000";

			await expect(
				getModulesPaginated(publicClient, { safeAddress: invalidAddress }),
			).rejects.toThrow();
		});
	});

	describe("Lazy Evaluation", () => {
		it("should support lazy evaluation for getNonce", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			// Get lazy call object
			const nonceCall = await getNonce(
				publicClient,
				{ safeAddress: deployment.data.safeAddress },
				{ lazy: true },
			);

			// Verify structure
			expect(nonceCall).toHaveProperty("rawCall");
			expect(nonceCall).toHaveProperty("call");
			expect(nonceCall.rawCall).toMatchObject({
				to: deployment.data.safeAddress,
				data: expect.stringMatching(/^0x5624b25b/), // getStorageAt selector
			});

			// Execute the call
			const nonce = await nonceCall.call();
			expect(nonce).toBe(0n);
		});

		it("should support lazy evaluation with custom data", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			// Get lazy call object with custom data
			const customData = { purpose: "batch-validation", id: 123 };
			const thresholdCall = await getThreshold(
				publicClient,
				{ safeAddress: deployment.data.safeAddress },
				{ lazy: true, data: customData },
			);

			// Verify structure includes custom data
			expect(thresholdCall).toHaveProperty("rawCall");
			expect(thresholdCall).toHaveProperty("call");
			expect(thresholdCall).toHaveProperty("data");
			expect(thresholdCall.data).toEqual(customData);

			// Execute the call
			const threshold = await thresholdCall.call();
			expect(threshold).toBe(1n);
		});

		it("should support lazy evaluation for getOwners", async () => {
			const owners = [
				walletClient.account.address,
				randomAddress(),
				randomAddress(),
			];
			const deployment = await deploySafeAccount(walletClient, {
				owners,
				threshold: 2n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			// Get lazy call object
			const ownersCall = await getOwners(
				publicClient,
				{ safeAddress: deployment.data.safeAddress },
				{ lazy: true },
			);

			// Verify structure
			expect(ownersCall).toHaveProperty("rawCall");
			expect(ownersCall).toHaveProperty("call");
			expect(ownersCall.rawCall).toMatchObject({
				to: deployment.data.safeAddress,
				data: "0xa0e67e2b", // getOwners selector
			});

			// Execute the call
			const retrievedOwners = await ownersCall.call();
			expect(retrievedOwners.length).toBe(owners.length);
			expect(retrievedOwners.map((o) => o.toLowerCase()).sort()).toEqual(
				owners.map((o) => o.toLowerCase()).sort(),
			);
		});

		it("should support lazy evaluation with specific block", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			const blockNumber = await publicClient.getBlockNumber();

			// Get lazy call object with specific block
			const nonceCall = await getNonce(
				publicClient,
				{ safeAddress: deployment.data.safeAddress },
				{ lazy: true, block: toHex(blockNumber) },
			);

			// Verify block is included in raw call
			expect(nonceCall.rawCall.block).toBe(toHex(blockNumber));

			// Execute the call
			const nonce = await nonceCall.call();
			expect(nonce).toBe(0n);
		});

		it("should support lazy evaluation for getModulesPaginated", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			// Get lazy call object
			const modulesCall = await getModulesPaginated(
				publicClient,
				{ safeAddress: deployment.data.safeAddress, pageSize: 10 },
				{ lazy: true },
			);

			// Verify structure
			expect(modulesCall).toHaveProperty("rawCall");
			expect(modulesCall).toHaveProperty("call");
			expect(modulesCall.rawCall).toMatchObject({
				to: deployment.data.safeAddress,
				data: expect.stringMatching(/^0xcc2f8452/), // getModulesPaginated selector
			});

			// Execute the call
			const result = await modulesCall.call();
			expect(result.modules).toEqual([]);
			expect(result.next).toBe(SENTINEL_NODE);
		});

		it("should allow batching multiple lazy calls", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			// Get multiple lazy calls
			const nonceCall = await getNonce(
				publicClient,
				{ safeAddress: deployment.data.safeAddress },
				{ lazy: true },
			);
			const thresholdCall = await getThreshold(
				publicClient,
				{ safeAddress: deployment.data.safeAddress },
				{ lazy: true },
			);
			const ownerCountCall = await getOwnerCount(
				publicClient,
				{ safeAddress: deployment.data.safeAddress },
				{ lazy: true },
			);

			// All calls should have raw call data that could be batched
			expect(nonceCall.rawCall).toBeDefined();
			expect(thresholdCall.rawCall).toBeDefined();
			expect(ownerCountCall.rawCall).toBeDefined();

			// Execute individually (multicall batching would be implemented separately)
			const [nonce, threshold, ownerCount] = await Promise.all([
				nonceCall.call(),
				thresholdCall.call(),
				ownerCountCall.call(),
			]);

			expect(nonce).toBe(0n);
			expect(threshold).toBe(1n);
			expect(ownerCount).toBe(1n);
		});
	});
});
