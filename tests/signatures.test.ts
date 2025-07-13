import { describe, expect, it, beforeEach } from "vitest";
import { 
	encodeSafeSignatures, 
	verifySafeSignatures,
	verifySafeSignaturesOffchain,
	parseSignatureType,
	extractSignatureComponents 
} from "../src/signatures";
import { buildSafeTransaction, signSafeTransaction } from "../src/transactions";
import { calculateSafeTransactionHash } from "../src/eip712";
import { getOwners, getThreshold } from "../src/account-state";
import { deploySafeAccount } from "../src/deployment";
import type { SafeSignature, EIP1193ProviderWithRequestFn } from "../src/types";
import { testSafeClient, testSigner } from "./fixtures/setup";

describe("encodeSafeSignatures", () => {
	it("should encode single ECDSA signature", () => {
		const signatures: SafeSignature[] = [
			{
				signer: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
				data: `0x${"a".repeat(64)}1b`, // 65 bytes
			},
		];

		const encoded = encodeSafeSignatures(signatures);
		expect(encoded).toBe(`0x${"a".repeat(64)}1b`);
	});

	it("should sort signatures by signer address", () => {
		const signatures: SafeSignature[] = [
			{
				signer: "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
				data: `0x${"b".repeat(64)}1c`,
			},
			{
				signer: "0x0000000000000000000000000000000000000001",
				data: `0x${"a".repeat(64)}1b`,
			},
		];

		const encoded = encodeSafeSignatures(signatures);
		// Should be sorted with 0x000...001 first, then 0xFFF...FFF
		expect(encoded).toBe(`0x${"a".repeat(64)}1b${"b".repeat(64)}1c`);
	});

	it("should handle dynamic signatures", () => {
		const signatures: SafeSignature[] = [
			{
				signer: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
				data: `0x${"a".repeat(64)}1b`, // Standard ECDSA
				dynamic: false,
			},
			{
				signer: "0x0000000000000000000000000000000000000001",
				data: `0x${"c".repeat(130)}`, // Dynamic signature
				dynamic: true,
			},
		];

		const encoded = encodeSafeSignatures(signatures);

		// Expected format:
		// 1. Static part for contract signature (sorted first): padded signer (32) + offset (32) + type (1)
		// 2. Static part for ECDSA signature: 65 bytes
		// 3. Dynamic part: length (32) + data

		const expectedStatic =
			"0x" +
			"0000000000000000000000000000000000000001".padStart(64, "0") + // signer
			(65 * 2).toString(16).padStart(64, "0") + // offset = 130 (after 2 signatures of 65 bytes each)
			"00" + // signature type
			"a".repeat(64) +
			"1b"; // ECDSA signature

		const expectedDynamic =
			(130 / 2)
				.toString(16)
				.padStart(64, "0") + // length = 65 bytes
			"c".repeat(130); // data

		expect(encoded).toBe(expectedStatic + expectedDynamic);
	});

	it("should handle empty array", () => {
		const signatures: SafeSignature[] = [];
		const encoded = encodeSafeSignatures(signatures);
		expect(encoded).toBe("0x");
	});

	it("should handle multiple dynamic signatures", () => {
		const signatures: SafeSignature[] = [
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

		const encoded = encodeSafeSignatures(signatures);

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

describe("parseSignatureType", () => {
	it("should identify ECDSA signatures", () => {
		const signature: SafeSignature = {
			signer: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
			data: `0x${"a".repeat(64)}1b`, // 65 bytes
		};
		
		expect(parseSignatureType(signature)).toBe("ecdsa");
	});

	it("should identify contract signatures by dynamic flag", () => {
		const signature: SafeSignature = {
			signer: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
			data: `0x${"a".repeat(130)}`, // Any length with dynamic flag
			dynamic: true,
		};
		
		expect(parseSignatureType(signature)).toBe("contract");
	});

	it("should identify approved hash signatures", () => {
		const signature: SafeSignature = {
			signer: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
			data: "0x",
		};
		
		expect(parseSignatureType(signature)).toBe("approved");
	});

	it("should default to contract for non-standard lengths", () => {
		const signature: SafeSignature = {
			signer: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
			data: `0x${"a".repeat(100)}`, // 50 bytes - not standard ECDSA
		};
		
		expect(parseSignatureType(signature)).toBe("contract");
	});
});

describe("extractSignatureComponents", () => {
	it("should extract r, s, v from valid ECDSA signature", () => {
		const signature = `0x${"a".repeat(64)}${"b".repeat(64)}1b`;
		
		const components = extractSignatureComponents(signature);
		
		expect(components.r).toBe(`0x${"a".repeat(64)}`);
		expect(components.s).toBe(`0x${"b".repeat(64)}`);
		expect(components.v).toBe(0x1b);
	});

	it("should throw error for invalid signature length", () => {
		const invalidSignature = `0x${"a".repeat(60)}`; // Too short
		
		expect(() => extractSignatureComponents(invalidSignature)).toThrow("Invalid ECDSA signature length");
	});
});

describe("Signature Verification Integration Tests", () => {
	let provider: EIP1193ProviderWithRequestFn;
	let safeAddress: string;
	let owner1: string;
	let owner2: string;

	beforeEach(async () => {
		provider = testSafeClient;
		owner1 = testSigner.account.address;
		owner2 = testSigner.account.address; // Using same for simplicity in tests
		
		// Deploy a new Safe for each test
		const deployment = await deploySafeAccount(provider, {
			owners: [owner1, owner2],
			threshold: 2n,
		});
		
		await deployment.send();
		safeAddress = deployment.safeAddress;
	});

	describe("verifySafeSignatures", () => {
		it("should verify valid signatures meet threshold", async () => {
			// Build a transaction
			const transaction = await buildSafeTransaction(provider, safeAddress, [{
				to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
				value: 1000000000000000000n,
				data: "0x"
			}]);

			// Sign with both owners
			const signature1 = await signSafeTransaction(provider, transaction, owner1);
			const signature2 = await signSafeTransaction(provider, transaction, owner2);

			// Verify signatures
			const isValid = await verifySafeSignatures(provider, {
				safeAddress: transaction.safeAddress,
				dataHash: calculateSafeTransactionHash(transaction),
				data: transaction.data,
				signatures: [signature1, signature2],
				requiredSignatures: 2n
			});

			expect(isValid).toBe(true);
		});

		it("should reject insufficient signatures", async () => {
			const transaction = await buildSafeTransaction(provider, safeAddress, [{
				to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
				value: 1000000000000000000n,
				data: "0x"
			}]);

			const signature1 = await signSafeTransaction(provider, transaction, owner1);

			// Try to verify with only 1 signature when threshold is 2
			const isValid = await verifySafeSignatures(provider, {
				safeAddress: transaction.safeAddress,
				dataHash: calculateSafeTransactionHash(transaction),
				data: transaction.data,
				signatures: [signature1],
				requiredSignatures: 2n
			});

			expect(isValid).toBe(false);
		});

		it("should handle empty signatures array", async () => {
			const isValid = await verifySafeSignatures(provider, {
				safeAddress,
				dataHash: "0x1234567890123456789012345678901234567890123456789012345678901234",
				data: "0x",
				signatures: [],
				requiredSignatures: 0n
			});

			expect(isValid).toBe(true);
		});
	});

	describe("verifySafeSignaturesOffchain", () => {
		it("should verify valid ECDSA signatures off-chain", async () => {
			// Get current Safe state
			const [owners, threshold] = await Promise.all([
				getOwners(provider, safeAddress),
				getThreshold(provider, safeAddress)
			]);

			const transaction = await buildSafeTransaction(provider, safeAddress, [{
				to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
				value: 1000000000000000000n,
				data: "0x"
			}]);

			const signature1 = await signSafeTransaction(provider, transaction, owner1);
			const signature2 = await signSafeTransaction(provider, transaction, owner2);

			const result = await verifySafeSignaturesOffchain(provider, {
				safeAddress: transaction.safeAddress,
				chainId: transaction.chainId,
				dataHash: calculateSafeTransactionHash(transaction),
				data: transaction.data,
				signatures: [signature1, signature2],
				owners,
				threshold
			});

			expect(result.isValid).toBe(true);
			expect(result.validSignatures).toBe(2);
			expect(result.details).toHaveLength(2);
			
			// Check first signature details
			expect(result.details[0]?.isValid).toBe(true);
			expect(result.details[0]?.type).toBe("ecdsa");
			expect(result.details[0]?.error).toBeUndefined();
		});

		it("should detect non-owner signers", async () => {
			const owners = [owner1]; // Only owner1 is a Safe owner
			const nonOwner = "0x1234567890123456789012345678901234567890";

			const transaction = await buildSafeTransaction(provider, safeAddress, [{
				to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
				value: 1000000000000000000n,
				data: "0x"
			}]);

			// Create a fake signature from non-owner
			const fakeSignature: SafeSignature = {
				signer: nonOwner,
				data: `0x${"a".repeat(64)}1b`
			};

			const result = await verifySafeSignaturesOffchain(provider, {
				safeAddress: transaction.safeAddress,
				chainId: transaction.chainId,
				dataHash: calculateSafeTransactionHash(transaction),
				data: transaction.data,
				signatures: [fakeSignature],
				owners,
				threshold: 1n
			});

			expect(result.isValid).toBe(false);
			expect(result.validSignatures).toBe(0);
			expect(result.details[0]?.isValid).toBe(false);
			expect(result.details[0]?.error).toBe("Signer is not a Safe owner");
		});

		it("should handle threshold validation", async () => {
			const owners = [owner1, owner2];
			const transaction = await buildSafeTransaction(provider, safeAddress, [{
				to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
				value: 1000000000000000000n,
				data: "0x"
			}]);

			const signature1 = await signSafeTransaction(provider, transaction, owner1);

			// Test with threshold = 2 but only 1 valid signature
			const result = await verifySafeSignaturesOffchain(provider, {
				safeAddress: transaction.safeAddress,
				chainId: transaction.chainId,
				dataHash: calculateSafeTransactionHash(transaction),
				data: transaction.data,
				signatures: [signature1],
				owners,
				threshold: 2n
			});

			expect(result.isValid).toBe(false);
			expect(result.validSignatures).toBe(1);
		});

		it("should handle malformed ECDSA signatures", async () => {
			const owners = [owner1];
			const transaction = await buildSafeTransaction(provider, safeAddress, [{
				to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
				value: 1000000000000000000n,
				data: "0x"
			}]);

			// Create an invalid signature
			const invalidSignature: SafeSignature = {
				signer: owner1,
				data: "0x1234" // Too short to be valid ECDSA
			};

			const result = await verifySafeSignaturesOffchain(provider, {
				safeAddress: transaction.safeAddress,
				chainId: transaction.chainId,
				dataHash: calculateSafeTransactionHash(transaction),
				data: transaction.data,
				signatures: [invalidSignature],
				owners,
				threshold: 1n
			});

			expect(result.isValid).toBe(false);
			expect(result.validSignatures).toBe(0);
			expect(result.details[0]?.isValid).toBe(false);
			expect(result.details[0]?.error).toContain("error");
		});
	});
});
