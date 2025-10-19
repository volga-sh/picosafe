/**
 * @fileoverview Integration tests for multisend encoding functionality.
 *
 * These tests verify that transaction batching works correctly with the MultiSend contract:
 * - Proper encoding of multiple transactions
 * - Correct handling of operation types (call vs delegatecall)
 * - Data length calculation for variable-length data
 * - Edge cases and error scenarios
 *
 * Tests run against a local Anvil blockchain with real Safe contracts deployed.
 */

import { Address } from "ox";
import {
	encodeFunctionData,
	encodePacked,
	type Hex,
	parseAbi,
	parseEther,
} from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeMultiSendCall } from "../src/multisend";
import { type MetaTransaction, Operation } from "../src/types";
import { createClients, snapshot } from "./fixtures/setup";

describe("encodeMultiSendCall", () => {
	const clients = createClients();
	const { testClient } = clients;
	let resetSnapshot: () => Promise<void>;

	beforeEach(async () => {
		resetSnapshot = await snapshot(testClient);
	});

	afterEach(async () => {
		await resetSnapshot();
	});

	describe("Basic functionality", () => {
		it("should encode a single transaction correctly", () => {
			const transaction = {
				to: Address.checksum("0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"),
				value: 1000000000000000000n, // 1 ETH
				data: "0x" as Hex,
			};

			const encoded = encodeMultiSendCall([transaction]);

			// Expected encoding:
			// - Operation: 0x00 (Call)
			// - To: 0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5 (20 bytes)
			// - Value: 1000000000000000000 (32 bytes)
			// - Data length: 0 (32 bytes)
			// - Data: empty
			const packedTransaction = encodePacked(
				["uint8", "address", "uint256", "uint256", "bytes"],
				[
					Operation.Call,
					transaction.to,
					transaction.value,
					0n, // data length
					"0x",
				],
			);

			const expected = encodeFunctionData({
				abi: parseAbi(["function multiSend(bytes transactions) payable"]),
				functionName: "multiSend",
				args: [packedTransaction],
			});

			expect(encoded).toBe(expected);
		});

		it("should encode token approval and swap transactions", () => {
			const tokenAbi = parseAbi([
				"function approve(address spender, uint256 amount)",
			]);
			const dexAbi = parseAbi([
				"function swap(address tokenIn, address tokenOut, uint256 amount)",
			]);

			const tokenAddress = Address.checksum(
				"0x6B175474E89094C44Da98b954EedeAC495271d0F",
			); // DAI
			const dexAddress = Address.checksum(
				"0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
			); // Uniswap
			const amount = parseEther("100");

			const approveData = encodeFunctionData({
				abi: tokenAbi,
				functionName: "approve",
				args: [dexAddress, amount],
			}) as Hex;

			const swapData = encodeFunctionData({
				abi: dexAbi,
				functionName: "swap",
				args: [
					tokenAddress,
					Address.checksum("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"), // WETH
					amount,
				],
			}) as Hex;

			const transactions = [
				{
					to: tokenAddress,
					value: 0n,
					data: approveData,
				},
				{
					to: dexAddress,
					value: 0n,
					data: swapData,
				},
			];

			const encoded = encodeMultiSendCall(transactions);

			// Verify structure
			expect(encoded.startsWith("0x")).toBe(true);

			// Should be a multiSend function call with selector 0x8d80ff0a
			expect(encoded.slice(0, 10)).toBe("0x8d80ff0a");

			// Verify reasonable length (function selector + data offset + data length + packed transactions)
			expect(encoded.length).toBeGreaterThan((4 + 32 + 32 + 170) * 2); // At least 238 bytes encoded

			// Should contain both addresses within the encoded data
			expect(encoded.toLowerCase()).toContain(
				tokenAddress.toLowerCase().slice(2),
			);
			expect(encoded.toLowerCase()).toContain(
				dexAddress.toLowerCase().slice(2),
			);
		});
	});

	describe("Delegate call functionality", () => {
		it("should encode a delegate call correctly", () => {
			const transaction = {
				to: Address.checksum("0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"),
				value: 0n,
				data: "0x12345678" as Hex,
				UNSAFE_DELEGATE_CALL: true,
			};

			const encoded = encodeMultiSendCall([transaction]);

			const dataLength = BigInt(transaction.data.length / 2 - 1);
			const packedTransaction = encodePacked(
				["uint8", "address", "uint256", "uint256", "bytes"],
				[
					Operation.UNSAFE_DELEGATECALL,
					transaction.to,
					transaction.value,
					dataLength,
					transaction.data,
				],
			);

			const expected = encodeFunctionData({
				abi: parseAbi(["function multiSend(bytes transactions) payable"]),
				functionName: "multiSend",
				args: [packedTransaction],
			});

			expect(encoded).toBe(expected);
		});

		it("should mix regular calls and delegate calls", () => {
			const transactions: [
				Parameters<typeof encodeMultiSendCall>[0][number],
				Parameters<typeof encodeMultiSendCall>[0][number],
			] = [
				{
					to: Address.checksum("0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"),
					value: 1000000000000000000n,
					data: "0x" as Hex,
					UNSAFE_DELEGATE_CALL: false,
				},
				{
					to: Address.checksum("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
					value: 0n,
					data: "0xabcdef" as Hex,
					UNSAFE_DELEGATE_CALL: true,
				},
			] as const;

			const encoded = encodeMultiSendCall(transactions);

			const tx1Encoded = encodePacked(
				["uint8", "address", "uint256", "uint256", "bytes"],
				[Operation.Call, transactions[0].to, transactions[0].value, 0n, "0x"],
			);

			const dataLength = BigInt(transactions[1].data.length / 2 - 1);
			const tx2Encoded = encodePacked(
				["uint8", "address", "uint256", "uint256", "bytes"],
				[
					Operation.UNSAFE_DELEGATECALL,
					transactions[1].to,
					transactions[1].value,
					dataLength,
					transactions[1].data,
				],
			);

			const packedTransactions = `0x${tx1Encoded.slice(2)}${tx2Encoded.slice(2)}`;
			const expected = encodeFunctionData({
				abi: parseAbi(["function multiSend(bytes transactions) payable"]),
				functionName: "multiSend",
				args: [packedTransactions as Hex],
			});
			expect(encoded).toBe(expected);
		});
	});

	describe("Edge cases", () => {
		it("should handle empty transaction array", () => {
			expect(() => encodeMultiSendCall([])).toThrow(
				"No transactions provided for MultiSend encoding",
			);
		});

		it("should handle transactions with long data", () => {
			// Create a long data string (1000 bytes)
			const longData = `0x${"ff".repeat(1000)}` as Hex;
			const transaction: MetaTransaction = {
				to: Address.checksum("0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"),
				value: 0n,
				data: longData,
			};

			const encoded = encodeMultiSendCall([transaction]);

			const dataLength = BigInt(longData.length / 2 - 1);
			const packedTransaction = encodePacked(
				["uint8", "address", "uint256", "uint256", "bytes"],
				[
					Operation.Call,
					transaction.to,
					transaction.value,
					dataLength,
					longData,
				],
			);

			const expected = encodeFunctionData({
				abi: parseAbi(["function multiSend(bytes transactions) payable"]),
				functionName: "multiSend",
				args: [packedTransaction],
			});

			expect(encoded).toBe(expected);
		});

		it("should handle transactions with maximum uint256 values", () => {
			const maxUint256 = 2n ** 256n - 1n;
			const transaction = {
				to: Address.checksum("0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"),
				value: maxUint256,
				data: "0x" as Hex,
			};

			const encoded = encodeMultiSendCall([transaction]);

			const packedTransaction = encodePacked(
				["uint8", "address", "uint256", "uint256", "bytes"],
				[Operation.Call, transaction.to, maxUint256, 0n, "0x"],
			);

			const expected = encodeFunctionData({
				abi: parseAbi(["function multiSend(bytes transactions) payable"]),
				functionName: "multiSend",
				args: [packedTransaction],
			});

			expect(encoded).toBe(expected);
		});
	});
});
