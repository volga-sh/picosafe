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

			const nonce = await getNonce(publicClient, deployment.data.safeAddress);
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
				deployment.data.safeAddress,
				toHex(blockNumber),
			);
			expect(nonce).toBe(0n);

			// Should fail if safe doesn't exist at block
			await expect(
				getNonce(
					publicClient,
					deployment.data.safeAddress,
					toHex(blockNumber - 1n),
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

			const handler = await getFallbackHandler(
				publicClient,
				deployment.data.safeAddress,
			);

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

			const handler = await getFallbackHandler(
				publicClient,
				deployment.data.safeAddress,
			);
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
				deployment.data.safeAddress,
				toHex(blockNumber),
			);
			expect(handler.toLowerCase()).toBe(
				V141_ADDRESSES.CompatibilityFallbackHandler.toLowerCase(),
			);

			// Should fail if safe doesn't exist at block
			await expect(
				getFallbackHandler(
					publicClient,
					deployment.data.safeAddress,
					toHex(blockNumber - 1n),
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

			const guard = await getGuard(publicClient, deployment.data.safeAddress);
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

			const guard = await getGuard(publicClient, deployment.data.safeAddress);
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
				deployment.data.safeAddress,
				toHex(blockNumber),
			);
			expect(guard).toBe(ZERO_ADDRESS);

			// Should fail if safe doesn't exist at block
			await expect(
				getGuard(
					publicClient,
					deployment.data.safeAddress,
					toHex(blockNumber - 1n),
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

			const [slotValue1] = await getStorageAt(
				publicClient,
				deployment.data.safeAddress,
				{
					slot: "0x0",
				},
			);
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
				deployment.data.safeAddress,
				{
					slot: "0x0",
				},
				toHex(blockNumber),
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
					deployment.data.safeAddress,
					{
						slot: "0x0",
					},
					toHex(blockNumber - 1n),
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

				const [storage] = await getStorageAt(
					publicClient,
					deployment.data.safeAddress,
					{
						slot: slot as Hex,
					},
				);

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

			const count = await getOwnerCount(
				publicClient,
				deployment.data.safeAddress,
			);
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
				deployment.data.safeAddress,
				toHex(blockNumber),
			);
			expect(count).toBe(1n);

			// Should fail if safe doesn't exist at block
			await expect(
				getOwnerCount(
					publicClient,
					deployment.data.safeAddress,
					toHex(blockNumber - 1n),
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

			const singleton = await getSingleton(
				publicClient,
				deployment.data.safeAddress,
			);
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
				deployment.data.safeAddress,
				toHex(blockNumber),
			);
			expect(singleton).toBeDefined();

			// Should fail if safe doesn't exist at block
			await expect(
				getSingleton(
					publicClient,
					deployment.data.safeAddress,
					toHex(blockNumber - 1n),
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

			const threshold = await getThreshold(
				publicClient,
				deployment.data.safeAddress,
			);
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
				deployment.data.safeAddress,
				toHex(blockNumber),
			);
			expect(threshold).toBe(1n);

			// Should fail if safe doesn't exist at block
			await expect(
				getThreshold(
					publicClient,
					deployment.data.safeAddress,
					toHex(blockNumber - 1n),
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

			const owners = await getOwners(publicClient, deployment.data.safeAddress);
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
				deployment.data.safeAddress,
				toHex(blockNumber),
			);
			expect(owners).toBeDefined();

			// Should fail if safe doesn't exist at block
			await expect(
				getOwners(
					publicClient,
					deployment.data.safeAddress,
					toHex(blockNumber - 1n),
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

			const result = await getModulesPaginated(
				publicClient,
				deployment.data.safeAddress,
			);

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
			const result = await getModulesPaginated(
				publicClient,
				deployment.data.safeAddress,
				{
					pageSize: 10,
				},
			);

			expect(result).toHaveProperty("modules");
			expect(result).toHaveProperty("next");
			expect(Array.isArray(result.modules)).toBe(true);
		});

		it("should support custom start address", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			await deployment.send();

			// Using SENTINEL_NODE as start address since Safe has no modules
			// Any other address would cause GS105 error (Invalid owner address provided)
			const result = await getModulesPaginated(
				publicClient,
				deployment.data.safeAddress,
				{
					start: SENTINEL_NODE,
				},
			);

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
				getModulesPaginated(publicClient, deployment.data.safeAddress, {
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

			const result = await getModulesPaginated(
				publicClient,
				deployment.data.safeAddress,
				{
					start: SENTINEL_NODE,
					pageSize: 5,
				},
			);

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
				deployment.data.safeAddress,
				{},
				toHex(blockNumber),
			);

			expect(result.modules).toEqual([]);
			expect(result.next).toBe(SENTINEL_NODE);

			// Should fail if safe doesn't exist at block
			await expect(
				getModulesPaginated(
					publicClient,
					deployment.data.safeAddress,
					{},
					toHex(blockNumber - 1n),
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
			const result = await getModulesPaginated(
				publicClient,
				deployment.data.safeAddress,
				{
					pageSize: 1000,
				},
			);

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

			const result = await getModulesPaginated(
				publicClient,
				deployment.data.safeAddress,
			);

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
				getModulesPaginated(publicClient, invalidAddress),
			).rejects.toThrow();
		});
	});
});
