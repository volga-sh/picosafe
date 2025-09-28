import { Hex } from "ox";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	computeMappingStorageSlot,
	computeOwnersMappingSlot,
	deploySafeAccount,
	getOwners,
	getStorageAt,
	isSafeAccount,
	SAFE_STORAGE_SLOTS,
	V150_ADDRESSES,
} from "../src";
import type { Address } from "../src/ox-types";
import { SENTINEL_NODE } from "../src/utilities/constants";
import { createClients, snapshot } from "./fixtures/setup";

// Test setup
const clients = createClients();
const { testClient, publicClient, walletClients } = clients;
const walletClient = walletClients[0];
let resetSnapshot: () => Promise<void>;

describe("Storage slot computation", () => {
	test("computeMappingStorageSlot should calculate correct storage slots", () => {
		const key = "0x0000000000000000000000000000000000000001";
		const mappingSlot =
			"0x0000000000000000000000000000000000000000000000000000000000000002";

		const result = computeMappingStorageSlot(key, mappingSlot);

		// This should match keccak256(abi.encodePacked(key, mappingSlot))
		// The expected value is calculated as keccak256(concat(padLeft(0x1, 32), padLeft(0x2, 32)))
		expect(result).toBe(
			"0xe90b7bceb6e7df5418fb78d8ee546e97c83a08bbccc01a0644d599ccd2a7c2e0",
		);
	});

	test("computeOwnersMappingSlot should use correct storage slot for owners mapping", () => {
		const ownerAddress = "0x1234567890123456789012345678901234567890";

		const result = computeOwnersMappingSlot(ownerAddress);

		// Should use slot 2 for owners mapping
		const expected = computeMappingStorageSlot(
			ownerAddress,
			SAFE_STORAGE_SLOTS.ownersMapping,
		);
		expect(result).toBe(expected);
	});

	test("computeOwnersMappingSlot with SENTINEL_NODE", () => {
		const result = computeOwnersMappingSlot(SENTINEL_NODE);

		// Should calculate slot for sentinel node
		const expected = computeMappingStorageSlot(
			SENTINEL_NODE,
			SAFE_STORAGE_SLOTS.ownersMapping,
		);
		expect(result).toBe(expected);
		// SENTINEL_NODE is 0x1, ownersMapping is slot 2, so this should match our first test
		expect(result).toBe(
			"0xe90b7bceb6e7df5418fb78d8ee546e97c83a08bbccc01a0644d599ccd2a7c2e0",
		);
	});
});

describe("Safe account detection", () => {
	let safeAddress: Address;

	beforeEach(async () => {
		resetSnapshot = await snapshot(testClient);
	});

	afterEach(async () => {
		await resetSnapshot();
	});

	test("should detect a valid Safe contract", async () => {
		// Deploy a test Safe first
		const deployment = await deploySafeAccount(walletClient, {
			owners: [walletClient.account.address],
			threshold: 1n,
		});

		const txHash = await deployment.send();
		await publicClient.waitForTransactionReceipt({ hash: txHash });
		safeAddress = deployment.data.safeAddress;

		// Test detection
		const isSafe = await isSafeAccount(publicClient, safeAddress);
		expect(isSafe).toBe(true);
	});

	test("should return false for EOA addresses", async () => {
		const eoaAddress = walletClients[1].account.address;

		const isSafe = await isSafeAccount(publicClient, eoaAddress);
		expect(isSafe).toBe(false);
	});

	test("should return false for non-Safe contracts", async () => {
		// Use a known contract that's not a Safe (e.g., a simple token contract)
		// For this test, we'll use the Safe factory contract itself
		const factoryAddress = V150_ADDRESSES.SafeProxyFactory;

		const isSafe = await isSafeAccount(publicClient, factoryAddress);
		expect(isSafe).toBe(false);
	});

	test("should return false for non-existent addresses", async () => {
		// Use a random address that doesn't exist
		const randomAddress =
			"0x1111111111111111111111111111111111111111" as Address;

		const isSafe = await isSafeAccount(publicClient, randomAddress);
		expect(isSafe).toBe(false);
	});

	test("should work with block parameter", async () => {
		// Deploy a Safe first
		const deployment = await deploySafeAccount(walletClient, {
			owners: [walletClient.account.address],
			threshold: 1n,
		});

		const txHash = await deployment.send();
		await publicClient.waitForTransactionReceipt({ hash: txHash });
		const testSafeAddress = deployment.data.safeAddress;

		// Get current block number
		const blockNumber = await publicClient.getBlockNumber();

		const isSafe = await isSafeAccount(publicClient, testSafeAddress, {
			block: Hex.fromNumber(blockNumber),
		});
		expect(isSafe).toBe(true);
	});

	test("should handle invalid contract addresses gracefully", async () => {
		// Test with various problematic inputs that should not throw
		const invalidAddresses = [
			"0x0000000000000000000000000000000000000000", // Zero address
			"0xffffffffffffffffffffffffffffffffffffffff", // Max address
		];

		for (const addr of invalidAddresses) {
			const isSafe = await isSafeAccount(publicClient, addr as Address);
			expect(isSafe).toBe(false); // Should return false, not throw
		}
	});

	test("should detect Safe contracts with multiple owners", async () => {
		// Deploy a multi-owner Safe
		const deployment = await deploySafeAccount(walletClient, {
			owners: [
				walletClients[0].account.address,
				walletClients[1].account.address,
				walletClients[2].account.address,
			],
			threshold: 2n,
		});

		const txHash = await deployment.send();
		await publicClient.waitForTransactionReceipt({ hash: txHash });

		const isSafe = await isSafeAccount(
			publicClient,
			deployment.data.safeAddress,
		);
		expect(isSafe).toBe(true);
	});

	test("should verify storage consistency with getOwners result", async () => {
		// Deploy a Safe and verify that our detection logic matches reality
		const deployment = await deploySafeAccount(walletClient, {
			owners: [
				walletClients[0].account.address,
				walletClients[1].account.address,
			],
			threshold: 2n,
		});

		const txHash = await deployment.send();
		await publicClient.waitForTransactionReceipt({ hash: txHash });

		// Get owners using the standard function
		const owners = await getOwners(publicClient, {
			safeAddress: deployment.data.safeAddress,
		});

		// Get storage at sentinel slot
		const sentinelSlot = computeOwnersMappingSlot(SENTINEL_NODE);
		const storageValues = await getStorageAt(publicClient, {
			safeAddress: deployment.data.safeAddress,
			slot: sentinelSlot,
		});

		// The storage should point to the first owner
		const firstOwner = owners[0];
		const storageAddress = `0x${storageValues[0]?.slice(26)}`;

		expect(firstOwner?.toLowerCase()).toBe(storageAddress.toLowerCase());

		// And our detection should work
		const isSafe = await isSafeAccount(
			publicClient,
			deployment.data.safeAddress,
		);
		expect(isSafe).toBe(true);
	});
});
