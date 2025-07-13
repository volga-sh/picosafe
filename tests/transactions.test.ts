/**
 * @fileoverview Integration tests for Safe transaction functionality.
 *
 * These tests verify that Safe transaction building, signing, and execution work correctly:
 * - Building transactions with various configurations
 * - Signing transactions using EIP-712
 * - Executing transactions with proper signatures
 * - Handling edge cases and error conditions
 *
 * Tests run against a local Anvil blockchain with real Safe contracts deployed.
 */

import {
	type Address,
	checksumAddress,
	encodeFunctionData,
	type Hex,
	parseAbiItem,
	parseEther,
	recoverAddress,
} from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeMultiSendCall, SAFE_STORAGE_SLOTS } from "../src";
import { deploySafeAccount } from "../src/deployment";
import { calculateSafeTransactionHash } from "../src/eip712";
import { V141_ADDRESSES } from "../src/safe-contracts";
import {
	buildSafeTransaction,
	executeSafeTransaction,
	signSafeTransaction,
} from "../src/transactions";
import type {
	EIP1193ProviderWithRequestFn,
	MetaTransaction,
	SafeSignature,
} from "../src/types";
import { Operation } from "../src/types";
import { EMPTY_BYTES, ZERO_ADDRESS } from "../src/utilities/constants";
import { getChainId } from "../src/utilities/eip1193-provider";
import { createClients, snapshot } from "./fixtures/setup";
import { randomAddress, randomBytesHex } from "./utils";

