import type { Address, Hex } from "viem";
import {
	concatHex,
	encodeFunctionData,
	hexToBytes,
	keccak256,
	toBytes,
	toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, test } from "vitest";
import { PARSED_SAFE_ABI } from "../src/abis";
import { deploySafeAccount } from "../src/deployment";
import {
	calculateSafeTransactionHash,
	encodeEIP712SafeTransactionData,
} from "../src/eip712";
import {
	checkNSignatures,
	encodeSafeSignaturesBytes,
	getApprovedHashSignatureBytes,
	validateSignaturesForSafe,
} from "../src/safe-signatures";
import type { FullSafeTransaction, PicosafeSignature } from "../src/types";
import { Operation } from "../src/types";
import {
	getMockERC1271InvalidBytecode,
	getMockERC1271LegacyValidBytecode,
} from "./fixtures/mock-bytecodes";
import { createClients, snapshot } from "./fixtures/setup";
import { randomAddress, randomBytesHex } from "./utils";

describe("encodeSafeSignaturesBytes", () => {
	it("should encode single ECDSA signature", () => {
		const signatures: PicosafeSignature[] = [
			{
				signer: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
				data: `0x${"a".repeat(128)}1b`, // 65 bytes: r(32) + s(32) + v(1)
			},
		];

		const encoded = encodeSafeSignaturesBytes(signatures);
		expect(encoded).toBe(`0x${"a".repeat(128)}1b`);
	});

	it("should sort signatures by signer address", () => {
		const signatures: PicosafeSignature[] = [
			{
				signer: "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
				data: `0x${"b".repeat(128)}1c`,
			},
			{
				signer: "0x0000000000000000000000000000000000000001",
				data: `0x${"a".repeat(128)}1b`,
			},
		];

		const encoded = encodeSafeSignaturesBytes(signatures);
		// Should be sorted with 0x000...001 first, then 0xFFF...FFF
		expect(encoded).toBe(`0x${"a".repeat(128)}1b${"b".repeat(128)}1c`);
	});

	it("should handle dynamic signatures", () => {
		const signatures: PicosafeSignature[] = [
			{
				signer: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
				data: `0x${"a".repeat(128)}1b`, // Standard ECDSA
			},
			{
				signer: "0x0000000000000000000000000000000000000001",
				data: `0x${"c".repeat(130)}`, // Dynamic signature
				dynamic: true,
			},
		];

		const encoded = encodeSafeSignaturesBytes(signatures);

		// Expected format:
		// 1. Static part for contract signature (sorted first): padded signer (32) + offset (32) + type (1)
		// 2. Static part for ECDSA signature: 65 bytes
		// 3. Dynamic part: length (32) + data

		const expectedStatic =
			"0x" +
			"0000000000000000000000000000000000000001".padStart(64, "0") + // signer
			(65 * 2).toString(16).padStart(64, "0") + // offset = 130 (after 2 signatures of 65 bytes each)
			"00" + // signature type
			"a".repeat(128) +
			"1b"; // ECDSA signature

		const expectedDynamic =
			(130 / 2)
				.toString(16)
				.padStart(64, "0") + // length = 65 bytes
			"c".repeat(130); // data

		expect(encoded).toBe(expectedStatic + expectedDynamic);
	});

	it("should handle empty array", () => {
		const signatures: PicosafeSignature[] = [];
		expect(() => encodeSafeSignaturesBytes(signatures)).toThrow(
			"Cannot encode empty signatures array",
		);
	});

	it("should handle multiple dynamic signatures", () => {
		const signatures: PicosafeSignature[] = [
			{
				signer: "0x0000000000000000000000000000000000000001",
				data: `0x${"a".repeat(200)}`, // 100 bytes
				dynamic: true,
			},
			{
				signer: "0x0000000000000000000000000000000000000002",
				data: `0x${"b".repeat(100)}`, // 50 bytes
				dynamic: true,
			},
		];

		const encoded = encodeSafeSignaturesBytes(signatures);

		// Both are dynamic, so static part has two 65-byte entries
		// First signature offset: 65 * 2 = 130
		// Second signature offset: 130 + 32 (length) + 100 (data) = 262

		const expectedStatic =
			"0x" +
			"0000000000000000000000000000000000000001".padStart(64, "0") +
			(130).toString(16).padStart(64, "0") +
			"00" +
			"0000000000000000000000000000000000000002".padStart(64, "0") +
			(262).toString(16).padStart(64, "0") +
			"00";

		const expectedDynamic =
			(100)
				.toString(16)
				.padStart(64, "0") + // first signature length
			"a".repeat(200) + // first signature data
			(50).toString(16).padStart(64, "0") + // second signature length
			"b".repeat(100); // second signature data

		expect(encoded).toBe(expectedStatic + expectedDynamic);
	});
});

