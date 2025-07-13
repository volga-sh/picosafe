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

import { type Address, encodeFunctionData, type Hex, parseEther } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deploySafeAccount } from "../src/deployment";
import { V141_ADDRESSES } from "../src/safe-contracts";
import {
	buildSafeTransaction,
	executeSafeTransaction,
	signSafeTransaction,
} from "../src/transactions";
import type { MetaTransaction, SafeSignature } from "../src/types";
import { Operation } from "../src/types";
import { EMPTY_BYTES, ZERO_ADDRESS } from "../src/utilities/constants";
import { createClients, snapshot } from "./fixtures/setup";

describe("Safe Transaction Functions", () => {
	const clients = createClients();
	const { testClient, publicClient, walletClients } = clients;
	const walletClient = walletClients[0];
	let resetSnapshot: () => Promise<void>;
	let safeAddress: Address;

	beforeEach(async () => {
		resetSnapshot = await snapshot(testClient);
		// Deploy a test Safe for transaction tests
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
				// Test case: Build a transaction to transfer 1 ETH
				// Expected: Correct transaction structure with proper defaults
				const recipientAddress = walletClients[1].account.address;
				const value = parseEther("1");

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: recipientAddress,
							value,
							data: EMPTY_BYTES,
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
				expect(transaction.nonce).toBe(0n); // First transaction
				expect(transaction.safeAddress).toBe(safeAddress);
				expect(transaction.chainId).toBe(31337n); // Anvil default chain ID
			});

			it("should build a contract interaction transaction", async () => {
				// Test case: Build a transaction to call a contract method
				// Expected: Correct encoding of contract call data
				const targetContract = walletClients[2].account.address; // Use any address as mock contract
				const callData = encodeFunctionData({
					abi: [
						{
							type: "function",
							name: "transfer",
							inputs: [
								{ name: "to", type: "address" },
								{ name: "amount", type: "uint256" },
							],
							outputs: [{ name: "", type: "bool" }],
							stateMutability: "nonpayable",
						},
					],
					functionName: "transfer",
					args: [walletClients[3].account.address, parseEther("10")],
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
			});

			it("should build a transaction with custom gas parameters specified in transactionOptions", async () => {
				// Test case: Build with custom safeTxGas, baseGas, gasPrice
				// Expected: Custom values preserved in transaction
				const customSafeTxGas = 100000n;
				const customBaseGas = 50000n;
				const customGasPrice = parseEther("0.01");

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: walletClients[1].account.address,
							value: parseEther("0.1"),
							data: EMPTY_BYTES,
						},
					],
					{
						safeTxGas: customSafeTxGas,
						baseGas: customBaseGas,
						gasPrice: customGasPrice,
					},
				);

				expect(transaction.safeTxGas).toBe(customSafeTxGas);
				expect(transaction.baseGas).toBe(customBaseGas);
				expect(transaction.gasPrice).toBe(customGasPrice);
			});

			it("should build a transaction with gas token payment specified in transactionOptions", async () => {
				// Test case: Build with custom gasToken and refundReceiver
				// Expected: Token payment parameters correctly set
				const gasTokenAddress =
					"0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address; // Mock DAI address
				const refundReceiverAddress = walletClients[4].account.address;

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
					{
						gasToken: gasTokenAddress,
						refundReceiver: refundReceiverAddress,
						gasPrice: parseEther("0.001"),
					},
				);

				expect(transaction.gasToken).toBe(gasTokenAddress);
				expect(transaction.refundReceiver).toBe(refundReceiverAddress);
			});

			it("should build a transaction with nonce specified in transactionOptions", async () => {
				// Test case: Build with explicit nonce value
				// Expected: Uses provided nonce instead of fetching current
				const customNonce = 42n;

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
					{
						nonce: customNonce,
					},
				);

				expect(transaction.nonce).toBe(customNonce);
			});

			it("should build a transaction with chainId specified in transactionOptions", async () => {
				// Test case: Build with explicit chainId
				// Expected: Uses provided chainId instead of fetching from provider
				const customChainId = 1n; // Mainnet chain ID

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
					{
						chainId: customChainId,
					},
				);

				expect(transaction.chainId).toBe(customChainId);
			});

			it("should build a delegate call transaction when UNSAFE_DELEGATE_CALL is true", async () => {
				// Test case: Build with UNSAFE_DELEGATE_CALL option
				// Expected: Operation type is DELEGATECALL (1)
				const targetContract = walletClients[2].account.address;
				const delegateCallData = encodeFunctionData({
					abi: [
						{
							type: "function",
							name: "setOwner",
							inputs: [{ name: "owner", type: "address" }],
							outputs: [],
							stateMutability: "nonpayable",
						},
					],
					functionName: "setOwner",
					args: [walletClients[3].account.address],
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
			});
		});

		describe("Multi-transaction (MultiSend) scenarios", () => {
			it("should batch multiple transactions using MultiSend", async () => {
				// Test case: Build with array of 2+ transactions
				// Expected: Target is MultiSendCallOnly, data is encoded batch
				const recipient1 = walletClients[1].account.address;
				const recipient2 = walletClients[2].account.address;

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
				expect(transaction.data).toMatch(/^0x8d80ff0a/); // multiSend selector
				expect(transaction.operation).toBe(Operation.UNSAFE_DELEGATECALL);
			});

			it("should handle batch with mixed ETH transfers and contract calls", async () => {
				// Test case: Batch containing various transaction types
				// Expected: All transactions properly encoded in MultiSend
				const recipient = walletClients[1].account.address;
				const mockContract = walletClients[2].account.address;

				const contractCallData = encodeFunctionData({
					abi: [
						{
							type: "function",
							name: "approve",
							inputs: [
								{ name: "spender", type: "address" },
								{ name: "amount", type: "uint256" },
							],
							outputs: [{ name: "", type: "bool" }],
							stateMutability: "nonpayable",
						},
					],
					functionName: "approve",
					args: [walletClients[3].account.address, parseEther("100")],
				});

				const transactions: MetaTransaction[] = [
					{
						to: recipient,
						value: parseEther("1"),
						data: EMPTY_BYTES,
					},
					{
						to: mockContract,
						value: 0n,
						data: contractCallData,
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
				expect(transaction.data).toMatch(/^0x8d80ff0a/); // multiSend selector
			});

			it("should calculate correct total value for batched transfers", async () => {
				// Test case: Batch multiple ETH transfers
				// Expected: Value field is 0 (values handled in MultiSend data)
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
				expect(transaction.to).toBe(V141_ADDRESSES.MultiSendCallOnly);
			});

			it("should handle empty data fields in batched transactions", async () => {
				// Test case: Batch transactions with data = '0x'
				// Expected: Empty data properly encoded
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
						data: "0x", // Explicitly empty
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
				expect(transaction.data).toMatch(/^0x8d80ff0a/); // multiSend selector
			});
		});

		describe("Edge cases and error scenarios", () => {
			it("should throw error when no transactions provided", async () => {
				// Test case: Empty transactions array
				// Expected: Error "No transactions provided"
				await expect(
					buildSafeTransaction(
						walletClient,
						safeAddress,
						[], // Empty array
					),
				).rejects.toThrow("No transactions provided");
			});

			it("should handle zero value transfers", async () => {
				// Test case: Transaction with value = 0n
				// Expected: Transaction built successfully with zero value
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

				expect(transaction).toBeDefined();
				expect(transaction.value).toBe(0n);
				expect(transaction.to).toBe(walletClients[1].account.address);
			});

			it("should handle maximum uint256 values", async () => {
				// Test case: Transaction with max safe integer values
				// Expected: BigInt values handled correctly
				const maxUint256 = 2n ** 256n - 1n;

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: walletClients[1].account.address,
							value: maxUint256,
							data: EMPTY_BYTES,
						},
					],
					{
						safeTxGas: maxUint256,
						baseGas: maxUint256,
						gasPrice: maxUint256,
					},
				);

				expect(transaction.value).toBe(maxUint256);
				expect(transaction.safeTxGas).toBe(maxUint256);
				expect(transaction.baseGas).toBe(maxUint256);
				expect(transaction.gasPrice).toBe(maxUint256);
			});

			it("should auto-fetch nonce from the provider / safe when not provided", async () => {
				// Test case: Build without nonce option
				// Expected: Fetches current Safe nonce
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

				// First transaction should have nonce 0
				expect(transaction1.nonce).toBe(0n);

				// Fund the Safe for the transactions
				await testClient.setBalance({
					address: safeAddress,
					value: parseEther("1"),
				});

				// Execute the transaction to increment nonce
				const signature = await signSafeTransaction(walletClient, transaction1);
				const executeTx = await executeSafeTransaction(
					walletClient,
					transaction1,
					[signature],
				);
				const txHash = await executeTx.send();
				await publicClient.waitForTransactionReceipt({ hash: txHash });

				// Build another transaction without specifying nonce
				const transaction2 = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: walletClients[2].account.address,
							value: parseEther("0.2"),
							data: EMPTY_BYTES,
						},
					],
				);

				// Second transaction should have nonce 1
				expect(transaction2.nonce).toBe(1n);
			});

			it("should auto-fetch chainId from the provider when not provided", async () => {
				// Test case: Build without chainId option
				// Expected: Fetches current chain ID from provider
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

				// Should fetch from provider (Anvil default is 31337)
				expect(transaction.chainId).toBe(31337n);
			});

			it("should return checksummed addresses in the transaction object", async () => {
				// Provide lower-case inputs and expect checksummed outputs
				const recipientLower =
					walletClients[1].account.address.toLowerCase() as Address;

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

				// Returned fields should be in EIP-55 checksum format (match original mixed-case address)
				expect(tx.safeAddress).toBe(safeAddress);
				expect(tx.to).toBe(walletClients[1].account.address);
				expect(tx.gasToken).toBe(walletClients[1].account.address);
				expect(tx.refundReceiver).toBe(walletClients[1].account.address);
			});
		});
	});

	describe("signSafeTransaction", () => {
		describe("Valid signature scenarios", () => {
			it("should sign a transaction with a Safe owner", async () => {
				// Test case: Sign transaction with valid owner account
				// Expected: Returns SafeSignature with correct signer and data
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

				const signature = await signSafeTransaction(walletClient, transaction);

				expect(signature).toBeDefined();
				expect(signature.signer).toBe(walletClient.account.address);
				expect(signature.data).toMatch(/^0x[a-fA-F0-9]{130}$/); // 65 bytes = 130 hex chars
				expect(signature.dynamic).toBeUndefined();
			});

			it("should produce EIP-712 compliant signatures", async () => {
				// Test case: Verify signature follows EIP-712 standard
				// Expected: 65-byte signature in correct format
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

				// Check signature components
				const r = signatureBytes.slice(0, 64);
				const s = signatureBytes.slice(64, 128);
				const v = signatureBytes.slice(128, 130);

				// r and s should be 32 bytes each
				expect(r).toMatch(/^[a-fA-F0-9]{64}$/);
				expect(s).toMatch(/^[a-fA-F0-9]{64}$/);
				// v should be 27 or 28 (0x1b or 0x1c in hex)
				expect(["1b", "1c"]).toContain(v);
			});

			it("should sign transactions with different parameters", async () => {
				// Test case: Sign transactions with various gas/nonce values
				// Expected: Different signatures for different parameters
				const baseTransaction: MetaTransaction = {
					to: walletClients[1].account.address,
					value: parseEther("1"),
					data: EMPTY_BYTES,
				};

				// Build two transactions with different parameters
				const transaction1 = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[baseTransaction],
					{ nonce: 0n, safeTxGas: 100000n },
				);

				const transaction2 = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[baseTransaction],
					{ nonce: 1n, safeTxGas: 200000n },
				);

				const signature1 = await signSafeTransaction(
					walletClient,
					transaction1,
				);
				const signature2 = await signSafeTransaction(
					walletClient,
					transaction2,
				);

				// Different parameters should produce different signatures
				expect(signature1.data).not.toBe(signature2.data);
				expect(signature1.signer).toBe(signature2.signer); // Same signer
			});

			it("should handle signing by multiple owners", async () => {
				// Test case: Multiple owners sign the same transaction
				// Expected: Each produces unique valid signature
				// Deploy a multi-owner Safe
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

				// Have multiple owners sign the same transaction
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

				// Each owner should produce a unique signature
				expect(signature1.signer).toBe(walletClients[0].account.address);
				expect(signature2.signer).toBe(walletClients[1].account.address);
				expect(signature3.signer).toBe(walletClients[2].account.address);

				// Signatures should be different
				expect(signature1.data).not.toBe(signature2.data);
				expect(signature2.data).not.toBe(signature3.data);
				expect(signature1.data).not.toBe(signature3.data);
			});
		});

		describe("Edge cases and error scenarios", () => {
			it("should fail when signer is not connected to provider", async () => {
				// Test case: Sign with address not available in provider
				// Expected: Provider error about account not found
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

				// Create a mock provider that returns no accounts
				const providerWithoutAccount = {
					...publicClient,
					request: async ({ method }: { method: string }) => {
						if (method === "eth_accounts") {
							return [];
						}
						return publicClient.request({ method } as any);
					},
				};

				await expect(
					signSafeTransaction(providerWithoutAccount as any, transaction),
				).rejects.toThrow("No signer address provided and no accounts found");
			});

			it("should handle signing with invalid safe address", async () => {
				// Test case: Sign transaction with invalid safe address format
				// Expected: Function should not validate safe address format during signing
				// Note: The actual validation happens during execution, not signing
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

				// Modify transaction with invalid safe address
				const invalidTransaction = {
					...transaction,
					safeAddress: ZERO_ADDRESS as Address, // Zero address is technically valid format
				};

				// Signing should succeed since address format validation is not done here
				const signature = await signSafeTransaction(
					walletClient,
					invalidTransaction,
				);
				expect(signature).toBeDefined();
				expect(signature.signer).toBe(walletClient.account.address);
			});

			it("should handle malformed transaction objects", async () => {
				// Test case: Missing required fields will cause runtime errors
				// Expected: TypeScript should prevent these at compile time,
				// but at runtime they will throw when trying to access properties
				const validTransaction = await buildSafeTransaction(
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

				// Test with null chainId that would cause toString() to fail
				const invalidChainIdTx = { ...validTransaction, chainId: null } as any;
				await expect(
					signSafeTransaction(walletClient, invalidChainIdTx),
				).rejects.toThrow();

				// Test with string value that would cause toString() to fail
				const invalidValueTx = {
					...validTransaction,
					value: "not a bigint",
				} as any;
				await expect(
					signSafeTransaction(walletClient, invalidValueTx),
				).rejects.toThrow();

				// Test with completely empty object missing all required fields
				const emptyTx = {} as any;
				await expect(
					signSafeTransaction(walletClient, emptyTx),
				).rejects.toThrow();
			});
		});
	});

	describe("executeSafeTransaction", () => {
		describe("Successful execution scenarios", () => {
			it("should execute a transaction with threshold signatures", async () => {
				// Test case: Execute with exact threshold number of signatures
				// Expected: Transaction executed successfully
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

				// Fund the Safe for the transfer
				await testClient.setBalance({
					address: safeAddress,
					value: parseEther("0.5"),
				});

				// Sign with the single owner (threshold is 1)
				const signature = await signSafeTransaction(walletClient, transaction);

				// Execute the transaction
				const executeTx = await executeSafeTransaction(
					walletClient,
					transaction,
					[signature],
				);
				const txHash = await executeTx.send();
				await publicClient.waitForTransactionReceipt({ hash: txHash });

				// Verify the ETH was transferred
				const recipientBalanceAfter = await publicClient.getBalance({
					address: recipientAddress,
				});
				expect(recipientBalanceAfter - recipientBalanceBefore).toBe(
					parseEther("0.1"),
				);
			});

			it("should execute with more signatures than threshold", async () => {
				// Test case: Execute with extra signatures
				// Expected: Transaction executed successfully
				// Deploy a 2-of-3 Safe
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

				// Fund the Safe for the transfer
				await testClient.setBalance({
					address: multiSigSafe.data.safeAddress,
					value: parseEther("0.5"),
				});

				// Get all 3 signatures (more than threshold of 2)
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

				// Execute with all 3 signatures (threshold is 2)
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

			it("should execute ETH transfer transaction", async () => {
				// Test case: Execute actual ETH transfer
				// Expected: ETH balance changes correctly
				const recipientAddress = walletClients[3].account.address;
				const transferAmount = parseEther("0.25");

				// Fund the Safe first
				await testClient.setBalance({
					address: safeAddress,
					value: parseEther("1"),
				});

				const safeBalanceBefore = await publicClient.getBalance({
					address: safeAddress,
				});
				const recipientBalanceBefore = await publicClient.getBalance({
					address: recipientAddress,
				});

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: recipientAddress,
							value: transferAmount,
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
				await publicClient.waitForTransactionReceipt({ hash: txHash });

				const safeBalanceAfter = await publicClient.getBalance({
					address: safeAddress,
				});
				const recipientBalanceAfter = await publicClient.getBalance({
					address: recipientAddress,
				});

				// Check balances changed correctly
				expect(safeBalanceBefore - safeBalanceAfter).toBe(transferAmount);
				expect(recipientBalanceAfter - recipientBalanceBefore).toBe(
					transferAmount,
				);
			});

			it("should execute contract interaction", async () => {
				// Test case: Execute call to test contract
				// Expected: Contract state changes as expected
				// For this test, we'll use the Safe itself as the target contract
				// and call the changeThreshold function
				const newThreshold = 2n;

				// First add another owner so we can change threshold to 2
				const addOwnerData = encodeFunctionData({
					abi: [
						{
							type: "function",
							name: "addOwnerWithThreshold",
							inputs: [
								{ name: "owner", type: "address" },
								{ name: "_threshold", type: "uint256" },
							],
							outputs: [],
							stateMutability: "nonpayable",
						},
					],
					functionName: "addOwnerWithThreshold",
					args: [walletClients[1].account.address, 1n], // Keep threshold at 1 for now
				});

				const addOwnerTx = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: safeAddress,
							value: 0n,
							data: addOwnerData,
						},
					],
				);

				const sig1 = await signSafeTransaction(walletClient, addOwnerTx);
				const execTx1 = await executeSafeTransaction(walletClient, addOwnerTx, [
					sig1,
				]);
				await publicClient.waitForTransactionReceipt({
					hash: await execTx1.send(),
				});

				// Now change threshold to 2
				const changeThresholdData = encodeFunctionData({
					abi: [
						{
							type: "function",
							name: "changeThreshold",
							inputs: [{ name: "_threshold", type: "uint256" }],
							outputs: [],
							stateMutability: "nonpayable",
						},
					],
					functionName: "changeThreshold",
					args: [newThreshold],
				});

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: safeAddress,
							value: 0n,
							data: changeThresholdData,
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
				await publicClient.waitForTransactionReceipt({ hash: txHash });

				// Verify threshold changed
				const threshold = await publicClient.readContract({
					address: safeAddress,
					abi: [
						{
							type: "function",
							name: "getThreshold",
							inputs: [],
							outputs: [{ name: "", type: "uint256" }],
							stateMutability: "view",
						},
					],
					functionName: "getThreshold",
				});

				expect(threshold).toBe(newThreshold);
			});

			it("should execute MultiSend batch transaction", async () => {
				// Test case: Execute batched operations
				// Expected: All operations succeed
				// Fund the Safe
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

				// Both recipients should have received their amounts
				expect(balance1After - balance1Before).toBe(amount1);
				expect(balance2After - balance2Before).toBe(amount2);
			});

			it("should return transaction hash from send()", async () => {
				// Test case: Use send() convenience method
				// Expected: Returns valid transaction hash
				// Fund the Safe for the transfer
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

				// Call send() method
				const txHash = await executeTx.send();

				// Should return a valid transaction hash
				expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

				// Verify the transaction was mined
				const receipt = await publicClient.waitForTransactionReceipt({
					hash: txHash,
				});
				expect(receipt.status).toBe("success");
			});

			it("should provide raw transaction data", async () => {
				// Test case: Access rawTransaction property
				// Expected: Contains to, data, value fields
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

				// Check rawTransaction structure
				expect(executeTx.rawTransaction).toBeDefined();
				expect(executeTx.rawTransaction.to).toBe(safeAddress);
				expect(executeTx.rawTransaction.value).toBe(0n); // Safe execTransaction doesn't send value
				expect(executeTx.rawTransaction.data).toMatch(/^0x/); // Should be hex data

				// The data should be the encoded execTransaction call
				expect(executeTx.rawTransaction.data).toMatch(/^0x6a761202/); // execTransaction selector
			});
		});

		describe("Signature validation scenarios", () => {
			it("should fail with insufficient signatures", async () => {
				// Test case: Execute with less than threshold signatures
				// Expected: Safe contract reverts
				// Deploy a 2-of-3 Safe
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

				// Sign with only 1 owner (threshold is 2)
				const signature = await signSafeTransaction(
					walletClients[0],
					transaction,
					walletClients[0].account.address,
				);

				// Try to execute with insufficient signatures
				const executeTx = await executeSafeTransaction(
					walletClient,
					transaction,
					[signature], // Only 1 signature, need 2
				);

				await expect(executeTx.send()).rejects.toThrow();
			});

			it("should fail with invalid signature data", async () => {
				// Test case: Execute with malformed signature
				// Expected: Safe contract reverts
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

				// Create an invalid signature
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

			it("should fail with non-owner signatures", async () => {
				// Test case: Execute with signature from non-owner
				// Expected: Safe contract reverts
				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: walletClients[2].account.address,
							value: parseEther("0.01"),
							data: EMPTY_BYTES,
						},
					],
				);

				// Sign with a non-owner account
				const nonOwnerSignature = await signSafeTransaction(
					walletClients[3],
					transaction,
					walletClients[3].account.address,
				);

				const executeTx = await executeSafeTransaction(
					walletClient,
					transaction,
					[nonOwnerSignature],
				);

				await expect(executeTx.send()).rejects.toThrow();
			});

			it("should fail with duplicate signatures", async () => {
				// Test case: Execute with same signature twice
				// Expected: Safe contract reverts
				// Deploy a 2-of-2 Safe
				const multiSigSafe = await deploySafeAccount(walletClient, {
					owners: [
						walletClients[0].account.address,
						walletClients[1].account.address,
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
							value: 0n,
							data: EMPTY_BYTES,
						},
					],
				);

				// Sign with first owner
				const signature = await signSafeTransaction(
					walletClients[0],
					transaction,
					walletClients[0].account.address,
				);

				// Try to use the same signature twice
				const executeTx = await executeSafeTransaction(
					walletClient,
					transaction,
					[signature, signature], // Duplicate signature
				);

				await expect(executeTx.send()).rejects.toThrow();
			});

			it("should handle signatures in wrong order", async () => {
				// Test case: Signatures not sorted by signer address
				// Expected: Execution succeeds (SDK should sort)
				// Deploy a 2-of-3 Safe
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

				// Get signatures from owners
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

				// Fund the Safe for the transfer
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

		describe("Gas and refund scenarios", () => {
			it("should execute with gas refund parameters", async () => {
				// Test case: Execute with baseGas, safeTxGas, gasPrice set
				// Expected: Gas refund logic triggered
				// Fund the Safe for gas payment
				await testClient.setBalance({
					address: safeAddress,
					value: parseEther("1"),
				});

				const refundReceiver = walletClients[4].account.address;
				const receiverBalanceBefore = await publicClient.getBalance({
					address: refundReceiver,
				});

				const transaction = await buildSafeTransaction(
					walletClient,
					safeAddress,
					[
						{
							to: walletClients[1].account.address,
							value: parseEther("0.1"),
							data: EMPTY_BYTES,
						},
					],
					{
						safeTxGas: 100000n,
						baseGas: 50000n,
						gasPrice: 1000000000n, // 1 gwei
						refundReceiver: refundReceiver,
					},
				);

				const signature = await signSafeTransaction(walletClient, transaction);
				const executeTx = await executeSafeTransaction(
					walletClient,
					transaction,
					[signature],
				);
				const txHash = await executeTx.send();
				await publicClient.waitForTransactionReceipt({ hash: txHash });

				const receiverBalanceAfter = await publicClient.getBalance({
					address: refundReceiver,
				});

				// Refund receiver should have received some gas refund
				expect(receiverBalanceAfter).toBeGreaterThan(receiverBalanceBefore);
			});

			it("should execute with ERC20 gas token payment", async () => {
				// Test case: Execute with custom gasToken
				// Expected: Token transfer for gas payment
				// Note: This test would require deploying an ERC20 token contract
				// For now, we'll test that the transaction builds correctly with a gas token
				const mockTokenAddress =
					"0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address; // Mock DAI address

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
					{
						gasToken: mockTokenAddress,
						gasPrice: parseEther("0.001"), // 0.001 token per gas
						safeTxGas: 100000n,
						baseGas: 50000n,
					},
				);

				// Verify gas token is set correctly
				expect(transaction.gasToken).toBe(mockTokenAddress);
				expect(transaction.gasPrice).toBe(parseEther("0.001"));

				// Note: Actual execution would fail without a deployed token
				// but we've verified the transaction builds correctly
			});

			it("should execute with custom refund receiver", async () => {
				// Test case: Execute with refundReceiver set
				// Expected: Refund sent to specified address
				// Fund the Safe
				await testClient.setBalance({
					address: safeAddress,
					value: parseEther("1"),
				});

				const customRefundReceiver = walletClients[3].account.address;
				const executorAddress = walletClient.account.address;

				const refundReceiverBalanceBefore = await publicClient.getBalance({
					address: customRefundReceiver,
				});
				const executorBalanceBefore = await publicClient.getBalance({
					address: executorAddress,
				});

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
					{
						refundReceiver: customRefundReceiver,
						safeTxGas: 100000n,
						baseGas: 50000n,
						gasPrice: 1000000000n, // 1 gwei
					},
				);

				const signature = await signSafeTransaction(walletClient, transaction);
				const executeTx = await executeSafeTransaction(
					walletClient,
					transaction,
					[signature],
				);
				const txHash = await executeTx.send();
				await publicClient.waitForTransactionReceipt({ hash: txHash });

				const refundReceiverBalanceAfter = await publicClient.getBalance({
					address: customRefundReceiver,
				});
				const executorBalanceAfter = await publicClient.getBalance({
					address: executorAddress,
				});

				// Custom refund receiver should have received the refund
				expect(refundReceiverBalanceAfter).toBeGreaterThan(
					refundReceiverBalanceBefore,
				);
				// Executor balance should have decreased (paid for gas)
				expect(executorBalanceAfter).toBeLessThan(executorBalanceBefore);
			});
		});
	});

	describe("Integration scenarios", () => {
		it("should complete full transaction flow", async () => {
			// Test case: Build -> Sign -> Execute full flow
			// Expected: Transaction successfully executed on-chain
			// Fund the Safe
			await testClient.setBalance({
				address: safeAddress,
				value: parseEther("2"),
			});

			const recipientAddress = walletClients[2].account.address;
			const transferAmount = parseEther("0.5");

			// Record initial balances
			const safeBalanceBefore = await publicClient.getBalance({
				address: safeAddress,
			});
			const recipientBalanceBefore = await publicClient.getBalance({
				address: recipientAddress,
			});

			// Step 1: Build the transaction
			const transaction = await buildSafeTransaction(
				walletClient,
				safeAddress,
				[
					{
						to: recipientAddress,
						value: transferAmount,
						data: EMPTY_BYTES,
					},
				],
				{
					// Include some gas parameters to test full flow
					safeTxGas: 50000n,
					baseGas: 25000n,
					gasPrice: 1000000000n,
					refundReceiver: walletClient.account.address,
				},
			);

			// Verify transaction was built correctly
			expect(transaction.to).toBe(recipientAddress);
			expect(transaction.value).toBe(transferAmount);
			expect(transaction.nonce).toBe(0n);

			// Step 2: Sign the transaction
			const signature = await signSafeTransaction(walletClient, transaction);

			// Verify signature
			expect(signature.signer).toBe(walletClient.account.address);
			expect(signature.data).toMatch(/^0x[a-fA-F0-9]{130}$/);

			// Step 3: Execute the transaction
			const executeTx = await executeSafeTransaction(
				walletClient,
				transaction,
				[signature],
			);
			const txHash = await executeTx.send();

			// Verify transaction hash
			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			// Wait for confirmation
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			expect(receipt.status).toBe("success");

			// Verify final balances
			const safeBalanceAfter = await publicClient.getBalance({
				address: safeAddress,
			});
			const recipientBalanceAfter = await publicClient.getBalance({
				address: recipientAddress,
			});

			// Safe balance should decrease by more than transfer amount (includes gas refund)
			expect(safeBalanceBefore - safeBalanceAfter).toBeGreaterThanOrEqual(
				transferAmount,
			);
			// Recipient should receive exact amount
			expect(recipientBalanceAfter - recipientBalanceBefore).toBe(
				transferAmount,
			);
		});

		it("should handle concurrent transaction building", async () => {
			// Test case: Build multiple transactions in parallel
			// Expected: Each gets correct sequential nonce
			// Fund the Safe for the transactions
			await testClient.setBalance({
				address: safeAddress,
				value: parseEther("1"),
			});

			// Build multiple transactions concurrently
			const [tx1, tx2, tx3] = await Promise.all([
				buildSafeTransaction(walletClient, safeAddress, [
					{
						to: walletClients[1].account.address,
						value: parseEther("0.1"),
						data: EMPTY_BYTES,
					},
				]),
				buildSafeTransaction(walletClient, safeAddress, [
					{
						to: walletClients[2].account.address,
						value: parseEther("0.2"),
						data: EMPTY_BYTES,
					},
				]),
				buildSafeTransaction(walletClient, safeAddress, [
					{
						to: walletClients[3].account.address,
						value: parseEther("0.3"),
						data: EMPTY_BYTES,
					},
				]),
			]);

			// All should have the same nonce since they're built concurrently
			expect(tx1.nonce).toBe(0n);
			expect(tx2.nonce).toBe(0n);
			expect(tx3.nonce).toBe(0n);

			// Execute the first transaction
			const sig1 = await signSafeTransaction(walletClient, tx1);
			const exec1 = await executeSafeTransaction(walletClient, tx1, [sig1]);
			await publicClient.waitForTransactionReceipt({
				hash: await exec1.send(),
			});

			// Build a new transaction after execution
			const tx4 = await buildSafeTransaction(walletClient, safeAddress, [
				{
					to: walletClients[4].account.address,
					value: parseEther("0.4"),
					data: EMPTY_BYTES,
				},
			]);

			// This should have nonce 1 since one transaction was executed
			expect(tx4.nonce).toBe(1n);

			// Now build multiple transactions concurrently again
			const [tx5, tx6] = await Promise.all([
				buildSafeTransaction(walletClient, safeAddress, [
					{
						to: walletClients[1].account.address,
						value: parseEther("0.05"),
						data: EMPTY_BYTES,
					},
				]),
				buildSafeTransaction(walletClient, safeAddress, [
					{
						to: walletClients[2].account.address,
						value: parseEther("0.06"),
						data: EMPTY_BYTES,
					},
				]),
			]);

			// Both should have nonce 1
			expect(tx5.nonce).toBe(1n);
			expect(tx6.nonce).toBe(1n);
		});
	});
});
