/**
 * @fileoverview Integration tests for EIP-712 functionality.
 *
 * These tests verify that EIP-712 functions work correctly, including:
 * - Domain separator calculation matching on-chain behavior
 * - Transaction hash calculation for Safe transactions
 * - Message hash calculation for EIP-1271 signatures
 * - Deterministic output across various configurations
 *
 * Tests use fuzz-like random testing to ensure robustness across diverse inputs.
 */

import { type Address, getAddress, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PARSED_SAFE_ABI } from "../src/abis";
import { deploySafeAccount } from "../src/deployment";
import {
	calculateSafeDomainSeparator,
	calculateSafeMessageHash,
	calculateSafeTransactionHash,
} from "../src/eip712";
import type { FullSafeTransaction, SafeMessage } from "../src/types";
import { ZERO_ADDRESS } from "../src/utilities/constants";
import { createClients, snapshot } from "./fixtures/setup";
import { randomAddress, randomBytesHex } from "./utils";

describe("EIP-712 Functions", () => {
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

	describe("calculateSafeDomainSeparator", () => {
		it("should produce correct domain separators, compare against on-chain (100 random iterations)", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({ hash: txHash });
			const testSafeAddress = deployment.data.safeAddress;

			// We keep the chain ID constant for the entire test to ensure consistency
			// We'll have a separate test for different chain IDs
			const chainId = BigInt(await publicClient.getChainId());
			for (let i = 0; i < 100; i++) {
				const separator1 = calculateSafeDomainSeparator(
					testSafeAddress,
					chainId,
				);
				const separator2 = calculateSafeDomainSeparator(
					testSafeAddress,
					chainId,
				);

				// We compare two separators to ensure determinism
				expect(separator1).toBe(separator2);
				expect(separator1).toMatch(/^0x[a-fA-F0-9]{64}$/);

				// We compare against on-chain domain separator to ensure correctness
				const onChainSeparator = await publicClient.readContract({
					address: testSafeAddress,
					abi: PARSED_SAFE_ABI,
					functionName: "domainSeparator",
				});
				expect(separator1).toBe(onChainSeparator);
			}
		});

		it("should handle edge case chain IDs", async () => {
			const safeAddress = randomAddress();

			const edgeCases = [
				2n ** 256n - 1n, // Tests uint256 overflow handling
			];

			for (const chainId of edgeCases) {
				const separator = calculateSafeDomainSeparator(safeAddress, chainId);
				expect(separator).toMatch(/^0x[a-fA-F0-9]{64}$/);
			}
		});
	});

	describe("calculateSafeTransactionHash", () => {
		it("should match on-chain getTransactionHash (50 random transactions)", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({ hash: txHash });

			const testSafeAddress = deployment.data.safeAddress;
			const chainId = BigInt(await publicClient.getChainId());

			// 50 iterations provides good coverage without excessive test duration
			for (let i = 0; i < 50; i++) {
				const safeTx: FullSafeTransaction = {
					to: randomAddress(),
					value: BigInt(Math.floor(Math.random() * 1e18)),
					data: randomBytesHex(Math.floor(Math.random() * 200)) as Hex,
					operation: Math.random() > 0.5 ? 0 : 1,
					safeTxGas: BigInt(Math.floor(Math.random() * 1000000)),
					baseGas: BigInt(Math.floor(Math.random() * 100000)),
					gasPrice: BigInt(Math.floor(Math.random() * 1e10)),
					gasToken: Math.random() > 0.5 ? randomAddress() : ZERO_ADDRESS,
					refundReceiver: Math.random() > 0.5 ? randomAddress() : ZERO_ADDRESS,
					nonce: BigInt(Math.floor(Math.random() * 1000)),
					safeAddress: testSafeAddress,
					chainId,
				};

				const calculatedHash = calculateSafeTransactionHash(safeTx);

				const onChainHash = await publicClient.readContract({
					address: testSafeAddress,
					abi: PARSED_SAFE_ABI,
					functionName: "getTransactionHash",
					args: [
						safeTx.to,
						safeTx.value,
						safeTx.data,
						safeTx.operation,
						safeTx.safeTxGas,
						safeTx.baseGas,
						safeTx.gasPrice,
						safeTx.gasToken,
						safeTx.refundReceiver,
						safeTx.nonce,
					],
				});

				expect(calculatedHash).toBe(onChainHash);
			}
		});

		it("should handle edge case transaction values", async () => {
			const safeAddress = randomAddress();
			const chainId = BigInt(await publicClient.getChainId());

			// Empty transaction tests minimum viable transaction structure
			const emptyTx: FullSafeTransaction = {
				to: ZERO_ADDRESS,
				value: 0n,
				data: "0x",
				operation: 0,
				safeTxGas: 0n,
				baseGas: 0n,
				gasPrice: 0n,
				gasToken: ZERO_ADDRESS,
				refundReceiver: ZERO_ADDRESS,
				nonce: 0n,
				safeAddress,
				chainId,
			};

			const emptyHash = calculateSafeTransactionHash(emptyTx);
			expect(emptyHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			// Max values test uint256 overflow safety and large data handling
			const maxTx: FullSafeTransaction = {
				to: getAddress("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"),
				value: 2n ** 256n - 1n,
				data: `0x${"ff".repeat(1000)}` as Hex, // 1KB of data
				operation: 1,
				safeTxGas: 2n ** 256n - 1n,
				baseGas: 2n ** 256n - 1n,
				gasPrice: 2n ** 256n - 1n,
				gasToken: getAddress("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"),
				refundReceiver: getAddress(
					"0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
				),
				nonce: 2n ** 256n - 1n,
				safeAddress,
				chainId,
			};

			const maxHash = calculateSafeTransactionHash(maxTx);
			expect(maxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			expect(emptyHash).not.toBe(maxHash);
		});

		it("should produce deterministic hashes", () => {
			const safeAddress = randomAddress();
			const chainId = 73n;

			const safeTx: FullSafeTransaction = {
				to: randomAddress(),
				value: 1000000000000000000n,
				data: "0x1234567890abcdef",
				operation: 0,
				safeTxGas: 100000n,
				baseGas: 21000n,
				gasPrice: 20000000000n,
				gasToken: ZERO_ADDRESS,
				refundReceiver: ZERO_ADDRESS,
				nonce: 5n,
				safeAddress,
				chainId,
			};

			const hash1 = calculateSafeTransactionHash(safeTx);
			const hash2 = calculateSafeTransactionHash(safeTx);
			const hash3 = calculateSafeTransactionHash(safeTx);

			expect(hash1).toBe(hash2);
			expect(hash2).toBe(hash3);
		});
	});

	describe("calculateSafeMessageHash", () => {
		it("should produce valid EIP-1271 hashes (50 random messages)", async () => {
			const deployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({ hash: txHash });
			const testSafeAddress = deployment.data.safeAddress;
			const chainId = BigInt(await publicClient.getChainId());

			for (let i = 0; i < 50; i++) {
				const messageSize = Math.floor(Math.random() * 1000);
				const messageData = randomBytesHex(messageSize) as Hex;

				const message: SafeMessage = { message: messageData };
				const hash = calculateSafeMessageHash(
					testSafeAddress,
					chainId,
					message,
				);

				const hash2 = calculateSafeMessageHash(
					testSafeAddress,
					chainId,
					message,
				);
				expect(hash).toBe(hash2);

				expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

				const onchainHash = await publicClient.readContract({
					address: testSafeAddress,
					abi: PARSED_SAFE_ABI,
					functionName: "getMessageHash",
					args: [messageData],
				});
				expect(hash).toBe(onchainHash);
			}
		});

		it("should handle edge case message sizes", async () => {
			const safeAddress = randomAddress();
			const chainId = 1n;

			const emptyMessage: SafeMessage = { message: "0x" };
			const emptyHash = calculateSafeMessageHash(
				safeAddress,
				chainId,
				emptyMessage,
			);
			expect(emptyHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			const singleByteMessage: SafeMessage = { message: "0x00" };
			const singleByteHash = calculateSafeMessageHash(
				safeAddress,
				chainId,
				singleByteMessage,
			);
			expect(singleByteHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			// Large messages test memory efficiency and hash algorithm robustness
			const largeMessage: SafeMessage = {
				message: `0x${"ab".repeat(5000)}` as Hex,
			};
			const largeHash = calculateSafeMessageHash(
				safeAddress,
				chainId,
				largeMessage,
			);
			expect(largeHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			expect(emptyHash).not.toBe(singleByteHash);
			expect(singleByteHash).not.toBe(largeHash);
			expect(emptyHash).not.toBe(largeHash);
		});

		it("should produce different hashes for different chain IDs", () => {
			const safeAddress = randomAddress();
			const message: SafeMessage = { message: "0x48656c6c6f20576f726c64" }; // "Hello World"

			const hash1 = calculateSafeMessageHash(safeAddress, 1n, message);
			const hash137 = calculateSafeMessageHash(safeAddress, 137n, message);
			const hash42161 = calculateSafeMessageHash(safeAddress, 42161n, message);

			expect(hash1).not.toBe(hash137);
			expect(hash137).not.toBe(hash42161);
			expect(hash1).not.toBe(hash42161);
		});

		it("should produce different hashes for different safe addresses", () => {
			const chainId = 1n;
			const message: SafeMessage = { message: "0x48656c6c6f20576f726c64" }; // "Hello World"

			const safe1 = randomAddress();
			const safe2 = randomAddress();
			const safe3 = randomAddress();

			const hash1 = calculateSafeMessageHash(safe1, chainId, message);
			const hash2 = calculateSafeMessageHash(safe2, chainId, message);
			const hash3 = calculateSafeMessageHash(safe3, chainId, message);

			expect(hash1).not.toBe(hash2);
			expect(hash2).not.toBe(hash3);
			expect(hash1).not.toBe(hash3);
		});
	});
});