describe("checkNSignatures", () => {
	const { testClient, publicClient, walletClients } = createClients();
	let resetSnapshot: () => Promise<void>;
	let safeAddress: Address;
	let owners: [Address, Address, Address];
	let safeTx: FullSafeTransaction;
	let txHash: Hex;

	beforeEach(async () => {
		resetSnapshot = await snapshot(testClient);

		// Setup Safe with 3 owners and threshold of 2
		owners = [
			walletClients[0].account.address,
			walletClients[1].account.address,
			walletClients[2].account.address,
		] as const;

		const deployment = await deploySafeAccount(publicClient, {
			owners,
			threshold: 2n,
		});

		const deploymentTx = await deployment.send();
		await publicClient.waitForTransactionReceipt({ hash: deploymentTx });

		safeAddress = deployment.data.safeAddress;

		// Get chain ID for the Safe transaction
		const chainId = await publicClient.getChainId();

		// Create a standard Safe transaction for testing
		safeTx = {
			to: randomAddress(),
			value: 0n,
			data: "0x",
			operation: Operation.Call,
			safeTxGas: 0n,
			baseGas: 0n,
			gasPrice: 0n,
			gasToken: "0x0000000000000000000000000000000000000000",
			refundReceiver: "0x0000000000000000000000000000000000000000",
			nonce: 0n,
			safeAddress,
			chainId: BigInt(chainId),
		};

		txHash = calculateSafeTransactionHash(safeTx);
	});

	afterEach(async () => {
		await resetSnapshot();
	});

	describe("valid signatures", () => {
		test("should validate correct ECDSA signatures (EIP-712)", async () => {
			const sig1 = await walletClients[0].account.sign?.({
				hash: txHash,
			});
			const sig2 = await walletClients[1].account.sign?.({
				hash: txHash,
			});

			if (!sig1 || !sig2) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
				{ signer: owners[1], data: sig2 },
			];

			const { valid } = await checkNSignatures(publicClient, {
				safeAddress,
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(valid).toBe(true);
		});

		test("should validate with encoded signatures hex", async () => {
			const sig1 = await walletClients[0].account.sign?.({
				hash: txHash,
			});
			const sig2 = await walletClients[1].account.sign?.({
				hash: txHash,
			});

			if (!sig1 || !sig2) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
				{ signer: owners[1], data: sig2 },
			];

			const encodedSigs = encodeSafeSignaturesBytes(signatures);

			const { valid } = await checkNSignatures(publicClient, {
				safeAddress,
				dataHash: txHash,
				data: "0x",
				signatures: encodedSigs,
				requiredSignatures: 2n,
			});

			expect(valid).toBe(true);
		});

		test("should validate eth_sign signatures", async () => {
			const sig1 = await walletClients[0].account.signMessage?.({
				message: { raw: hexToBytes(txHash) },
			});
			const sig2 = await walletClients[1].account.signMessage?.({
				message: { raw: hexToBytes(txHash) },
			});

			if (!sig1 || !sig2) {
				throw new Error("Failed to sign");
			}

			// Convert v values from 27/28 to 31/32 for eth_sign
			const v1 = Number.parseInt(sig1.slice(-2), 16);
			const v2 = Number.parseInt(sig2.slice(-2), 16);
			const ethSignSig1 = (sig1.slice(0, -2) +
				(v1 + 4).toString(16).padStart(2, "0")) as Hex;
			const ethSignSig2 = (sig2.slice(0, -2) +
				(v2 + 4).toString(16).padStart(2, "0")) as Hex;

			const signatures = [
				{ signer: owners[0], data: ethSignSig1 },
				{ signer: owners[1], data: ethSignSig2 },
			];

			const { valid } = await checkNSignatures(publicClient, {
				safeAddress,
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(valid).toBe(true);
		});

		test("should validate pre-approved hash signatures", async () => {
			// Approve hash from owner 0
			const approveHashData = encodeFunctionData({
				abi: PARSED_SAFE_ABI,
				functionName: "approveHash",
				args: [txHash],
			});

			const approveTx = await walletClients[0].sendTransaction({
				to: safeAddress,
				data: approveHashData,
				from: owners[0],
			});
			await publicClient.waitForTransactionReceipt({ hash: approveTx });

			const signatures = [{ signer: owners[0] }];

			const { valid, error } = await checkNSignatures(publicClient, {
				safeAddress,
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 1n,
			});

			expect(error).toBeUndefined();
			expect(valid).toBe(true);
		});

		test("should validate ERC-1271 contract signatures", async () => {
			// Deploy a Safe with a contract owner from the start
			const mockSigner = randomAddress();
			await testClient.setCode({
				address: mockSigner,
				// Returns legacy ERC-1271 magic value (0x20c13b0b) that Safe expects
				bytecode: getMockERC1271LegacyValidBytecode(),
			});

			// Deploy a new Safe with the mock signer as an owner
			const deployment = await deploySafeAccount(publicClient, {
				owners: [owners[0], owners[1], mockSigner],
				threshold: 2n,
			});

			const deploymentTx = await deployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deploymentTx });

			const testSafeAddress = deployment.data.safeAddress;
			const chainId = await publicClient.getChainId();

			// Create transaction for this specific Safe
			const testSafeTx: FullSafeTransaction = {
				to: randomAddress(),
				value: 0n,
				data: "0x",
				operation: Operation.Call,
				safeTxGas: 0n,
				baseGas: 0n,
				gasPrice: 0n,
				gasToken: "0x0000000000000000000000000000000000000000",
				refundReceiver: "0x0000000000000000000000000000000000000000",
				nonce: 0n,
				safeAddress: testSafeAddress,
				chainId: BigInt(chainId),
			};

			const testSafeTxData = encodeEIP712SafeTransactionData(testSafeTx);
			const testTxHash = keccak256(testSafeTxData);

			// Create a dynamic signature for the contract
			const contractSigData = randomBytesHex(130); // Some arbitrary signature data

			const signatures: PicosafeSignature[] = [
				{ signer: mockSigner, data: contractSigData, dynamic: true },
			];

			const { valid, error } = await checkNSignatures(publicClient, {
				safeAddress: testSafeAddress,
				dataHash: testTxHash,
				data: testSafeTxData,
				signatures,
				requiredSignatures: 1n,
			});

			expect(valid).toBe(true);
			expect(error).toBeUndefined();
		});

		test("should validate mixed signature types", async () => {
			// Deploy a mock contract signer
			const mockSigner = randomAddress();
			await testClient.setCode({
				address: mockSigner,
				// Returns legacy ERC-1271 magic value (0x20c13b0b) that Safe expects
				bytecode: getMockERC1271LegacyValidBytecode(),
			});

			// Deploy a new Safe with mock signer as an owner and threshold of 3
			const deployment = await deploySafeAccount(publicClient, {
				owners: [owners[0], owners[1], mockSigner],
				threshold: 3n,
				saltNonce: BigInt(Date.now() + 200),
			});

			const deploymentTx = await deployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deploymentTx });

			const testSafeAddress = deployment.data.safeAddress;
			const chainId = await publicClient.getChainId();

			// Create transaction for this specific Safe
			const testSafeTx: FullSafeTransaction = {
				to: randomAddress(),
				value: 0n,
				data: "0x",
				operation: Operation.Call,
				safeTxGas: 0n,
				baseGas: 0n,
				gasPrice: 0n,
				gasToken: "0x0000000000000000000000000000000000000000",
				refundReceiver: "0x0000000000000000000000000000000000000000",
				nonce: 0n,
				safeAddress: testSafeAddress,
				chainId: BigInt(chainId),
			};

			const testSafeTxData = encodeEIP712SafeTransactionData(testSafeTx);
			const testTxHash = keccak256(testSafeTxData);

			// Approve hash from owner 0
			const approveHashData = encodeFunctionData({
				abi: PARSED_SAFE_ABI,
				functionName: "approveHash",
				args: [testTxHash],
			});

			const approveTx = await walletClients[0].sendTransaction({
				to: testSafeAddress,
				data: approveHashData,
				from: owners[0],
			});
			await publicClient.waitForTransactionReceipt({ hash: approveTx });

			// Create mixed signatures
			const ecdsaSig = await walletClients[1].account.sign?.({
				hash: testTxHash,
			});
			const contractSigData = randomBytesHex(65);

			if (!ecdsaSig) {
				throw new Error("Failed to sign");
			}

			const signatures = [
				{ signer: owners[0] }, // Approved hash
				{ signer: owners[1], data: ecdsaSig }, // ECDSA
				{ signer: mockSigner, data: contractSigData, dynamic: true }, // EIP-1271
			];

			const { valid } = await checkNSignatures(publicClient, {
				safeAddress: testSafeAddress,
				dataHash: testTxHash,
				data: testSafeTxData,
				signatures,
				requiredSignatures: 3n,
			});

			expect(valid).toBe(true);
		});

		test("should validate with more signatures than required", async () => {
			// Get signatures from all 3 owners
			const signatures = await Promise.all(
				owners.map(async (owner, index) => {
					const sig = await walletClients[index]?.account.sign?.({
						hash: txHash,
					});
					if (!sig) throw new Error("Failed to sign");
					return { signer: owner, data: sig };
				}),
			);

			// Check with only 2 required (threshold is 2)
			const { valid } = await checkNSignatures(publicClient, {
				safeAddress,
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(valid).toBe(true);
		});

		test("should validate with block parameter", async () => {
			// get block number before the deployment
			const blockNumber = await publicClient.getBlockNumber();

			// deploy a new safe
			const deployment = await deploySafeAccount(publicClient, {
				owners: [owners[0], owners[1]],
				threshold: 2n,
				saltNonce: blockNumber,
			});

			const deploymentTx = await deployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deploymentTx });

			const testSafeAddress = deployment.data.safeAddress;

			const sig1 = await walletClients[0].account.sign?.({
				hash: txHash,
			});
			const sig2 = await walletClients[1].account.sign?.({
				hash: txHash,
			});

			if (!sig1 || !sig2) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
				{ signer: owners[1], data: sig2 },
			];

			const { valid } = await checkNSignatures(
				publicClient,
				{
					safeAddress: testSafeAddress,
					dataHash: txHash,
					data: "0x",
					signatures,
					requiredSignatures: 2n,
				},
				{ block: "latest" },
			);

			expect(valid).toBe(true);

			// validate before the deployment
			const { valid: validBefore } = await checkNSignatures(
				publicClient,
				{
					safeAddress: testSafeAddress,
					dataHash: txHash,
					data: "0x",
					signatures,
					requiredSignatures: 2n,
				},
				{ block: `0x${blockNumber.toString(16)}` },
			);

			expect(validBefore).toBe(false);
		});
	});

	describe("invalid signatures", () => {
		test("should return false for insufficient signatures", async () => {
			// Only get one signature when 2 are required
			const sig1 = await walletClients[0].account.sign?.({
				hash: txHash,
			});

			if (!sig1) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
			];

			const { valid } = await checkNSignatures(publicClient, {
				safeAddress,
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(valid).toBe(false);
		});

		test("should return false for signatures from non-owners", async () => {
			// Create new accounts that are not owners
			const nonOwner1 = privateKeyToAccount(generatePrivateKey());
			const nonOwner2 = privateKeyToAccount(generatePrivateKey());

			const sig1 = await nonOwner1.sign({
				hash: txHash,
			});
			const sig2 = await nonOwner2.sign({
				hash: txHash,
			});

			const signatures: PicosafeSignature[] = [
				{ signer: nonOwner1.address, data: sig1 },
				{ signer: nonOwner2.address, data: sig2 },
			];

			const { valid } = await checkNSignatures(publicClient, {
				safeAddress,
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(valid).toBe(false);
		});

		test("should return false for duplicate signers", async () => {
			// Get signature from one owner
			const sig1 = await walletClients[0].account.sign?.({
				hash: txHash,
			});

			if (!sig1) {
				throw new Error("Failed to sign");
			}

			// Use the same signature twice (duplicate signer)
			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
				{ signer: owners[0], data: sig1 },
			];

			const { valid } = await checkNSignatures(publicClient, {
				safeAddress,
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(valid).toBe(false);
		});

		test("should return false for invalid signature data", async () => {
			// Create signatures with wrong hash
			const wrongHash = keccak256(toHex("wrong data"));

			const sig1 = await walletClients[0].account.sign?.({
				hash: wrongHash,
			});
			const sig2 = await walletClients[1].account.sign?.({
				hash: wrongHash,
			});

			if (!sig1 || !sig2) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
				{ signer: owners[1], data: sig2 },
			];

			const { valid } = await checkNSignatures(publicClient, {
				safeAddress,
				dataHash: txHash, // Different hash than what was signed
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(valid).toBe(false);
		});

		test("should return false for malformed signatures", async () => {
			// Test with too short signature
			const shortSig = "0x1234";

			// First test with a single short signature that will return invalid
			const { valid: shortSigValid, error } = await checkNSignatures(
				publicClient,
				{
					safeAddress,
					dataHash: txHash,
					data: "0x",
					signatures: [{ signer: owners[0], data: shortSig }],
					requiredSignatures: 1n,
				},
			);
			expect(shortSigValid).toBe(false);
			expect(error?.message).toContain("Invalid ECDSA signature length");

			// Test with random data that looks valid in length but is invalid
			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: randomBytesHex(65) },
				{ signer: owners[1], data: randomBytesHex(65) },
			];

			const { valid } = await checkNSignatures(publicClient, {
				safeAddress,
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(valid).toBe(false);
		});

		test("should return false for EIP-1271 contract returning wrong magic value", async () => {
			// Deploy a mock contract that returns wrong magic value
			const mockSigner = randomAddress();
			await testClient.setCode({
				address: mockSigner,
				bytecode: getMockERC1271InvalidBytecode(), // Returns wrong value
			});

			// Deploy a new Safe with mock signer as an owner
			const deployment = await deploySafeAccount(publicClient, {
				owners: [owners[0], mockSigner],
				threshold: 2n,
				saltNonce: BigInt(Date.now() + 300),
			});

			const deploymentTx = await deployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deploymentTx });

			const testSafeAddress = deployment.data.safeAddress;
			const chainId = await publicClient.getChainId();

			// Create transaction for this specific Safe
			const testSafeTx: FullSafeTransaction = {
				to: randomAddress(),
				value: 0n,
				data: "0x",
				operation: Operation.Call,
				safeTxGas: 0n,
				baseGas: 0n,
				gasPrice: 0n,
				gasToken: "0x0000000000000000000000000000000000000000",
				refundReceiver: "0x0000000000000000000000000000000000000000",
				nonce: 0n,
				safeAddress: testSafeAddress,
				chainId: BigInt(chainId),
			};

			const testTxHash = calculateSafeTransactionHash(testSafeTx);

			// Get one valid ECDSA signature
			const ecdsaSig = await walletClients[0].account.sign?.({
				hash: testTxHash,
			});

			if (!ecdsaSig) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: ecdsaSig },
				{ signer: mockSigner, data: randomBytesHex(65), dynamic: true },
			];

			const { valid } = await checkNSignatures(publicClient, {
				safeAddress: testSafeAddress,
				dataHash: testTxHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(valid).toBe(false);
		});

		test("should return false for unapproved hash signatures", async () => {
			// Create approved hash signature without actually approving
			const approvedSig = getApprovedHashSignatureBytes(owners[0]);
			const ecdsaSig = await walletClients[1].account.sign?.({
				hash: txHash,
			});

			if (!ecdsaSig) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: approvedSig }, // Not actually approved
				{ signer: owners[1], data: ecdsaSig },
			];

			const { valid } = await checkNSignatures(publicClient, {
				safeAddress,
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(valid).toBe(false);
		});

		test("should return false when signatures not sorted by signer", async () => {
			const sig1 = await walletClients[0].account.sign?.({
				hash: txHash,
			});
			const sig2 = await walletClients[1].account.sign?.({
				hash: txHash,
			});

			if (!sig1 || !sig2) {
				throw new Error("Failed to sign");
			}

			// Manually encode signatures in wrong order
			const encoded = concatHex([
				owners[0] > owners[1] ? sig1 : sig2, // Higher address first (wrong order)
				owners[0] > owners[1] ? sig2 : sig1,
			]);

			const { valid } = await checkNSignatures(publicClient, {
				safeAddress,
				dataHash: txHash,
				data: "0x",
				signatures: encoded,
				requiredSignatures: 2n,
			});

			expect(valid).toBe(false);
		});
	});

	describe("error cases", () => {
		test("should throw for requiredSignatures <= 0", async () => {
			const signatures: PicosafeSignature[] = [];

			expect(() =>
				checkNSignatures(publicClient, {
					safeAddress,
					dataHash: txHash,
					data: "0x",
					signatures,
					requiredSignatures: 0n,
				}),
			).toThrow("Required signatures must be greater than 0");

			expect(() =>
				checkNSignatures(publicClient, {
					safeAddress,
					dataHash: txHash,
					data: "0x",
					signatures,
					requiredSignatures: -1n,
				}),
			).toThrow("Required signatures must be greater than 0");
		});

		test("should handle empty signatures array", async () => {
			const signatures: PicosafeSignature[] = [];

			const { valid } = await checkNSignatures(publicClient, {
				safeAddress,
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 1n,
			});

			expect(valid).toBe(false);
		});

		test("should handle contract without checkNSignatures function", async () => {
			// Don't deploy any code at this address - it will be an EOA
			const nonSafeAddress = randomAddress();

			const sig1 = await walletClients[0].account.sign?.({
				hash: txHash,
			});

			if (!sig1) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
			];

			const { valid } = await checkNSignatures(publicClient, {
				safeAddress: nonSafeAddress,
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 1n,
			});

			// Calling a non-existent contract should return false
			expect(valid).toBe(false);
		});

		test("should handle provider errors gracefully", async () => {
			const mockProvider = {
				request: async () => {
					throw new Error("Network error");
				},
			};

			const sig1 = await walletClients[0].account.sign?.({
				hash: txHash,
			});

			if (!sig1) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
			];

			const { valid, error } = await checkNSignatures(mockProvider, {
				safeAddress,
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 1n,
			});

			expect(valid).toBe(false);
			expect(error?.message).toContain("Network error");
		});
	});

	describe("lazy evaluation", () => {
		test("should support lazy evaluation for checkNSignatures", async () => {
			const sig1 = await walletClients[0].account.sign?.({
				hash: txHash,
			});
			const sig2 = await walletClients[1].account.sign?.({
				hash: txHash,
			});

			if (!sig1 || !sig2) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
				{ signer: owners[1], data: sig2 },
			];

			// Get lazy call object
			const validationCall = await checkNSignatures(
				publicClient,
				{
					safeAddress,
					dataHash: txHash,
					data: "0x",
					signatures,
					requiredSignatures: 2n,
				},
				{ lazy: true },
			);

			// Verify structure
			expect(validationCall).toHaveProperty("rawCall");
			expect(validationCall).toHaveProperty("call");
			expect(validationCall.rawCall).toMatchObject({
				to: safeAddress,
				data: expect.stringMatching(/^0x12fb68e0/), // checkNSignatures selector
			});

			// Execute the call
			const result = await validationCall.call();
			expect(result.valid).toBe(true);
		});

		test("should properly handle errors in lazy evaluation", async () => {
			// Create signatures with wrong hash
			const wrongHash = keccak256(toHex("wrong data"));

			const sig1 = await walletClients[0].account.sign?.({
				hash: wrongHash,
			});
			const sig2 = await walletClients[1].account.sign?.({
				hash: wrongHash,
			});

			if (!sig1 || !sig2) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
				{ signer: owners[1], data: sig2 },
			];

			// Get lazy call object
			const validationCall = await checkNSignatures(
				publicClient,
				{
					safeAddress,
					dataHash: txHash, // Different hash than what was signed
					data: "0x",
					signatures,
					requiredSignatures: 2n,
				},
				{ lazy: true },
			);

			// Execute the call - should return invalid
			const result = await validationCall.call();
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		});
	});
});

