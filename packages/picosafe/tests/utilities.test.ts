/**
 * @fileoverview Integration tests for utility functions.
 *
 * These tests verify that utility functions work correctly, including:
 * - wrapEthereumTransaction for wrapping transactions with send functionality
 * - Proper handling of transaction overrides
 * - Type safety with optional data parameters
 *
 * Tests run against a local Anvil blockchain.
 */

import { type Address, encodeFunctionData, type Hex, parseEther } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeWithSelector } from "../src/utilities/encoding";
import { wrapEthereumTransaction } from "../src/utilities/wrapEthereumTransaction";
import { createClients, snapshot } from "./fixtures/setup";
import { randomAddress } from "./utils";

describe("Utility Functions", () => {
	const clients = createClients();
	const { testClient, publicClient, walletClients } = clients;
	const walletClient = walletClients[0];
	const recipient = walletClients[1];
	let resetSnapshot: () => Promise<void>;

	beforeEach(async () => {
		resetSnapshot = await snapshot(testClient);
	});

	afterEach(async () => {
		await resetSnapshot();
	});

	describe("wrapEthereumTransaction", () => {
		it("should wrap a transaction without additional data", async () => {
			const transaction = {
				to: recipient.account.address as Address,
				value: parseEther("0.001"),
				data: "0x" as Hex,
			};

			const wrappedTx = wrapEthereumTransaction(walletClient, transaction);

			expect(wrappedTx.rawTransaction).toEqual(transaction);
			expect(wrappedTx.send).toBeDefined();
			expect(typeof wrappedTx.send).toBe("function");
			// @ts-expect-error - data should not exist when no data parameter is provided
			expect(wrappedTx.data).toBeUndefined();

			const initialBalance = await publicClient.getBalance({
				address: recipient.account.address,
			});

			const txHash = await wrappedTx.send();
			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			expect(receipt.status).toBe("success");

			const finalBalance = await publicClient.getBalance({
				address: recipient.account.address,
			});
			expect(finalBalance).toBe(initialBalance + parseEther("0.001"));
		});

		it("should wrap a transaction with additional data", async () => {
			const transaction = {
				to: recipient.account.address as Address,
				value: parseEther("0.002"),
				data: "0x" as Hex,
			};

			const additionalData = {
				operationType: "transfer",
				timestamp: Date.now(),
				metadata: { source: "test" },
			};

			const wrappedTx = wrapEthereumTransaction(
				walletClient,
				transaction,
				additionalData,
			);

			expect(wrappedTx.rawTransaction).toEqual(transaction);
			expect(wrappedTx.send).toBeDefined();
			expect(wrappedTx.data).toEqual(additionalData);

			expect(wrappedTx.data.operationType).toBe("transfer");
			expect(wrappedTx.data.timestamp).toBeLessThanOrEqual(Date.now());
			expect(wrappedTx.data.metadata.source).toBe("test");

			const txHash = await wrappedTx.send();
			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			expect(receipt.status).toBe("success");
		});

		it("should apply overrides when sending", async () => {
			const transaction = {
				to: recipient.account.address as Address,
				value: parseEther("0.001"),
				data: "0x" as Hex,
				gas: 21000n,
			};

			const wrappedTx = wrapEthereumTransaction(walletClient, transaction);

			const txHash = await wrappedTx.send({
				gas: 30000n,
			});

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			expect(receipt.status).toBe("success");

			expect(receipt.gasUsed).toBeLessThanOrEqual(30000n);
		});

		it("should handle transactions with data field", async () => {
			// Test transaction with arbitrary data (simulating a contract call)
			const transaction = {
				to: recipient.account.address as Address,
				value: 0n,
				data: "0x1234567890abcdef" as Hex, // Arbitrary data
			};

			const wrappedTx = wrapEthereumTransaction(walletClient, transaction);

			expect(wrappedTx.rawTransaction.data).toBe("0x1234567890abcdef");

			const txHash = await wrappedTx.send();
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			// Even though this is just data to an EOA, the transaction should succeed
			expect(receipt.status).toBe("success");

			const tx = await publicClient.getTransaction({ hash: txHash });
			expect(tx.input).toBe("0x1234567890abcdef");
		});

		it("should preserve nonce in overrides", async () => {
			const currentNonce = await publicClient.getTransactionCount({
				address: walletClient.account.address,
			});

			const transaction = {
				to: recipient.account.address as Address,
				value: parseEther("0.001"),
				data: "0x" as Hex,
			};

			const wrappedTx = wrapEthereumTransaction(walletClient, transaction);

			const txHash = await wrappedTx.send({
				nonce: currentNonce,
			});

			const tx = await publicClient.getTransaction({ hash: txHash });
			expect(tx.nonce).toBe(currentNonce);
		});

		it("should handle failing transactions if gas limit is provided", async () => {
			// Create a transaction that will fail (sending to a contract without payable)
			const deployHash = await walletClient.deployContract({
				abi: [],
				bytecode:
					"0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea265627a7a72315820",
				args: [],
			});

			const deployReceipt = await publicClient.waitForTransactionReceipt({
				hash: deployHash,
			});
			const contractAddress = deployReceipt.contractAddress;
			if (!contractAddress) {
				throw new Error("Contract address not found");
			}

			const transaction = {
				to: contractAddress,
				value: parseEther("0.001"), // This will fail - contract has no payable function
				data: "0x" as Hex,
				gas: 3_000_000n,
			};

			const wrappedTx = wrapEthereumTransaction(walletClient, transaction);

			const txHash = await wrappedTx.send();

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			expect(receipt.status).toBe("reverted");
		});

		it("should thrown an error if the transaction is failing", async () => {
			// Create a transaction that will fail (sending to a contract without payable)
			const deployHash = await walletClient.deployContract({
				abi: [],
				bytecode:
					"0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea265627a7a72315820",
				args: [],
			});

			const deployReceipt = await publicClient.waitForTransactionReceipt({
				hash: deployHash,
			});
			const contractAddress = deployReceipt.contractAddress;
			if (!contractAddress) {
				throw new Error("Contract address not found");
			}

			const transaction = {
				to: contractAddress,
				value: parseEther("0.001"), // This will fail - contract has no payable function
				data: "0x" as Hex,
			};

			const ethTx = wrapEthereumTransaction(walletClient, transaction);
			await expect(ethTx.send()).rejects.toThrow();
		});

		it("should handle complex data types in additional data", async () => {
			const complexData = {
				operation: {
					type: "batch",
					params: {
						addresses: [randomAddress() as Address, randomAddress() as Address],
						values: [parseEther("0.1"), parseEther("0.2")],
					},
				},
				metadata: {
					timestamp: Date.now(),
					tags: ["test", "batch", "complex"],
					nested: {
						deep: {
							value: true,
						},
					},
				},
			} as const;

			const transaction = {
				to: recipient.account.address as Address,
				value: 0n,
				data: "0x" as Hex,
			};

			const wrappedTx = wrapEthereumTransaction(
				walletClient,
				transaction,
				complexData,
			);

			expect(wrappedTx.data).toEqual(complexData);
			expect(wrappedTx.data.operation.params.addresses).toHaveLength(2);
			expect(wrappedTx.data.metadata.nested.deep.value).toBe(true);

			const txHash = await wrappedTx.send();
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			expect(receipt.status).toBe("success");
		});
	});

	describe("Encoding Utilities", () => {
		describe("encodeWithSelector", () => {
			it("should encode with a selector and a single address argument", () => {
				const selector = "0x610b5925"; // enableModule(address)
				const address = "0x1234deadbeef1234deadbeef1234deadbeef1234";
				const expected = encodeFunctionData({
					abi: [
						{
							type: "function",
							name: "enableModule",
							inputs: [{ type: "address" }],
						},
					],
					functionName: "enableModule",
					args: [address],
				});
				expect(encodeWithSelector(selector, address)).toBe(expected);
			});

			it("should encode with multiple arguments of different types", () => {
				const address = "0x1234deadbeef1234deadbeef1234deadbeef1234";
				const amount = 12345n;
				const bytes32 =
					"0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

				const abi = [
					{
						type: "function",
						name: "someFunction",
						inputs: [
							{ type: "address" },
							{ type: "uint256" },
							{ type: "bytes32" },
						],
					},
				] as const;

				const expected = encodeFunctionData({
					abi,
					functionName: "someFunction",
					args: [address, amount, bytes32],
				});

				const selector = expected.slice(0, 10) as Hex;

				expect(encodeWithSelector(selector, address, amount, bytes32)).toBe(
					expected,
				);
			});

			it("should throw an error for an invalid selector length", () => {
				const invalidSelector = "0x123"; // Too short
				expect(() =>
					encodeWithSelector(invalidSelector as Hex, "0x123"),
				).toThrow(
					"Selector must represent exactly 4 bytes (8 hex chars) prefixed with 0x",
				);
				const anotherInvalidSelector = "0x123456789"; // Too long
				expect(() =>
					encodeWithSelector(anotherInvalidSelector as Hex, "0x123"),
				).toThrow(
					"Selector must represent exactly 4 bytes (8 hex chars) prefixed with 0x",
				);
			});

			it("should throw an error if an argument exceeds 32 bytes", () => {
				const selector = "0x12345678";
				const longHex = `0x${"a".repeat(65)}`; // 33 bytes
				expect(() => encodeWithSelector(selector, longHex)).toThrow(
					"Hex size (`33`) exceeds padding size (`32`)",
				);
			});
		});
	});
});
