import type { Address, Hex } from "viem";
import {
	concatHex,
	encodeFunctionData,
	hashMessage,
	keccak256,
	toHex,
	parseAbi,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, test } from "vitest";
import { PARSED_SAFE_ABI } from "../src/abis";
import { deploySafeAccount } from "../src/deployment";
import { calculateSafeTransactionHash } from "../src/eip712";
import {
	checkNSignatures,
	encodeSafeSignaturesBytes,
	getApprovedHashSignatureBytes,
} from "../src/safe-signatures";
import type {
	PicosafeSignature,
	FullSafeTransaction,
} from "../src/types";
import { Operation } from "../src/types";
import { createClients, snapshot } from "./fixtures/setup";
import { randomAddress, randomBytesHex } from "./utils";

// Safe owner management ABI - these functions are not in the main Safe ABI
const SAFE_OWNER_ABI = parseAbi([
	"function addOwnerWithThreshold(address owner, uint256 _threshold)",
	"function removeOwner(address prevOwner, address owner, uint256 _threshold)",
	"function changeThreshold(uint256 _threshold)",
]);

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
			saltNonce: BigInt(Date.now()),
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
			// Sign with two owners
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

			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: txHash,
				data: "0x", // Empty data for simple transfer
				signatures,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(true);
		});

		test("should validate with encoded signatures hex", async () => {
			// Sign with two owners
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

			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: txHash,
				data: "0x",
				signatures: encodedSigs,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(true);
		});

		test("should validate eth_sign signatures", async () => {
			// For eth_sign, we sign the transaction hash directly
			// The Safe contract will apply the Ethereum signed message prefix internally
			// when it sees v=31 or v=32
			
			const sig1 = await walletClients[0].account.sign?.({
				hash: txHash,
			});
			const sig2 = await walletClients[1].account.sign?.({
				hash: txHash,
			});

			if (!sig1 || !sig2) {
				throw new Error("Failed to sign");
			}

			// Convert v values from 27/28 to 31/32 for eth_sign
			const v1 = Number.parseInt(sig1.slice(-2), 16);
			const v2 = Number.parseInt(sig2.slice(-2), 16);
			const ethSignSig1 = (sig1.slice(0, -2) + (v1 + 4).toString(16).padStart(2, '0')) as Hex;
			const ethSignSig2 = (sig2.slice(0, -2) + (v2 + 4).toString(16).padStart(2, '0')) as Hex;

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: ethSignSig1 },
				{ signer: owners[1], data: ethSignSig2 },
			];

			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(true);
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

			// Create one approved signature and one ECDSA signature
			const approvedSig = getApprovedHashSignatureBytes(owners[0]);
			const ecdsaSig = await walletClients[1].account.sign?.({
				hash: txHash,
			});

			if (!ecdsaSig) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: approvedSig },
				{ signer: owners[1], data: ecdsaSig },
			];

			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(true);
		});

		test("should validate EIP-1271 contract signatures", async () => {
			// Deploy a Safe with a contract owner from the start
			const mockSigner = randomAddress();
			await testClient.setCode({
				address: mockSigner,
				// Returns legacy ERC-1271 magic value (0x20c13b0b) that Safe expects
				bytecode: "0x6320c13b0b60e01b5f5260205ff3",
			});

			// Deploy a new Safe with the mock signer as an owner
			const deployment = await deploySafeAccount(publicClient, {
				owners: [owners[0], owners[1], mockSigner],
				threshold: 2n,
				saltNonce: BigInt(Date.now() + 100),
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

			// Get one ECDSA signature from an owner
			const ecdsaSig = await walletClients[0].account.sign?.({
				hash: testTxHash,
			});

			if (!ecdsaSig) {
				throw new Error("Failed to sign");
			}

			// Create a dynamic signature for the contract
			const contractSigData = randomBytesHex(130); // Some arbitrary signature data

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: ecdsaSig },
				{ signer: mockSigner, data: contractSigData, dynamic: true },
			];

			const isValid = await checkNSignatures(publicClient, testSafeAddress, {
				dataHash: testTxHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(true);
		});

		test("should validate mixed signature types", async () => {
			// Deploy a mock contract signer
			const mockSigner = randomAddress();
			await testClient.setCode({
				address: mockSigner,
				// Returns legacy ERC-1271 magic value (0x20c13b0b) that Safe expects
				bytecode: "0x6320c13b0b60e01b5f5260205ff3",
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

			const testTxHash = calculateSafeTransactionHash(testSafeTx);

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
			const approvedSig = getApprovedHashSignatureBytes(owners[0]);
			const ecdsaSig = await walletClients[1].account.sign?.({
				hash: testTxHash,
			});
			const contractSigData = randomBytesHex(65);

			if (!ecdsaSig) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: approvedSig }, // Approved hash
				{ signer: owners[1], data: ecdsaSig }, // ECDSA
				{ signer: mockSigner, data: contractSigData, dynamic: true }, // EIP-1271
			];

			const isValid = await checkNSignatures(publicClient, testSafeAddress, {
				dataHash: testTxHash,
				data: "0x",
				signatures,
				requiredSignatures: 3n,
			});

			expect(isValid).toBe(true);
		});

		test("should validate with more signatures than required", async () => {
			// Get signatures from all 3 owners
			const sigs = await Promise.all(
				owners.map(async (owner, index) => {
					const sig = await walletClients[index].account.sign?.({
						hash: txHash,
					});
					if (!sig) throw new Error("Failed to sign");
					return { signer: owner, data: sig };
				})
			);

			// Check with only 2 required (threshold is 2)
			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: txHash,
				data: "0x",
				signatures: sigs,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(true);
		});

		test("should validate with exact required signatures", async () => {
			// Get signatures from exactly 2 owners
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

			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(true);
		});

		test("should validate with block parameter", async () => {
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

			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
				block: "latest",
			});

			expect(isValid).toBe(true);
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

			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(false);
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

			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(false);
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

			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(false);
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

			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: txHash, // Different hash than what was signed
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(false);
		});

		test("should return false for malformed signatures", async () => {
			// Test with too short signature
			const shortSig = "0x1234" as Hex;
			
			// First test with a single short signature that will throw
			await expect(
				checkNSignatures(publicClient, safeAddress, {
					dataHash: txHash,
					data: "0x",
					signatures: [{ signer: owners[0], data: shortSig }],
					requiredSignatures: 1n,
				})
			).rejects.toThrow("Invalid ECDSA signature length");

			// Test with random data that looks valid in length but is invalid
			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: randomBytesHex(65) },
				{ signer: owners[1], data: randomBytesHex(65) },
			];

			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(false);
		});

		test("should return false for EIP-1271 contract returning wrong magic value", async () => {
			// Deploy a mock contract that returns wrong magic value
			const mockSigner = randomAddress();
			await testClient.setCode({
				address: mockSigner,
				bytecode: "0x63c0ffee0060e01b5f5260205ff3", // Returns wrong value
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

			const isValid = await checkNSignatures(publicClient, testSafeAddress, {
				dataHash: testTxHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(false);
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

			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(false);
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

			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: txHash,
				data: "0x",
				signatures: encoded,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(false);
		});
	});

	describe("error cases", () => {
		test("should throw for requiredSignatures <= 0", async () => {
			const signatures: PicosafeSignature[] = [];

			await expect(
				checkNSignatures(publicClient, safeAddress, {
					dataHash: txHash,
					data: "0x",
					signatures,
					requiredSignatures: 0n,
				})
			).rejects.toThrow("Required signatures must be greater than 0");

			await expect(
				checkNSignatures(publicClient, safeAddress, {
					dataHash: txHash,
					data: "0x",
					signatures,
					requiredSignatures: -1n,
				})
			).rejects.toThrow("Required signatures must be greater than 0");
		});

		test("should handle empty signatures array", async () => {
			const signatures: PicosafeSignature[] = [];

			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 1n,
			});

			expect(isValid).toBe(false);
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

			const isValid = await checkNSignatures(publicClient, nonSafeAddress, {
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 1n,
			});

			// Calling a non-existent contract should return false
			expect(isValid).toBe(false);
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

			const isValid = await checkNSignatures(mockProvider as any, safeAddress, {
				dataHash: txHash,
				data: "0x",
				signatures,
				requiredSignatures: 1n,
			});

			expect(isValid).toBe(false);
		});
	});

	describe("complex scenarios", () => {
		test("should validate transaction with actual calldata", async () => {
			// Create a transaction with actual calldata
			const calldata = encodeFunctionData({
				abi: [
					{
						name: "transfer",
						type: "function",
						inputs: [
							{ name: "to", type: "address" },
							{ name: "amount", type: "uint256" },
						],
						outputs: [{ name: "", type: "bool" }],
					},
				],
				functionName: "transfer",
				args: [randomAddress(), 1000n],
			});

			const chainId = await publicClient.getChainId();
			const complexTx: FullSafeTransaction = {
				to: randomAddress(),
				value: 0n,
				data: calldata,
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

			const complexTxHash = calculateSafeTransactionHash(complexTx);

			// Sign the complex transaction
			const sig1 = await walletClients[0].account.sign?.({
				hash: complexTxHash,
			});
			const sig2 = await walletClients[1].account.sign?.({
				hash: complexTxHash,
			});

			if (!sig1 || !sig2) {
				throw new Error("Failed to sign");
			}

			const signatures: PicosafeSignature[] = [
				{ signer: owners[0], data: sig1 },
				{ signer: owners[1], data: sig2 },
			];

			const isValid = await checkNSignatures(publicClient, safeAddress, {
				dataHash: complexTxHash,
				data: calldata,
				signatures,
				requiredSignatures: 2n,
			});

			expect(isValid).toBe(true);
		});

		test("should validate with maximum allowed signatures", async () => {
			// Deploy a Safe with many owners
			const manyOwners = Array.from({ length: 10 }, () =>
				privateKeyToAccount(generatePrivateKey())
			);

			const deployment = await deploySafeAccount(publicClient, {
				owners: manyOwners.map((o) => o.address) as [Address, ...Address[]],
				threshold: 5n,
				saltNonce: BigInt(Date.now() + 1000),
			});

			const deploymentTx = await deployment.send();
			await publicClient.waitForTransactionReceipt({ hash: deploymentTx });

			const manySafeAddress = deployment.data.safeAddress;

			// Create transaction
			const chainId = await publicClient.getChainId();
			const manyTx: FullSafeTransaction = {
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
				safeAddress: manySafeAddress,
				chainId: BigInt(chainId),
			};

			const manyTxHash = calculateSafeTransactionHash(manyTx);

			// Get signatures from 5 owners (threshold)
			const signatures = await Promise.all(
				manyOwners.slice(0, 5).map(async (owner) => {
					const sig = await owner.sign({
						hash: manyTxHash,
					});
					return { signer: owner.address, data: sig };
				})
			);

			const isValid = await checkNSignatures(publicClient, manySafeAddress, {
				dataHash: manyTxHash,
				data: "0x",
				signatures,
				requiredSignatures: 5n,
			});

			expect(isValid).toBe(true);
		});
	});
});
