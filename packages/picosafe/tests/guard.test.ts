/**
 * @fileoverview Integration tests for Safe guard management functionality.
 *
 * These tests verify that Safe guard transactions work correctly, including:
 * - Proper encoding of setGuard calls
 * - Safe transaction structure validation
 *
 * Tests run against a local Anvil blockchain with real Safe contracts deployed.
 */

import { Address } from "ox";
import { encodeFunctionData, parseAbi } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UNSAFE_getSetGuardTransaction } from "../src/guard.js";
import { Operation } from "../src/types.js";
import { ZERO_ADDRESS } from "../src/utilities/constants.js";
import { createClients, snapshot } from "./fixtures/setup.js";
import { randomAddress } from "./utils.js";

// Safe guard management ABI - this function is not in the main Safe ABI
const SAFE_GUARD_ABI = parseAbi(["function setGuard(address guard)"]);

describe("Safe Guard Management Functions", () => {
	const clients = createClients();
	const { testClient, walletClients } = clients;
	const walletClient = walletClients[0];
	let resetSnapshot: () => Promise<void>;

	beforeEach(async () => {
		resetSnapshot = await snapshot(testClient);
	});

	afterEach(async () => {
		await resetSnapshot();
	});

	describe("UNSAFE_getSetGuardTransaction", () => {
		it("should build correct Safe transaction for setting a guard", async () => {
			// Use random addresses - no need to deploy Safe for transaction building
			const safeAddress = randomAddress();
			const guardAddress = randomAddress();

			// Build the set guard transaction with explicit nonce to avoid reading from blockchain
			const setGuardTx = await UNSAFE_getSetGuardTransaction(
				walletClient,
				safeAddress,
				guardAddress,
				{ nonce: 0n },
			);

			expect(setGuardTx.safeAddress).toBe(safeAddress);
			expect(setGuardTx.to).toBe(safeAddress);
			expect(setGuardTx.value).toBe(0n);
			expect(setGuardTx.operation).toBe(Operation.Call);
			expect(setGuardTx.gasToken).toBe(ZERO_ADDRESS);
			expect(setGuardTx.refundReceiver).toBe(ZERO_ADDRESS);
			expect(setGuardTx.gasPrice).toBe(0n);
			expect(setGuardTx.baseGas).toBe(0n);
			expect(setGuardTx.safeTxGas).toBe(0n);

			// Verify the transaction data contains setGuard call using ABI
			const expectedData = encodeFunctionData({
				abi: SAFE_GUARD_ABI,
				functionName: "setGuard",
				args: [guardAddress],
			});
			expect(setGuardTx.data).toBe(expectedData);
		});

		it("should build transaction with custom transaction options", async () => {
			// Use random addresses - no need to deploy Safe for transaction building
			const safeAddress = randomAddress();
			const guardAddress = randomAddress();
			const gasToken = randomAddress();
			const refundReceiver = randomAddress();

			// Build the set guard transaction with custom options
			const setGuardTx = await UNSAFE_getSetGuardTransaction(
				walletClient,
				safeAddress,
				guardAddress,
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
			expect(setGuardTx.safeAddress).toBe(safeAddress);
			expect(setGuardTx.to).toBe(safeAddress);
			expect(setGuardTx.value).toBe(0n);
			expect(setGuardTx.operation).toBe(Operation.Call);
			expect(setGuardTx.nonce).toBe(5n);
			expect(setGuardTx.safeTxGas).toBe(100000n);
			expect(setGuardTx.baseGas).toBe(30000n);
			expect(setGuardTx.gasPrice).toBe(1000000000n);
			expect(setGuardTx.gasToken).toBe(gasToken);
			expect(setGuardTx.refundReceiver).toBe(refundReceiver);
		});

		it("should build identical setGuard transactions for checksum and lowercase addresses", async () => {
			const safeAddress = randomAddress();
			const guardLower = randomAddress();
			const guardChecksum = Address.checksum(guardLower);

			// explicitly set nonce to 0 to avoid reading from blockchain
			const txLower = await UNSAFE_getSetGuardTransaction(
				walletClient,
				safeAddress,
				guardLower,
				{ nonce: 0n },
			);

			// explicitly set nonce to 0 to avoid reading from blockchain
			const txChecksum = await UNSAFE_getSetGuardTransaction(
				walletClient,
				safeAddress,
				guardChecksum,
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

		it("should handle invalid Safe addresses for setGuard transactions", async () => {
			const invalidSafeAddress = "0x0000000000000000000000000000000000000000";
			const guardAddress = randomAddress();

			// UNSAFE_getSetGuardTransaction should throw when trying to read nonce from invalid address
			await expect(
				UNSAFE_getSetGuardTransaction(
					walletClient,
					invalidSafeAddress,
					guardAddress,
				),
			).rejects.toThrow();
		});
	});
});
