/**
 * @fileoverview Integration tests for Safe transaction simulation functionality.
 *
 * These tests verify that Safe transaction simulation works correctly, including:
 * - Simulation without signatures using SimulateTxAccessor
 * - Simulation with signatures using eth_call
 * - Proper handling of successful and failed transactions
 * - Gas estimation accuracy
 *
 * Tests run against a local Anvil blockchain with real Safe contracts deployed.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deploySafeAccount } from "../src/deployment";
import { simulateSafeTransaction } from "../src/simulation";
import { buildSafeTransaction, signSafeTransaction } from "../src/transactions";
import { createClients, snapshot } from "./fixtures/setup";
import { randomAddress } from "./utils";

describe("Safe Transaction Simulation - simulation.ts", () => {
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

	describe("simulateSafeTransaction without signatures", () => {
		it.skip("should simulate a successful transaction and return gas estimate (requires SimulateTxAccessor deployment)", async () => {
			// NOTE: This test is skipped because SimulateTxAccessor is not deployed on local Anvil network
			// Simulation without signatures requires the SimulateTxAccessor contract at the canonical address

			// Deploy a Safe
			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			// Fund the Safe with some ETH
			const fundTxHash = await walletClient.sendTransaction({
				to: safeAddress,
				value: 10000000000000000000n, // 10 ETH
			});
			await publicClient.waitForTransactionReceipt({ hash: fundTxHash });

			// Build a simple ETH transfer transaction
			const recipient = randomAddress();
			const tx = await buildSafeTransaction(
				walletClient,
				safeAddress,
				[
					{
						to: recipient,
						value: 1000000000000000000n, // 1 ETH
						data: "0x",
					},
				],
				{ nonce: 0n },
			);

			// Simulate without signatures
			const result = await simulateSafeTransaction(walletClient, tx);

			// Verify simulation result
			expect(result.success).toBe(true);
			expect(result.gasUsed).toBeDefined();
			expect(result.gasUsed).toBeGreaterThan(0n);
		});

		it.skip("should simulate a failing transaction and return failure (requires SimulateTxAccessor deployment)", async () => {
			// Deploy a Safe
			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			// Build a transaction that will fail (insufficient balance)
			const recipient = randomAddress();
			const tx = await buildSafeTransaction(
				walletClient,
				safeAddress,
				[
					{
						to: recipient,
						value: 1000000000000000000n, // 1 ETH (Safe has no balance)
						data: "0x",
					},
				],
				{ nonce: 0n },
			);

			// Simulate without signatures
			const result = await simulateSafeTransaction(walletClient, tx);

			// Verify simulation shows failure
			expect(result.success).toBe(false);
		});
	});

	describe("simulateSafeTransaction with signatures", () => {
		it("should simulate a successful transaction with valid signatures", async () => {
			// Deploy a Safe
			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			// Fund the Safe
			const fundTxHash = await walletClient.sendTransaction({
				to: safeAddress,
				value: 10000000000000000000n, // 10 ETH
			});
			await publicClient.waitForTransactionReceipt({ hash: fundTxHash });

			// Build and sign a transaction
			const recipient = randomAddress();
			const tx = await buildSafeTransaction(
				walletClient,
				safeAddress,
				[
					{
						to: recipient,
						value: 1000000000000000000n, // 1 ETH
						data: "0x",
					},
				],
				{ nonce: 0n },
			);

			const signature = await signSafeTransaction(
				walletClient,
				tx,
				walletClient.account.address,
			);

			// Simulate with signatures
			const result = await simulateSafeTransaction(walletClient, tx, [
				signature,
			]);

			// Verify simulation result
			expect(result.success).toBe(true);
			expect(result.returnData).toBeDefined();
		});

		it("should simulate a failing transaction with insufficient balance", async () => {
			// Deploy a Safe
			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			// Build a transaction that will fail (no balance in Safe)
			const recipient = randomAddress();
			const tx = await buildSafeTransaction(
				walletClient,
				safeAddress,
				[
					{
						to: recipient,
						value: 1000000000000000000n, // 1 ETH
						data: "0x",
					},
				],
				{ nonce: 0n },
			);

			const signature = await signSafeTransaction(
				walletClient,
				tx,
				walletClient.account.address,
			);

			// Simulate with signatures
			const result = await simulateSafeTransaction(walletClient, tx, [
				signature,
			]);

			// Verify simulation shows failure
			expect(result.success).toBe(false);
		});

		it("should fail simulation with invalid signatures", async () => {
			// Deploy a Safe with owner1
			const owner1 = walletClient.account.address;
			const owner2 = walletClients[1].account.address;

			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [owner1, owner2],
				threshold: 2n, // Requires 2 signatures
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			// Fund the Safe
			const fundTxHash = await walletClient.sendTransaction({
				to: safeAddress,
				value: 10000000000000000000n, // 10 ETH
			});
			await publicClient.waitForTransactionReceipt({ hash: fundTxHash });

			// Build a transaction
			const recipient = randomAddress();
			const tx = await buildSafeTransaction(
				walletClient,
				safeAddress,
				[
					{
						to: recipient,
						value: 1000000000000000000n, // 1 ETH
						data: "0x",
					},
				],
				{ nonce: 0n },
			);

			// Sign with only one owner (need 2)
			const signature = await signSafeTransaction(
				walletClient,
				tx,
				walletClient.account.address,
			);

			// Simulate with insufficient signatures
			const result = await simulateSafeTransaction(walletClient, tx, [
				signature,
			]);

			// Verify simulation shows failure due to insufficient signatures
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	describe("simulation comparison", () => {
		it.skip("should produce consistent results with and without signatures for valid transactions (requires SimulateTxAccessor deployment)", async () => {
			// Deploy a Safe
			const safeDeployment = await deploySafeAccount(walletClient, {
				owners: [walletClient.account.address],
				threshold: 1n,
			});
			const deployTxHash = await safeDeployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
			const safeAddress = safeDeployment.data.safeAddress;

			// Fund the Safe
			const fundTxHash = await walletClient.sendTransaction({
				to: safeAddress,
				value: 10000000000000000000n, // 10 ETH
			});
			await publicClient.waitForTransactionReceipt({ hash: fundTxHash });

			// Build a transaction
			const recipient = randomAddress();
			const tx = await buildSafeTransaction(
				walletClient,
				safeAddress,
				[
					{
						to: recipient,
						value: 1000000000000000000n, // 1 ETH
						data: "0x",
					},
				],
				{ nonce: 0n },
			);

			// Simulate without signatures
			const resultWithoutSigs = await simulateSafeTransaction(walletClient, tx);

			// Sign and simulate with signatures
			const signature = await signSafeTransaction(
				walletClient,
				tx,
				walletClient.account.address,
			);
			const resultWithSigs = await simulateSafeTransaction(walletClient, tx, [
				signature,
			]);

			// Both should succeed
			expect(resultWithoutSigs.success).toBe(true);
			expect(resultWithSigs.success).toBe(true);
		});
	});
});
