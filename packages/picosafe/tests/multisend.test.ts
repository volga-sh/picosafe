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
import { checksumAddress } from "../src/utilities/address";
import { padStartHex } from "../src/utilities/encoding";
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
				to: checksumAddress("0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"),
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

		it("should encode multiple transactions correctly", () => {
			const transactions = [
				{
					to: checksumAddress("0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"),
					value: 1000000000000000000n, // 1 ETH
					data: "0x" as Hex,
				},
				{
					to: checksumAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
					value: 2000000000000000000n, // 2 ETH
					data: "0x" as Hex,
				},
			] as const;

			const encoded = encodeMultiSendCall(transactions);

			// Should concatenate both encoded transactions
			const tx1Encoded = encodePacked(
				["uint8", "address", "uint256", "uint256", "bytes"],
				[Operation.Call, transactions[0].to, transactions[0].value, 0n, "0x"],
			);
			const tx2Encoded = encodePacked(
				["uint8", "address", "uint256", "uint256", "bytes"],
				[Operation.Call, transactions[1].to, transactions[1].value, 0n, "0x"],
			);

			const packedTransactions = `0x${tx1Encoded.slice(2)}${tx2Encoded.slice(2)}`;
			const expected = encodeFunctionData({
				abi: parseAbi(["function multiSend(bytes transactions) payable"]),
				functionName: "multiSend",
				args: [packedTransactions as Hex],
			});
			expect(encoded).toBe(expected);
		});

		it("should handle transactions with data correctly", () => {
			const tokenAbi = parseAbi([
				"function transfer(address to, uint256 amount)",
			]);
			const data = encodeFunctionData({
				abi: tokenAbi,
				functionName: "transfer",
				args: [
					checksumAddress("0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"),
					1000000000000000000n,
				],
			});

			const transaction = {
				to: checksumAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
				value: 0n,
				data,
			};

			const encoded = encodeMultiSendCall([transaction]);

			// Calculate data length in bytes (remove '0x' prefix and divide by 2)
			const dataLength = BigInt(data.length / 2 - 1);

			const packedTransaction = encodePacked(
				["uint8", "address", "uint256", "uint256", "bytes"],
				[Operation.Call, transaction.to, transaction.value, dataLength, data],
			);

			const expected = encodeFunctionData({
				abi: parseAbi(["function multiSend(bytes transactions) payable"]),
				functionName: "multiSend",
				args: [packedTransaction],
			});

			expect(encoded).toBe(expected);
		});
	});

	describe("Delegate call functionality", () => {
		it("should encode a delegate call correctly", () => {
			const transaction = {
				to: checksumAddress("0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"),
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
					to: checksumAddress("0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"),
					value: 1000000000000000000n,
					data: "0x" as Hex,
					UNSAFE_DELEGATE_CALL: false,
				},
				{
					to: checksumAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
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
				to: checksumAddress("0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"),
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

		it("should handle very small data", () => {
			const transaction = {
				to: checksumAddress("0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"),
				value: 0n,
				data: "0x01" as Hex,
			};

			const encoded = encodeMultiSendCall([transaction]);

			const packedTransaction = encodePacked(
				["uint8", "address", "uint256", "uint256", "bytes"],
				[Operation.Call, transaction.to, transaction.value, 1n, "0x01"],
			);

			const expected = encodeFunctionData({
				abi: parseAbi(["function multiSend(bytes transactions) payable"]),
				functionName: "multiSend",
				args: [packedTransaction],
			});

			expect(encoded).toBe(expected);
		});

		it("should handle many transactions", () => {
			// Create 100 transactions
			const transactions = Array.from({ length: 100 }, (_, i) => ({
				to: checksumAddress("0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"),
				value: BigInt(i) * 1000000000000000n,
				data: padStartHex(i.toString(16), 32),
			}));

			const encoded = encodeMultiSendCall(transactions);

			// Verify it starts with hex prefix
			expect(encoded.startsWith("0x")).toBe(true);

			// Should be a multiSend function call with selector 0x8d80ff0a
			expect(encoded.slice(0, 10)).toBe("0x8d80ff0a");

			// Verify length is reasonable - function selector (4 bytes) + offset (32 bytes) + length (32 bytes) + data
			// Each tx should be at least 85 bytes encoded
			expect(encoded.length).toBeGreaterThan(10 + 64 + 64 + 85 * 2 * 100); // 2 hex chars per byte
		});

		it("should preserve exact addresses with checksums", () => {
			const checksummedAddress = checksumAddress(
				"0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
			);
			const transaction = {
				to: checksummedAddress,
				value: 0n,
				data: "0x" as Hex,
			};

			const encoded = encodeMultiSendCall([transaction]);

			// Should be a multiSend function call
			expect(encoded.slice(0, 10)).toBe("0x8d80ff0a");

			// The address should be preserved exactly as provided within the encoded data
			expect(encoded.toLowerCase()).toContain(
				checksummedAddress.toLowerCase().slice(2),
			);
		});

		it("should handle transactions with maximum uint256 values", () => {
			const maxUint256 = 2n ** 256n - 1n;
			const transaction = {
				to: checksumAddress("0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"),
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

	describe("Real-world scenarios", () => {
		it("should encode token approval and swap transactions", () => {
			const tokenAbi = parseAbi([
				"function approve(address spender, uint256 amount)",
			]);
			const dexAbi = parseAbi([
				"function swap(address tokenIn, address tokenOut, uint256 amount)",
			]);

			const tokenAddress = checksumAddress(
				"0x6B175474E89094C44Da98b954EedeAC495271d0F",
			); // DAI
			const dexAddress = checksumAddress(
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
					checksumAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"), // WETH
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

		it("should encode batch ETH transfers", () => {
			const recipients = [
				checksumAddress("0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"),
				checksumAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
				checksumAddress("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"),
				checksumAddress("0x90F79bf6EB2c4f870365E785982E1f101E93b906"),
				checksumAddress("0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"),
			];

			const transactions = recipients.map((to, index) => ({
				to,
				value: parseEther((index + 1).toString()),
				data: "0x" as Hex,
			}));

			const encoded = encodeMultiSendCall(transactions);

			// Should be a multiSend function call with selector 0x8d80ff0a
			expect(encoded.slice(0, 10)).toBe("0x8d80ff0a");

			// Verify all addresses are included within the encoded data
			recipients.forEach((address) => {
				expect(encoded.toLowerCase()).toContain(address.toLowerCase().slice(2));
			});

			// Verify reasonable length
			// Function selector (4 bytes) + offset (32 bytes) + length (32 bytes) + packed transactions
			// Each transaction should be exactly 85 bytes
			// (1 byte operation + 20 bytes address + 32 bytes value + 32 bytes data length)
			expect(encoded.length).toBeGreaterThan(10); // Has function selector
			expect(encoded).toMatch(/^0x8d80ff0a/); // Correct function selector
		});
	});
});
