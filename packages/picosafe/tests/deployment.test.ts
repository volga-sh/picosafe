/**
 * @fileoverview Integration tests for Safe deployment functionality.
 *
 * These tests verify that Safe proxy deployment works correctly, including:
 * - Address calculation matching on-chain behavior
 * - Proper encoding of setup data
 * - Handling of various deployment configurations
 *
 * Tests run against a local Anvil blockchain with real Safe contracts deployed.
 */

import { Address } from "ox";
import { type Log, parseEther } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PARSED_SAFE_PROXY_FACTORY_ABI } from "../src/abis";
import {
	getFallbackHandler,
	getNonce,
	getOwnerCount,
	getOwners,
	getSingleton,
	getThreshold,
} from "../src/account-state";
import type { FullSafeDeploymentConfig } from "../src/deployment";
import {
	calculateSafeAddress,
	decodeSafeSetupEventFromLogs,
	deploySafeAccount,
	encodeSetupData,
} from "../src/deployment";
import { V141_ADDRESSES } from "../src/safe-contracts";
import { ZERO_ADDRESS } from "../src/utilities/constants";
import { createClients, snapshot } from "./fixtures/setup";
import { pickRandom, randomAddress, randomBytesHex } from "./utils";

describe("Safe Deployment Functions", () => {
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

	describe("calculateSafeAddress", () => {
		it("should match createProxyWithNonce static call result (100 random iterations)", async () => {
			// Why 100 random iterations: This fuzz-like testing approach ensures our address
			// calculation is robust across diverse configurations. By testing with random
			// owner counts, thresholds, and delegatecall data, we catch edge cases that
			// might be missed with fixed test cases. This mirrors real-world usage where
			// Safe deployments have highly varied configurations.
			for (let i = 0; i < 100; i++) {
				// We use random configs to ensure robustness
				const numOwners = Math.floor(Math.random() * 5) + 1; // 1-5 owners
				const dataLength = Math.floor(Math.random() * 100); // 0-100 bytes of data

				const config: FullSafeDeploymentConfig = {
					owners: Array.from({ length: numOwners }, () => randomAddress()),
					threshold: BigInt(Math.floor(Math.random() * numOwners) + 1),
					saltNonce: BigInt(Math.floor(Math.random() * 1000000)),
					UNSAFE_DELEGATECALL_to:
						Math.random() > 0.5 ? randomAddress() : ZERO_ADDRESS,
					UNSAFE_DELEGATECALL_data:
						dataLength > 0 ? randomBytesHex(dataLength) : "0x",
					fallbackHandler: Math.random() > 0.5 ? randomAddress() : ZERO_ADDRESS,
					paymentToken: Math.random() > 0.5 ? randomAddress() : ZERO_ADDRESS,
					payment: 0n,
					paymentReceiver: Math.random() > 0.5 ? randomAddress() : ZERO_ADDRESS,
					singleton: pickRandom([V141_ADDRESSES.SafeL2, V141_ADDRESSES.Safe]),
					proxyFactory: V141_ADDRESSES.SafeProxyFactory,
				};

				// Why we set bytecode for UNSAFE_DELEGATECALL_to: The Safe contract's setup()
				// function validates that any delegatecall target has code deployed (codesize > 0).
				// This prevents accidentally delegating to EOA addresses. In our tests, we deploy
				// minimal valid bytecode that safely returns without reverting:
				// 5F PUSH0  - Push 0 onto stack (return data offset)
				// 5F PUSH0  - Push 0 onto stack (return data length)
				// F3 RETURN - Return with empty data
				// This satisfies the Safe's validation while avoiding test failures.
				if (config.UNSAFE_DELEGATECALL_to !== ZERO_ADDRESS) {
					await testClient.setCode({
						address: config.UNSAFE_DELEGATECALL_to,
						bytecode: "0x5f5ff3",
					});
				}

				const calculatedAddress = calculateSafeAddress(config);

				const setupData = encodeSetupData(config);

				const { result: proxyAddress } = await publicClient.simulateContract({
					address: V141_ADDRESSES.SafeProxyFactory,
					abi: PARSED_SAFE_PROXY_FACTORY_ABI,
					functionName: "createProxyWithNonce",
					args: [config.singleton, setupData, config.saltNonce],
				});

				expect(calculatedAddress).toBe(proxyAddress);
			}
		});
	});

	describe("decodeSafeSetupEventFromLogs", () => {
		const safeSetupLog: Log = {
			address: "0xd9f8de3b1e996b792c5ebb78a747f974d618d172" as const,
			topics: [
				"0x141df868a6331af528e38c83b7aa03edc19be66e37ae67f9285bf4f8e3c6a1a8" as const,
				"0x0000000000000000000000004e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67" as const,
			],
			data: "0x000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000fd0732dc9e303f09fcef3a7388ad10a83459ec990000000000000000000000000000000000000000000000000000000000000001000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266" as const,
			blockHash:
				"0x572527dc02a8d963342a746cf362874163aea872fe380c42c39aa47244cf0764" as const,
			blockNumber: 1n,
			transactionHash:
				"0x53970ecebf30e304ae2c121e8299051d904974e79d998cb591ca7380eceed9a0" as const,
			transactionIndex: 0,
			logIndex: 0,
			removed: false,
		} as const;

		const otherLog: Log = {
			address: "0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67" as const,
			topics: [
				"0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235" as const,
				"0x000000000000000000000000d9f8de3b1e996b792c5ebb78a747f974d618d172" as const,
			],
			data: "0x00000000000000000000000029fcb43b46531bca003ddc8fcb67ffe91900c762" as const,
			blockHash:
				"0x572527dc02a8d963342a746cf362874163aea872fe380c42c39aa47244cf0764" as const,
			blockNumber: 1n,
			transactionHash:
				"0x53970ecebf30e304ae2c121e8299051d904974e79d998cb591ca7380eceed9a0" as const,
			transactionIndex: 0,
			logIndex: 1,
			removed: false,
		} as const;

		it("should decode a single SafeSetup event from logs", () => {
			const logs = [safeSetupLog, otherLog];
			const decodedEvents = decodeSafeSetupEventFromLogs(logs);

			expect(decodedEvents).toHaveLength(1);
			const event = decodedEvents[0];
			expect(event?.eventName).toBe("SafeSetup");
			expect(event?.args.initiator).toBe(
				Address.checksum("0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67"),
			);
			expect(event?.args.owners).toEqual([
				Address.checksum("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"),
			]);
			expect(event?.args.threshold).toBe(1n);
			expect(event?.args.initializer).toBe(ZERO_ADDRESS);
			expect(event?.args.fallbackHandler).toBe(
				Address.checksum("0xfd0732dc9e303f09fcef3a7388ad10a83459ec99"),
			);
		});

		it("should return an empty array if no SafeSetup event is present", () => {
			const logs = [otherLog, otherLog]; // No SafeSetup event
			const decodedEvents = decodeSafeSetupEventFromLogs(logs);
			expect(decodedEvents).toHaveLength(0);
		});

		it("should decode multiple SafeSetup events from logs", () => {
			const logs = [safeSetupLog, otherLog, { ...safeSetupLog, logIndex: 2 }];
			const decodedEvents = decodeSafeSetupEventFromLogs(logs);

			expect(decodedEvents).toHaveLength(2);
			expect(decodedEvents[0]?.eventName).toBe("SafeSetup");
			expect(decodedEvents[1]?.eventName).toBe("SafeSetup");
		});
	});

	describe("deploySafeAccount", () => {
		it("should deploy a Safe with single owner and threshold 1", async () => {
			const owner = walletClient.account.address;

			const deployment = await deploySafeAccount(walletClient, {
				owners: [owner],
				threshold: 1n,
			});

			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({ hash: txHash });

			const safeAddress = deployment.data.safeAddress;

			// Verify bytecode is deployed
			const bytecode = await publicClient.getCode({ address: safeAddress });
			expect(bytecode).toBeDefined();
			expect(bytecode).not.toBe("0x");

			// Verify account state using account-state functions
			const owners = await getOwners(publicClient, { safeAddress });
			expect(owners).toEqual([owner]);

			const threshold = await getThreshold(publicClient, { safeAddress });
			expect(threshold).toBe(1n);

			const ownerCount = await getOwnerCount(publicClient, { safeAddress });
			expect(ownerCount).toBe(1n);

			const nonce = await getNonce(publicClient, { safeAddress });
			expect(nonce).toBe(0n); // Should be 0 for newly deployed Safe

			// Verify singleton is set to the expected Safe implementation
			const singleton = await getSingleton(publicClient, { safeAddress });
			expect(singleton.toLowerCase()).toBe(V141_ADDRESSES.SafeL2.toLowerCase());
		});

		it("should deploy a Safe with multiple owners and various thresholds", async () => {
			const owners = [
				walletClient.account.address,
				randomAddress(),
				randomAddress(),
				randomAddress(),
			];

			// Test different threshold values
			for (const threshold of [1n, 2n, 3n, 4n]) {
				const deployment = await deploySafeAccount(walletClient, {
					owners,
					threshold,
					saltNonce: threshold,
				});

				const txHash = await deployment.send();
				await publicClient.waitForTransactionReceipt({ hash: txHash });

				const safeAddress = deployment.data.safeAddress;

				// Verify bytecode is deployed
				const bytecode = await publicClient.getCode({ address: safeAddress });
				expect(bytecode).toBeDefined();
				expect(bytecode).not.toBe("0x");

				// Verify account state
				const deployedOwners = await getOwners(publicClient, { safeAddress });
				expect(deployedOwners.length).toBe(owners.length);
				// Compare owners (case-insensitive)
				expect(deployedOwners.map((o) => o.toLowerCase()).sort()).toEqual(
					owners.map((o) => o.toLowerCase()).sort(),
				);

				const deployedThreshold = await getThreshold(publicClient, {
					safeAddress,
				});
				expect(deployedThreshold).toBe(threshold);

				const ownerCount = await getOwnerCount(publicClient, { safeAddress });
				expect(ownerCount).toBe(BigInt(owners.length));
			}
		});

		it("should deploy a Safe with a reasonably large number of owners", async () => {
			const owners = Array.from({ length: 100 }, () => randomAddress());
			owners[0] = walletClient.account.address; // Ensure at least one real owner

			const deployment = await deploySafeAccount(walletClient, {
				owners,
				threshold: 50n,
			});

			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({ hash: txHash });

			const bytecode = await publicClient.getCode({
				address: deployment.data.safeAddress,
			});
			expect(bytecode).toBeDefined();
			expect(bytecode).not.toBe("0x");
		});

		it("should deploy with all default optional parameters", async () => {
			const owner = walletClient.account.address;

			const deployment = await deploySafeAccount(walletClient, {
				owners: [owner],
				threshold: 1n,
			});
			const txHash = await deployment.send();

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			const safeSetupEvent = decodeSafeSetupEventFromLogs(receipt.logs);

			if (!safeSetupEvent[0]) {
				throw new Error("SafeSetup event not found in transaction receipt");
			}

			expect(safeSetupEvent[0].args).toMatchObject({
				initiator: V141_ADDRESSES.SafeProxyFactory,
				owners: [owner],
				threshold: 1n,
				initializer: ZERO_ADDRESS,
				fallbackHandler: V141_ADDRESSES.CompatibilityFallbackHandler,
			});
		});

		it("should return deploymentConfig with all defaults applied", async () => {
			const owner = walletClient.account.address;

			const deployment = await deploySafeAccount(walletClient, {
				owners: [owner],
				threshold: 1n,
			});

			// Verify deploymentConfig contains all fields with defaults
			expect(deployment.data.deploymentConfig).toEqual({
				owners: [owner],
				threshold: 1n,
				UNSAFE_DELEGATECALL_to: ZERO_ADDRESS,
				UNSAFE_DELEGATECALL_data: "0x",
				fallbackHandler: V141_ADDRESSES.CompatibilityFallbackHandler,
				paymentToken: ZERO_ADDRESS,
				payment: 0n,
				paymentReceiver: ZERO_ADDRESS,
				saltNonce: 0n,
				singleton: V141_ADDRESSES.SafeL2,
				proxyFactory: V141_ADDRESSES.SafeProxyFactory,
			});
		});

		it("should return deploymentConfig with custom values preserved", async () => {
			const owner = walletClient.account.address;
			const customFallbackHandler = randomAddress();
			const paymentReceiver = randomAddress();
			const payment = parseEther("0.01");
			const saltNonce = 42n;

			// Deploy minimal bytecode to the fallback handler address
			await testClient.setCode({
				address: customFallbackHandler,
				bytecode: "0x5f5ff3", // PUSH0 PUSH0 RETURN
			});

			const deployment = await deploySafeAccount(walletClient, {
				owners: [owner],
				threshold: 1n,
				fallbackHandler: customFallbackHandler,
				payment,
				paymentReceiver,
				saltNonce,
				singleton: V141_ADDRESSES.Safe, // Use L1 version
			});

			// Verify deploymentConfig contains all custom values
			expect(deployment.data.deploymentConfig).toEqual({
				owners: [owner],
				threshold: 1n,
				UNSAFE_DELEGATECALL_to: ZERO_ADDRESS,
				UNSAFE_DELEGATECALL_data: "0x",
				fallbackHandler: customFallbackHandler,
				paymentToken: ZERO_ADDRESS,
				payment,
				paymentReceiver,
				saltNonce,
				singleton: V141_ADDRESSES.Safe,
				proxyFactory: V141_ADDRESSES.SafeProxyFactory,
			});
		});

		it("should allow using deploymentConfig to calculate same address", async () => {
			const owner = walletClient.account.address;
			const saltNonce = 999n;

			const deployment = await deploySafeAccount(walletClient, {
				owners: [owner],
				threshold: 1n,
				saltNonce,
			});

			// Calculate address using the returned deploymentConfig
			const calculatedAddress = calculateSafeAddress(
				deployment.data.deploymentConfig,
			);

			// Should match the predicted address
			expect(calculatedAddress).toBe(deployment.data.safeAddress);

			// Deploy and verify it ends up at the same address
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({ hash: txHash });

			const bytecode = await publicClient.getCode({
				address: calculatedAddress,
			});
			expect(bytecode).toBeDefined();
			expect(bytecode).not.toBe("0x");
		});

		it("should deploy with custom saltNonce for deterministic addresses", async () => {
			const owner = walletClient.account.address;
			const saltNonce = 12345n;

			const expectedAddress = calculateSafeAddress({
				owners: [owner],
				threshold: 1n,
				saltNonce,
			});

			const wrapped = await deploySafeAccount(walletClient, {
				owners: [owner],
				threshold: 1n,
				saltNonce,
			});

			expect(wrapped.data.safeAddress).toBe(expectedAddress);

			const txHash = await wrapped.send();
			await publicClient.waitForTransactionReceipt({ hash: txHash });
			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			const bytecode = await publicClient.getCode({ address: expectedAddress });
			expect(bytecode).toBeDefined();
			expect(bytecode).not.toBe("0x");
		});

		it("should deploy with custom singleton address", async () => {
			const owner = walletClient.account.address;

			const deployment = await deploySafeAccount(walletClient, {
				owners: [owner],
				threshold: 1n,
				singleton: V141_ADDRESSES.Safe, // Use L1 version instead of L2
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({ hash: txHash });

			const safeAddress = deployment.data.safeAddress;

			// Verify bytecode is deployed
			const bytecode = await publicClient.getCode({ address: safeAddress });
			expect(bytecode).toBeDefined();
			expect(bytecode).not.toBe("0x");

			// Verify the singleton address is set correctly
			const singleton = await getSingleton(publicClient, { safeAddress });
			expect(singleton.toLowerCase()).toBe(V141_ADDRESSES.Safe.toLowerCase());
		});

		it("should deploy with custom fallbackHandler", async () => {
			const owner = walletClient.account.address;
			const customFallbackHandler = randomAddress();

			// Deploy minimal bytecode to the fallback handler address
			await testClient.setCode({
				address: customFallbackHandler,
				bytecode: "0x5f5ff3", // PUSH0 PUSH0 RETURN
			});

			const deployment = await deploySafeAccount(walletClient, {
				owners: [owner],
				threshold: 1n,
				fallbackHandler: customFallbackHandler,
			});
			const txHash = await deployment.send();
			await publicClient.waitForTransactionReceipt({ hash: txHash });

			const safeAddress = deployment.data.safeAddress;

			// Verify bytecode is deployed
			const bytecode = await publicClient.getCode({ address: safeAddress });
			expect(bytecode).toBeDefined();
			expect(bytecode).not.toBe("0x");

			// Verify the fallback handler address is set correctly
			const fallbackHandler = await getFallbackHandler(publicClient, {
				safeAddress,
			});
			expect(fallbackHandler.toLowerCase()).toBe(
				customFallbackHandler.toLowerCase(),
			);
		});

		it("should deploy with ETH payment", async () => {
			const owner = walletClient.account.address;
			const paymentReceiver = randomAddress();
			const payment = parseEther("0.01");

			const balanceBefore = await publicClient.getBalance({
				address: paymentReceiver,
			});

			const wrapped = await deploySafeAccount(walletClient, {
				owners: [owner],
				threshold: 1n,
				payment,
				paymentReceiver,
				paymentToken: ZERO_ADDRESS, // ETH payment
			});

			const safeAddress = wrapped.data.safeAddress;

			const fundTx = await walletClient.sendTransaction({
				to: safeAddress,
				value: payment,
			});
			await publicClient.waitForTransactionReceipt({ hash: fundTx });

			const safeBalance = await publicClient.getBalance({
				address: safeAddress,
			});
			expect(safeBalance).toBe(payment);

			const txHash = await wrapped.send();
			await publicClient.waitForTransactionReceipt({ hash: txHash });
			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			const deployedCode = await publicClient.getCode({ address: safeAddress });
			expect(deployedCode).toBeDefined();
			expect(deployedCode).not.toBe("0x");
			const balanceAfter = await publicClient.getBalance({
				address: paymentReceiver,
			});
			expect(balanceAfter - balanceBefore).toBe(payment);

			const safeBalanceAfter = await publicClient.getBalance({
				address: safeAddress,
			});
			expect(safeBalanceAfter).toBe(0n);
		});

		it("should deploy with UNSAFE_DELEGATECALL during setup", async () => {
			const owner = walletClient.account.address;
			const delegateTarget = randomAddress();

			// Deploy a contract that emits an event when called
			// This bytecode logs LOG0 with no data to prove it was called
			await testClient.setCode({
				address: delegateTarget,
				bytecode: "0x5f5fa0", // PUSH0 PUSH0 LOG0
			});

			const delegateData = "0x12345678"; // Some arbitrary data

			const deployment = await deploySafeAccount(walletClient, {
				owners: [owner],
				threshold: 1n,
				UNSAFE_DELEGATECALL_to: delegateTarget,
				UNSAFE_DELEGATECALL_data: delegateData,
			});
			const txHash = await deployment.send();

			// Get the transaction receipt to check for logs
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});

			// Should have at least one log from the delegatecall
			// TODO: Verify the log contains expected data, Safe Contracts emit their own logs so
			// this test may need to be adjusted based on actual event emitted
			expect(receipt.logs.length).toBeGreaterThan(0);
		});

		it("should return correct predicted address that matches actual deployment", async () => {
			const owner = walletClient.account.address;
			const saltNonce = 7777n;

			// Calculate expected address before deployment
			const expectedAddress = calculateSafeAddress({
				owners: [owner],
				threshold: 1n,
				saltNonce,
			});

			const wrapped = await deploySafeAccount(walletClient, {
				owners: [owner],
				threshold: 1n,
				saltNonce,
			});

			// Predicted address should match
			expect(wrapped.data.safeAddress).toBe(expectedAddress);

			// Deploy and verify
			const txHash = await wrapped.send();
			await publicClient.waitForTransactionReceipt({ hash: txHash });

			// Check Safe is deployed at predicted address
			const bytecode = await publicClient.getCode({ address: expectedAddress });
			expect(bytecode).toBeDefined();
			expect(bytecode).not.toBe("0x");
		});

		it("should work with custom transaction overrides", async () => {
			const owner = walletClient.account.address;

			const deployment = await deploySafeAccount(walletClient, {
				owners: [owner],
				threshold: 1n,
			});

			const customGasLimit = 500000n;
			const txHash = await deployment.send({ gas: customGasLimit });

			const tx = await publicClient.getTransaction({ hash: txHash });
			expect(tx.gas).toBe(customGasLimit);
		});

		it("should use the first account from provider by default", async () => {
			const firstAccount = walletClient.account.address;

			const wrapped = await deploySafeAccount(walletClient, {
				owners: [randomAddress()], // Different owner than deployer
				threshold: 1n,
			});

			expect(wrapped.rawTransaction.from?.toLowerCase()).toBe(
				firstAccount.toLowerCase(),
			);
		});
	});
});