describe("validateSignaturesForSafe", () => {
	const { testClient, publicClient, walletClients } = createClients();
	let resetSnapshot: () => Promise<void>;
	let safeAddress: Address;
	let owners: [Address, Address, Address];
	let safeTx: FullSafeTransaction;
	let txHash: Hex;

	beforeEach(async () => {
		resetSnapshot = await snapshot(testClient);

		// Setup Safe with 3 owners and threshold of 2
		owners = [
			walletClients[0].account.address,
			walletClients[1].account.address,
			walletClients[2].account.address,
		] as const;

		const deployment = await deploySafeAccount(publicClient, {
			owners,
			threshold: 2n,
		});

		const deploymentTx = await deployment.send();
		await publicClient.waitForTransactionReceipt({ hash: deploymentTx });

		safeAddress = deployment.data.safeAddress;

		// Get chain ID for the Safe transaction
		const chainId = await publicClient.getChainId();

		// Create a standard Safe transaction for testing
		safeTx = {
			to: randomAddress(),
			value: 0n,
			data: "0x",
			operation: Operation.Call,
			safeTxGas: 0n,
			baseGas: 0n,
			gasPrice: 0n,
			gasToken: "0x0000000000000000000000000000000000000000",
			refundReceiver: "0x0000000000000000000000000000000000000000",
			nonce: 0n,
			safeAddress,
			chainId: BigInt(chainId),
		};

		txHash = calculateSafeTransactionHash(safeTx);
	});

	afterEach(async () => {
		await resetSnapshot();
	});

	describe("valid signatures", () => {
		test("should validate multiple ECDSA signatures from Safe owners", async () => {
			const sig1 = await walletClients[0].account.sign?.({
				hash: txHash,
			});
			const sig2 = await walletClients[1].account.sign?.({
				hash: txHash,
			});

			if (!sig1 || !sig2) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
				{ signer: owners[1], data: sig2 },
			];

			const validation = await validateSignaturesForSafe(
				publicClient,
				safeAddress,
				{
					signatures,
					dataHash: txHash,
				},
			);

			expect(validation.valid).toBe(true);
			expect(validation.results).toHaveLength(2);
			expect(validation.results[0]?.valid).toBe(true);
			expect(validation.results[0]?.validatedSigner).toBe(owners[0]);
			expect(validation.results[1]?.valid).toBe(true);
			expect(validation.results[1]?.validatedSigner).toBe(owners[1]);
		});

		test("should validate mixed signature types", async () => {
			// Deploy a mock contract signer
			const mockSigner = randomAddress();
			await testClient.setCode({
				address: mockSigner,
				// Returns legacy ERC-1271 magic value (0x20c13b0b) that Safe expects
				bytecode: getMockERC1271LegacyValidBytecode(),
			});

			// Deploy a new Safe with mock signer as an owner
			const deployment = await deploySafeAccount(publicClient, {
				owners: [owners[0], owners[1], mockSigner],
				threshold: 3n,
				saltNonce: BigInt(Date.now() + 1000),
			});

			const deploymentTx = await deployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deploymentTx });

			const testSafeAddress = deployment.data.safeAddress;
			const chainId = await publicClient.getChainId();

			// Create transaction for this specific Safe
			const testSafeTx: FullSafeTransaction = {
				to: randomAddress(),
				value: 0n,
				data: "0x",
				operation: Operation.Call,
				safeTxGas: 0n,
				baseGas: 0n,
				gasPrice: 0n,
				gasToken: "0x0000000000000000000000000000000000000000",
				refundReceiver: "0x0000000000000000000000000000000000000000",
				nonce: 0n,
				safeAddress: testSafeAddress,
				chainId: BigInt(chainId),
			};

			const testSafeTxData = encodeEIP712SafeTransactionData(testSafeTx);
			const testTxHash = keccak256(testSafeTxData);

			// Approve hash from owner 0
			const approveHashData = encodeFunctionData({
				abi: PARSED_SAFE_ABI,
				functionName: "approveHash",
				args: [testTxHash],
			});

			const approveTx = await walletClients[0].sendTransaction({
				to: testSafeAddress,
				data: approveHashData,
				from: owners[0],
			});
			await publicClient.waitForTransactionReceipt({ hash: approveTx });

			// Create mixed signatures
			const ecdsaSig = await walletClients[1].account.sign?.({
				hash: testTxHash,
			});
			const contractSigData = randomBytesHex(65);

			const ethSignSig = await walletClients[2].account.signMessage?.({
				message: {
					raw: toBytes(testTxHash),
				},
			});
			if (!ethSignSig) {
				throw new Error("Failed to sign");
			}
			const adjustedVByte = Number.parseInt(ethSignSig.slice(-2), 16) + 4;
			const adjustedEthSignSig = concatHex([
				ethSignSig.slice(0, -2) as Hex,
				adjustedVByte.toString(16).padStart(2, "0") as Hex,
			]);

			if (!ecdsaSig) {
				throw new Error("Failed to sign");
			}

			const signatures = [
				{ signer: owners[0] }, // Approved hash
				{ signer: owners[1], data: ecdsaSig }, // ECDSA
				{ signer: owners[2], data: adjustedEthSignSig }, // EthSign
				{ signer: mockSigner, data: contractSigData, dynamic: true }, // EIP-1271
			];

			const validation = await validateSignaturesForSafe(
				publicClient,
				testSafeAddress,
				{
					signatures,
					data: testSafeTxData,
					dataHash: testTxHash,
				},
			);

			expect(validation.valid).toBe(true);
			expect(validation.results).toHaveLength(4);
			expect(validation.results.every((r) => r.valid)).toBe(true);
		});

		test("should validate with encoded signatures hex", async () => {
			const sig1 = await walletClients[0].account.sign?.({
				hash: txHash,
			});
			const sig2 = await walletClients[1].account.sign?.({
				hash: txHash,
			});

			if (!sig1 || !sig2) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
				{ signer: owners[1], data: sig2 },
			];

			const encodedSigs = encodeSafeSignaturesBytes(signatures);

			const validation = await validateSignaturesForSafe(
				publicClient,
				safeAddress,
				{
					signatures: encodedSigs,
					dataHash: txHash,
				},
			);

			expect(validation.valid).toBe(true);
			expect(validation.results).toHaveLength(2);
			expect(validation.results[0]?.valid).toBe(true);
			expect(validation.results[1]?.valid).toBe(true);
		});

		test("should validate with provided Safe configuration", async () => {
			const sig1 = await walletClients[0].account.sign?.({
				hash: txHash,
			});
			const sig2 = await walletClients[1].account.sign?.({
				hash: txHash,
			});

			if (!sig1 || !sig2) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
				{ signer: owners[1], data: sig2 },
			];

			// Provide configuration to avoid chain calls
			const validation = await validateSignaturesForSafe(
				publicClient,
				safeAddress,
				{
					signatures,
					dataHash: txHash,
				},
				{
					threshold: 2n,
					owners: owners,
				},
			);

			expect(validation.valid).toBe(true);
			expect(validation.results).toHaveLength(2);
			expect(validation.results[0]?.valid).toBe(true);
			expect(validation.results[1]?.valid).toBe(true);
		});

		test("should validate when signatures exceed threshold", async () => {
			// Get signatures from all 3 owners
			const signatures = await Promise.all(
				owners.map(async (owner, index) => {
					const sig = await walletClients[index]?.account.sign?.({
						hash: txHash,
					});
					if (!sig) throw new Error("Failed to sign");
					return { signer: owner, data: sig };
				}),
			);

			const validation = await validateSignaturesForSafe(
				publicClient,
				safeAddress,
				{
					signatures,
					dataHash: txHash,
				},
			);

			// Threshold is 2, but we have 3 valid signatures
			expect(validation.valid).toBe(true);
			expect(validation.results).toHaveLength(3);
			expect(validation.results.every((r) => r.valid)).toBe(true);
		});
	});

	describe("invalid signatures", () => {
		test("should return invalid when not enough valid owner signatures", async () => {
			// Only get one signature when threshold is 2
			const sig1 = await walletClients[0].account.sign?.({
				hash: txHash,
			});

			if (!sig1) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
			];

			const validation = await validateSignaturesForSafe(
				publicClient,
				safeAddress,
				{
					signatures,
					dataHash: txHash,
				},
			);

			expect(validation.valid).toBe(false);
			expect(validation.results).toHaveLength(1);
			expect(validation.results[0]?.valid).toBe(true);
		});

		test("should return invalid when signers are not Safe owners", async () => {
			// Create new accounts that are not owners
			const nonOwner1 = privateKeyToAccount(generatePrivateKey());
			const nonOwner2 = privateKeyToAccount(generatePrivateKey());

			const sig1 = await nonOwner1.sign({
				hash: txHash,
			});
			const sig2 = await nonOwner2.sign({
				hash: txHash,
			});

			const signatures: PicosafeSignature[] = [
				{ signer: nonOwner1.address, data: sig1 },
				{ signer: nonOwner2.address, data: sig2 },
			];

			const validation = await validateSignaturesForSafe(
				publicClient,
				safeAddress,
				{
					signatures,
					dataHash: txHash,
				},
			);

			expect(validation.valid).toBe(false);
			// Signatures are cryptographically valid but signers are not owners
			expect(validation.results[0]?.valid).toBe(true);
			expect(validation.results[1]?.valid).toBe(true);
			expect(validation.results[0]?.validatedSigner).toBe(nonOwner1.address);
			expect(validation.results[1]?.validatedSigner).toBe(nonOwner2.address);
		});

		test("should not count duplicate owners multiple times", async () => {
			// Get signature from one owner
			const sig1 = await walletClients[0].account.sign?.({
				hash: txHash,
			});

			if (!sig1) {
				throw new Error("Failed to sign");
			}

			// Use the same owner's signature twice
			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
				{ signer: owners[0], data: sig1 },
			];

			const validation = await validateSignaturesForSafe(
				publicClient,
				safeAddress,
				{
					signatures,
					dataHash: txHash,
				},
			);

			// Should be invalid because we need 2 different owners
			expect(validation.valid).toBe(false);
			expect(validation.results).toHaveLength(2);
			// Both signatures are valid individually
			expect(validation.results[0]?.valid).toBe(true);
			expect(validation.results[1]?.valid).toBe(true);
		});

		test("should return invalid when signature validation fails", async () => {
			// Create signatures with wrong hash
			const wrongHash = keccak256(toHex("wrong data"));

			const sig1 = await walletClients[0].account.sign?.({
				hash: wrongHash,
			});
			const sig2 = await walletClients[1].account.sign?.({
				hash: wrongHash,
			});

			if (!sig1 || !sig2) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
				{ signer: owners[1], data: sig2 },
			];

			const validation = await validateSignaturesForSafe(
				publicClient,
				safeAddress,
				{
					signatures,
					dataHash: txHash, // Different hash than what was signed
				},
			);

			expect(validation.valid).toBe(false);
			expect(validation.results).toHaveLength(2);
			// Signatures are invalid because they signed different data
			expect(validation.results[0]?.valid).toBe(false);
			expect(validation.results[1]?.valid).toBe(false);
		});

		test("should handle mixed valid and invalid signatures", async () => {
			const validSig = await walletClients[0].account.sign?.({
				hash: txHash,
			});
			const wrongHashSig = await walletClients[1].account.sign?.({
				hash: keccak256(toHex("wrong data")),
			});
			const nonOwner = privateKeyToAccount(generatePrivateKey());
			const nonOwnerSig = await nonOwner.sign({
				hash: txHash,
			});

			if (!validSig || !wrongHashSig) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: validSig }, // Valid owner signature
				{ signer: owners[1], data: wrongHashSig }, // Invalid signature (wrong hash)
				{ signer: nonOwner.address, data: nonOwnerSig }, // Valid signature but not owner
			];

			const validation = await validateSignaturesForSafe(
				publicClient,
				safeAddress,
				{
					signatures,
					dataHash: txHash,
				},
			);

			// Only 1 valid owner signature, need 2
			expect(validation.valid).toBe(false);
			expect(validation.results).toHaveLength(3);
			expect(validation.results[0]?.valid).toBe(true); // Valid owner
			expect(validation.results[1]?.valid).toBe(false); // Wrong hash
			expect(validation.results[2]?.valid).toBe(true); // Valid but not owner
		});
	});

	describe("edge cases", () => {
		test("should handle empty signatures array", async () => {
			const signatures: PicosafeSignature[] = [];

			const validation = await validateSignaturesForSafe(
				publicClient,
				safeAddress,
				{
					signatures,
					dataHash: txHash,
				},
			);

			expect(validation.valid).toBe(false);
			expect(validation.results).toHaveLength(0);
		});

		test("should handle malformed signatures gracefully", async () => {
			// For malformed signatures, we'll test with signatures that have valid v-bytes but invalid r,s values
			const malformedSig1 = concatHex([
				randomBytesHex(32), // random r
				randomBytesHex(32), // random s
				"0x1b", // v=27 (valid EIP-712 signature type)
			]);
			const malformedSig2 = concatHex([
				randomBytesHex(32), // random r
				randomBytesHex(32), // random s
				"0x1c", // v=28 (valid EIP-712 signature type)
			]);

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: malformedSig1 },
				{ signer: owners[1], data: malformedSig2 },
			];

			const validation = await validateSignaturesForSafe(
				publicClient,
				safeAddress,
				{
					signatures,
					dataHash: txHash,
				},
			);

			expect(validation.valid).toBe(false);
			expect(validation.results).toHaveLength(2);
			// The signatures have valid format but won't recover to the expected signers
			expect(validation.results[0]?.valid).toBe(false);
			expect(validation.results[1]?.valid).toBe(false);
		});

		test("should validate approved hash signature with SafeAddress", async () => {
			// Approve hash from owner 0
			const approveHashData = encodeFunctionData({
				abi: PARSED_SAFE_ABI,
				functionName: "approveHash",
				args: [txHash],
			});

			const approveTx = await walletClients[0].sendTransaction({
				to: safeAddress,
				data: approveHashData,
				from: owners[0],
			});
			await publicClient.waitForTransactionReceipt({ hash: approveTx });

			// Get ECDSA signature from owner 1
			const ecdsaSig = await walletClients[1].account.sign?.({
				hash: txHash,
			});

			if (!ecdsaSig) {
				throw new Error("Failed to sign");
			}

			const signatures = [
				{ signer: owners[0] }, // Approved hash
				{ signer: owners[1], data: ecdsaSig }, // ECDSA
			];

			const validation = await validateSignaturesForSafe(
				publicClient,
				safeAddress,
				{
					signatures,
					dataHash: txHash,
				},
			);

			expect(validation.valid).toBe(true);
			expect(validation.results).toHaveLength(2);
			expect(validation.results[0]?.valid).toBe(true);
			expect(validation.results[1]?.valid).toBe(true);
		});

		test("should handle contract signatures with data parameter", async () => {
			// Deploy a mock contract signer
			const mockSigner = randomAddress();
			await testClient.setCode({
				address: mockSigner,
				// Returns legacy ERC-1271 magic value (0x20c13b0b) that Safe expects
				bytecode: getMockERC1271LegacyValidBytecode(),
			});

			// Deploy a new Safe with mock signer as an owner
			const deployment = await deploySafeAccount(publicClient, {
				owners: [owners[0], mockSigner],
				threshold: 2n,
				saltNonce: BigInt(Date.now() + 2000),
			});

			const deploymentTx = await deployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deploymentTx });

			const testSafeAddress = deployment.data.safeAddress;
			const chainId = await publicClient.getChainId();

			// Create transaction for this specific Safe
			const testSafeTx: FullSafeTransaction = {
				to: randomAddress(),
				value: 0n,
				data: "0x",
				operation: Operation.Call,
				safeTxGas: 0n,
				baseGas: 0n,
				gasPrice: 0n,
				gasToken: "0x0000000000000000000000000000000000000000",
				refundReceiver: "0x0000000000000000000000000000000000000000",
				nonce: 0n,
				safeAddress: testSafeAddress,
				chainId: BigInt(chainId),
			};

			const testSafeTxData = encodeEIP712SafeTransactionData(testSafeTx);
			const testTxHash = keccak256(testSafeTxData);

			// Get ECDSA signature from owner 0
			const ecdsaSig = await walletClients[0].account.sign?.({
				hash: testTxHash,
			});

			if (!ecdsaSig) {
				throw new Error("Failed to sign");
			}

			const signatures = [
				{ signer: owners[0], data: ecdsaSig }, // ECDSA
				{ signer: mockSigner, data: randomBytesHex(65), dynamic: true }, // EIP-1271
			];

			// Test with data parameter for contract signature
			const validation = await validateSignaturesForSafe(
				publicClient,
				testSafeAddress,
				{
					signatures,
					data: testSafeTxData,
					dataHash: testTxHash,
				},
			);

			expect(validation.valid).toBe(true);
			expect(validation.results).toHaveLength(2);
			expect(validation.results[0]?.valid).toBe(true);
			expect(validation.results[1]?.valid).toBe(true);
		});
	});
});