describe("Safe Transaction Functions", () => {
	const clients = createClients();
	const { testClient, publicClient, walletClients } = clients;
	const walletClient = walletClients[0];
	let resetSnapshot: () => Promise<void>;
	let safeAddress: Address;

	beforeEach(async () => {
		resetSnapshot = await snapshot(testClient);

		const safeDeployment = await deploySafeAccount(walletClient, {
			owners: [walletClient.account.address],
			threshold: 1n,
		});
		const deployTxHash = await safeDeployment.send();
		await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
		safeAddress = safeDeployment.data.safeAddress;
	});

	afterEach(async () => {
		await resetSnapshot();
	});

	describe("buildSafeTransaction", () => {
		describe("Single transaction scenarios", () => {
			it("should build a simple ETH transfer transaction", async () => {
				const recipientAddress = walletClients[1].account.address;
				const value = parseEther("1");

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: recipientAddress,
							value,
						},
					],
				);

				expect(transaction).toBeDefined();
				expect(transaction.to).toBe(recipientAddress);
				expect(transaction.value).toBe(value);
				expect(transaction.data).toBe(EMPTY_BYTES);
				expect(transaction.operation).toBe(Operation.Call);
				expect(transaction.safeTxGas).toBe(0n);
				expect(transaction.baseGas).toBe(0n);
				expect(transaction.gasPrice).toBe(0n);
				expect(transaction.gasToken).toBe(ZERO_ADDRESS);
				expect(transaction.refundReceiver).toBe(ZERO_ADDRESS);
				expect(transaction.nonce).toBe(0n);
				expect(transaction.safeAddress).toBe(safeAddress);
				expect(transaction.chainId).toBe(31337n);
			});

			it("should build a contract interaction transaction", async () => {
				const targetContract = randomAddress();
				const callData = encodeFunctionData({
					abi: [parseAbiItem("function transfer(address to, uint256 amount)")],
					functionName: "transfer",
					args: [randomAddress(), parseEther("10")],
				});

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: targetContract,
							value: 0n,
							data: callData,
						},
					],
				);

				expect(transaction).toBeDefined();
				expect(transaction.to).toBe(targetContract);
				expect(transaction.value).toBe(0n);
				expect(transaction.data).toBe(callData);
				expect(transaction.operation).toBe(Operation.Call);
				expect(transaction.safeTxGas).toBe(0n);
				expect(transaction.baseGas).toBe(0n);
				expect(transaction.gasPrice).toBe(0n);
				expect(transaction.gasToken).toBe(ZERO_ADDRESS);
				expect(transaction.refundReceiver).toBe(ZERO_ADDRESS);
				expect(transaction.nonce).toBe(0n);
				expect(transaction.safeAddress).toBe(safeAddress);
				expect(transaction.chainId).toBe(31337n);
			});

			it("should build a transaction with custom parameters specified in transactionOptions", async () => {
				const recipient = randomAddress();
				const customSafeTxGas = 100000n;
				const customBaseGas = 50000n;
				const customGasPrice = parseEther("0.01");
				const customGasToken = randomAddress();
				const customRefundReceiver = randomAddress();
				const nonce = 1337n;
				const chainId = 1337n;

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: recipient,
							value: parseEther("0.1"),
						},
					],
					{
						safeTxGas: customSafeTxGas,
						baseGas: customBaseGas,
						gasPrice: customGasPrice,
						gasToken: customGasToken,
						refundReceiver: customRefundReceiver,
						nonce,
						chainId,
					},
				);

				expect(transaction.safeTxGas).toBe(customSafeTxGas);
				expect(transaction.baseGas).toBe(customBaseGas);
				expect(transaction.gasPrice).toBe(customGasPrice);
				expect(transaction.gasToken).toBe(customGasToken);
				expect(transaction.refundReceiver).toBe(customRefundReceiver);
				expect(transaction.nonce).toBe(nonce);
				expect(transaction.safeAddress).toBe(safeAddress);
				expect(transaction.chainId).toBe(chainId);
				expect(transaction.operation).toBe(Operation.Call);
				expect(transaction.to).toBe(recipient);
				expect(transaction.value).toBe(parseEther("0.1"));
				expect(transaction.data).toBe(EMPTY_BYTES);
			});

			it("should build a delegate call transaction when UNSAFE_DELEGATE_CALL is true", async () => {
				const targetContract = randomAddress();
				const delegateCallData = encodeFunctionData({
					abi: [parseAbiItem("function setOwner(address owner)")],
					functionName: "setOwner",
					args: [randomAddress()],
				});

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: targetContract,
							value: 0n,
							data: delegateCallData,
						},
					],
					{
						UNSAFE_DELEGATE_CALL: true,
					},
				);

				expect(transaction.operation).toBe(Operation.UNSAFE_DELEGATECALL);
				expect(transaction.to).toBe(targetContract);
				expect(transaction.value).toBe(0n);
				expect(transaction.data).toBe(delegateCallData);
				expect(transaction.safeAddress).toBe(safeAddress);
				expect(transaction.chainId).toBe(31337n);
			});
		});

		describe("Multi-transaction (MultiSend) scenarios", () => {
			it("should batch multiple transactions using MultiSend", async () => {
				const recipient1 = randomAddress();
				const recipient2 = randomAddress();

				const transactions: MetaTransaction[] = [
					{
						to: recipient1,
						value: parseEther("0.5"),
						data: EMPTY_BYTES,
					},
					{
						to: recipient2,
						value: parseEther("0.3"),
						data: EMPTY_BYTES,
					},
				];

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					transactions,
				);

				expect(transaction.to).toBe(V141_ADDRESSES.MultiSendCallOnly);
				expect(transaction.value).toBe(0n); // Value is 0 because MultiSend executes via delegatecall in Safe context
				expect(transaction.data).toMatch(encodeMultiSendCall(transactions)); // multiSend selector
				expect(transaction.operation).toBe(Operation.UNSAFE_DELEGATECALL);
				expect(transaction.safeAddress).toBe(safeAddress);
				expect(transaction.chainId).toBe(31337n);
				expect(transaction.nonce).toBe(0n);
				expect(transaction.safeTxGas).toBe(0n);
				expect(transaction.baseGas).toBe(0n);
				expect(transaction.gasPrice).toBe(0n);
				expect(transaction.gasToken).toBe(ZERO_ADDRESS);
				expect(transaction.refundReceiver).toBe(ZERO_ADDRESS);
			});

			it("should handle batch with mixed ETH transfers and contract calls", async () => {
				const recipient = randomAddress();
				const mockContract = randomAddress();

				const transactions: MetaTransaction[] = [
					{
						to: recipient,
						value: parseEther("1"),
						data: EMPTY_BYTES,
					},
					{
						to: mockContract,
						value: 0n,
						data: encodeFunctionData({
							abi: [
								parseAbiItem(
									"function approve(address spender, uint256 amount)",
								),
							],
							functionName: "approve",
							args: [randomAddress(), parseEther("100")],
						}),
					},
					{
						to: recipient,
						value: parseEther("0.5"),
						data: EMPTY_BYTES,
					},
				];

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					transactions,
				);

				expect(transaction.to).toBe(V141_ADDRESSES.MultiSendCallOnly);
				expect(transaction.data).toMatch(encodeMultiSendCall(transactions)); // multiSend selector
				expect(transaction.operation).toBe(Operation.UNSAFE_DELEGATECALL);
				expect(transaction.safeAddress).toBe(safeAddress);
				expect(transaction.chainId).toBe(31337n);
				expect(transaction.nonce).toBe(0n);
				expect(transaction.safeTxGas).toBe(0n);
				expect(transaction.baseGas).toBe(0n);
				expect(transaction.gasPrice).toBe(0n);
				expect(transaction.gasToken).toBe(ZERO_ADDRESS);
				expect(transaction.refundReceiver).toBe(ZERO_ADDRESS);
			});

			it("should keep value as 0", async () => {
				const transactions: MetaTransaction[] = [
					{
						to: walletClients[1].account.address,
						value: parseEther("1"),
						data: EMPTY_BYTES,
					},
					{
						to: walletClients[2].account.address,
						value: parseEther("2"),
						data: EMPTY_BYTES,
					},
					{
						to: walletClients[3].account.address,
						value: parseEther("3"),
						data: EMPTY_BYTES,
					},
				];

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					transactions,
				);

				// The Safe transaction value should be 0 because MultiSend is executed via delegatecall
				// The individual transaction values are encoded in the MultiSend data and executed
				// within the Safe context, so the Safe already has access to its balance
				expect(transaction.value).toBe(0n);
			});

			it("should handle empty data fields in batched transactions", async () => {
				const transactions: MetaTransaction[] = [
					{
						to: walletClients[1].account.address,
						value: parseEther("0.1"),
						data: EMPTY_BYTES,
					},
					{
						to: walletClients[2].account.address,
						value: 0n,
						data: EMPTY_BYTES,
					},
					{
						to: walletClients[3].account.address,
						value: parseEther("0.2"),
						data: EMPTY_BYTES,
					},
				];

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					transactions,
				);

				// Should not throw and properly encode empty data
				expect(transaction).toBeDefined();
				expect(transaction.to).toBe(V141_ADDRESSES.MultiSendCallOnly);
				expect(transaction.data).toMatch(encodeMultiSendCall(transactions)); // multiSend selector
				expect(transaction.operation).toBe(Operation.UNSAFE_DELEGATECALL);
				expect(transaction.safeAddress).toBe(safeAddress);
				expect(transaction.chainId).toBe(31337n);
				expect(transaction.nonce).toBe(0n);
				expect(transaction.safeTxGas).toBe(0n);
				expect(transaction.baseGas).toBe(0n);
				expect(transaction.gasPrice).toBe(0n);
			});

			it("should throw error when no transactions provided", async () => {
				await expect(
					buildSafeTransaction(walletClient, safeAddress, []),
				).rejects.toThrow("No transactions provided");
			});

			it("should auto-fetch nonce from the provider / safe when not provided", async () => {
				const nonce = randomBytesHex(32);
				await testClient.setStorageAt({
					address: safeAddress,
					index: SAFE_STORAGE_SLOTS.nonce,
					value: nonce,
				});

				const transaction1 = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: walletClients[1].account.address,
							value: parseEther("0.1"),
							data: EMPTY_BYTES,
						},
					],
					// No nonce specified
				);

				expect(transaction1.nonce).toBe(BigInt(nonce));
			});

			it("should auto-fetch chainId from the provider when not provided", async () => {
				const chainId = await getChainId(walletClient);
				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: walletClients[1].account.address,
							value: 0n,
							data: EMPTY_BYTES,
						},
					],
					// No chainId specified
				);

				expect(transaction.chainId).toBe(chainId);
			});

			it("should return checksummed addresses in the transaction object", async () => {
				const recipientLower = randomAddress().toLowerCase() as Address;

				const tx = await buildSafeTransaction(
					walletClient,
					safeAddress.toLowerCase() as Address,
					[
						{
							to: recipientLower,
							value: 0n,
							data: EMPTY_BYTES,
						},
					],
					{
						gasToken: recipientLower,
						refundReceiver: recipientLower,
					},
				);

				expect(tx.safeAddress).toBe(safeAddress);
				expect(tx.to).toBe(checksumAddress(recipientLower));
				expect(tx.gasToken).toBe(checksumAddress(recipientLower));
				expect(tx.refundReceiver).toBe(checksumAddress(recipientLower));
			});
		});
	});

	describe("signSafeTransaction", () => {
		describe("Valid signature scenarios", () => {
			it("should sign a transaction with a Safe owner", async () => {
				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: walletClients[1].account.address,
							value: parseEther("0.5"),
							data: EMPTY_BYTES,
						},
					],
				);
				const transactionHash = await calculateSafeTransactionHash(transaction);

				const signature = await signSafeTransaction(walletClient, transaction);
				const recoveredSigner = await recoverAddress({
					hash: transactionHash,
					signature: signature.data,
				});

				expect(recoveredSigner).toBe(walletClient.account.address);
			});

			it("should produce EIP-712 signatures with Safe Encoding", async () => {
				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: walletClients[1].account.address,
							value: 0n,
							data: EMPTY_BYTES,
						},
					],
				);

				const signature = await signSafeTransaction(walletClient, transaction);

				// EIP-712 signatures should be 65 bytes (r: 32, s: 32, v: 1)
				const signatureBytes = signature.data.slice(2); // Remove 0x prefix
				expect(signatureBytes.length).toBe(130); // 65 bytes * 2 hex chars per byte

				// Safe Encoding expects v to be 27 or 28 (0x1b or 0x1c in hex) for EIP-712 signatures
				const v = signatureBytes.slice(128, 130);
				expect(["1b", "1c"]).toContain(v);
			});

			it("should sign transactions with multiple owners", async () => {
				const multiOwnerSafe = await deploySafeAccount(walletClient, {
					owners: [
						walletClients[0].account.address,
						walletClients[1].account.address,
						walletClients[2].account.address,
					],
					threshold: 2n,
				});
				const deployTxHash = await multiOwnerSafe.send();
				await publicClient.waitForTransactionReceipt({ hash: deployTxHash });

				const transaction = await buildSafeTransaction(
					walletClient,
					multiOwnerSafe.data.safeAddress,
					[
						{
							to: walletClients[4].account.address,
							value: parseEther("0.1"),
							data: EMPTY_BYTES,
						},
					],
				);

				const transactionHash = await calculateSafeTransactionHash(transaction);

				const signature1 = await signSafeTransaction(
					walletClients[0],
					transaction,
					walletClients[0].account.address,
				);
				const signature2 = await signSafeTransaction(
					walletClients[1],
					transaction,
					walletClients[1].account.address,
				);
				const signature3 = await signSafeTransaction(
					walletClients[2],
					transaction,
					walletClients[2].account.address,
				);

				const recoveredSigner1 = await recoverAddress({
					hash: transactionHash,
					signature: signature1.data,
				});
				const recoveredSigner2 = await recoverAddress({
					hash: transactionHash,
					signature: signature2.data,
				});
				const recoveredSigner3 = await recoverAddress({
					hash: transactionHash,
					signature: signature3.data,
				});

				expect(recoveredSigner1).toBe(walletClients[0].account.address);
				expect(recoveredSigner2).toBe(walletClients[1].account.address);
				expect(recoveredSigner3).toBe(walletClients[2].account.address);
			});
		});

		describe("Edge cases and error scenarios", () => {
			it("should fail when signer is not connected to provider", async () => {
				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: walletClients[1].account.address,
							value: 0n,
							data: EMPTY_BYTES,
						},
					],
				);

				const providerWithoutAccount = {
					...publicClient,
					request: async ({ method }: { method: string }) => {
						if (method === "eth_accounts") {
							return [];
						}
						return publicClient.request({ method } as Parameters<
							typeof publicClient.request
						>[0]);
					},
				};

				await expect(
					signSafeTransaction(
						providerWithoutAccount as EIP1193ProviderWithRequestFn,
						transaction,
					),
				).rejects.toThrow("No signer address provided and no accounts found");
			});
		});
	});

	describe("executeSafeTransaction", () => {
		describe("Successful execution scenarios", () => {
			it("should execute a transaction with threshold signatures", async () => {
				const recipientAddress = walletClients[1].account.address;
				const recipientBalanceBefore = await publicClient.getBalance({
					address: recipientAddress,
				});

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: recipientAddress,
							value: parseEther("0.1"),
							data: EMPTY_BYTES,
						},
					],
				);

				await testClient.setBalance({
					address: safeAddress,
					value: parseEther("0.5"),
				});

				const signature = await signSafeTransaction(walletClient, transaction);

				const executeTx = await executeSafeTransaction(
					walletClient,
					transaction,
					[signature],
				);
				const txHash = await executeTx.send();
				await publicClient.waitForTransactionReceipt({ hash: txHash });

				const recipientBalanceAfter = await publicClient.getBalance({
					address: recipientAddress,
				});
				expect(recipientBalanceAfter - recipientBalanceBefore).toBe(
					parseEther("0.1"),
				);
			});

			it("should execute with more signatures than threshold", async () => {
				const multiSigSafe = await deploySafeAccount(walletClient, {
					owners: [
						walletClients[0].account.address,
						walletClients[1].account.address,
						walletClients[2].account.address,
					],
					threshold: 2n,
				});
				const deployTxHash = await multiSigSafe.send();
				await publicClient.waitForTransactionReceipt({ hash: deployTxHash });

				const transaction = await buildSafeTransaction(
					walletClient,
					multiSigSafe.data.safeAddress,
					[
						{
							to: walletClients[4].account.address,
							value: parseEther("0.05"),
							data: EMPTY_BYTES,
						},
					],
				);

				await testClient.setBalance({
					address: multiSigSafe.data.safeAddress,
					value: parseEther("0.5"),
				});

				const signature1 = await signSafeTransaction(
					walletClients[0],
					transaction,
					walletClients[0].account.address,
				);
				const signature2 = await signSafeTransaction(
					walletClients[1],
					transaction,
					walletClients[1].account.address,
				);
				const signature3 = await signSafeTransaction(
					walletClients[2],
					transaction,
					walletClients[2].account.address,
				);

				const executeTx = await executeSafeTransaction(
					walletClient,
					transaction,
					[signature1, signature2, signature3],
				);
				const txHash = await executeTx.send();
				const receipt = await publicClient.waitForTransactionReceipt({
					hash: txHash,
				});

				expect(receipt.status).toBe("success");
			});

			it("should execute MultiSend batch transaction", async () => {
				await testClient.setBalance({
					address: safeAddress,
					value: parseEther("2"),
				});

				const recipient1 = walletClients[1].account.address;
				const recipient2 = walletClients[2].account.address;
				const amount1 = parseEther("0.3");
				const amount2 = parseEther("0.2");

				const balance1Before = await publicClient.getBalance({
					address: recipient1,
				});
				const balance2Before = await publicClient.getBalance({
					address: recipient2,
				});

				const transactions: MetaTransaction[] = [
					{
						to: recipient1,
						value: amount1,
						data: EMPTY_BYTES,
					},
					{
						to: recipient2,
						value: amount2,
						data: EMPTY_BYTES,
					},
				];

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					transactions,
				);

				const signature = await signSafeTransaction(walletClient, transaction);
				const executeTx = await executeSafeTransaction(
					walletClient,
					transaction,
					[signature],
				);
				const txHash = await executeTx.send();
				await publicClient.waitForTransactionReceipt({ hash: txHash });

				const balance1After = await publicClient.getBalance({
					address: recipient1,
				});
				const balance2After = await publicClient.getBalance({
					address: recipient2,
				});

				expect(balance1After - balance1Before).toBe(amount1);
				expect(balance2After - balance2Before).toBe(amount2);
			});

			it("should return transaction hash from send()", async () => {
				await testClient.setBalance({
					address: safeAddress,
					value: parseEther("0.1"),
				});

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: walletClients[1].account.address,
							value: parseEther("0.01"),
							data: EMPTY_BYTES,
						},
					],
				);

				const signature = await signSafeTransaction(walletClient, transaction);
				const executeTx = await executeSafeTransaction(
					walletClient,
					transaction,
					[signature],
				);

				const txHash = await executeTx.send();
				const receipt = await publicClient.waitForTransactionReceipt({
					hash: txHash,
				});
				expect(receipt.status).toBe("success");
				expect(receipt.to).toBe(safeAddress);
			});

			it("should provide raw transaction data", async () => {
				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: walletClients[1].account.address,
							value: parseEther("0.05"),
							data: EMPTY_BYTES,
						},
					],
				);

				const signature = await signSafeTransaction(walletClient, transaction);
				const executeTx = await executeSafeTransaction(
					walletClient,
					transaction,
					[signature],
				);

				expect(executeTx.rawTransaction).toBeDefined();
				expect(executeTx.rawTransaction.to).toBe(safeAddress);
				expect(executeTx.rawTransaction.value).toBe(0n);
				expect(executeTx.rawTransaction.data).toMatch(/^0x6a761202/);
			});
		});

		describe("Signature validation scenarios", () => {
			it("should fail with insufficient signatures", async () => {
				const multiSigSafe = await deploySafeAccount(walletClient, {
					owners: [
						walletClients[0].account.address,
						walletClients[1].account.address,
						walletClients[2].account.address,
					],
					threshold: 2n,
				});
				const deployTxHash = await multiSigSafe.send();
				await publicClient.waitForTransactionReceipt({ hash: deployTxHash });

				const transaction = await buildSafeTransaction(
					walletClient,
					multiSigSafe.data.safeAddress,
					[
						{
							to: walletClients[4].account.address,
							value: parseEther("0.01"),
							data: EMPTY_BYTES,
						},
					],
				);

				const signature = await signSafeTransaction(
					walletClients[0],
					transaction,
					walletClients[0].account.address,
				);

				const executeTx = await executeSafeTransaction(
					walletClient,
					transaction,
					[signature], // Only 1 signature, need 2
				);

				await expect(executeTx.send()).rejects.toThrow();
			});

			it("should fail with invalid signature data", async () => {
				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: walletClients[1].account.address,
							value: 0n,
							data: EMPTY_BYTES,
						},
					],
				);

				const invalidSignature: SafeSignature = {
					signer: walletClient.account.address,
					data: `0x${"00".repeat(65)}` as Hex, // All zeros signature
				};

				const executeTx = await executeSafeTransaction(
					walletClient,
					transaction,
					[invalidSignature],
				);

				await expect(executeTx.send()).rejects.toThrow();
			});

			it("should handle signatures in wrong order", async () => {
				const multiSigSafe = await deploySafeAccount(walletClient, {
					owners: [
						walletClients[0].account.address,
						walletClients[1].account.address,
						walletClients[2].account.address,
					],
					threshold: 2n,
				});
				const deployTxHash = await multiSigSafe.send();
				await publicClient.waitForTransactionReceipt({ hash: deployTxHash });

				const transaction = await buildSafeTransaction(
					walletClient,
					multiSigSafe.data.safeAddress,
					[
						{
							to: walletClients[4].account.address,
							value: parseEther("0.01"),
							data: EMPTY_BYTES,
						},
					],
				);

				const signature0 = await signSafeTransaction(
					walletClients[0],
					transaction,
					walletClients[0].account.address,
				);
				const signature2 = await signSafeTransaction(
					walletClients[2],
					transaction,
					walletClients[2].account.address,
				);

				await testClient.setBalance({
					address: multiSigSafe.data.safeAddress,
					value: parseEther("0.5"),
				});

				// Check which address is higher
				const addr0 = walletClients[0].account.address.toLowerCase();
				const addr2 = walletClients[2].account.address.toLowerCase();

				// Pass signatures in wrong order (SDK should sort them)
				const signatures =
					addr0 < addr2
						? [signature2, signature0] // Wrong order
						: [signature0, signature2]; // Wrong order

				const executeTx = await executeSafeTransaction(
					walletClient,
					transaction,
					signatures,
				);

				// Should succeed because SDK sorts signatures
				const txHash = await executeTx.send();
				const receipt = await publicClient.waitForTransactionReceipt({
					hash: txHash,
				});
				expect(receipt.status).toBe("success");
			});
		});
	});
});
