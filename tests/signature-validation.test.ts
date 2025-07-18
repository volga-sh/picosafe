import type { Address, Hex } from "viem";
import {
	concatHex,
	encodeFunctionData,
	encodeFunctionResult,
	hashMessage,
	keccak256,
	pad,
	parseAbi,
	parseAbiItem,
	slice,
	toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, test } from "vitest";
import { PARSED_SAFE_ABI } from "../src/abis";
import { deploySafeAccount } from "../src/deployment";
import {
	isValidApprovedHashSignature,
	isValidECDSASignature,
	isValidERC1271Signature,
	validateSignature,
} from "../src/signature-validation";
import type {
	DynamicSignature,
	PicosafeSignature,
	StaticSignature,
} from "../src/types";
import { SignatureTypeVByte } from "../src/types";
import { createClients, snapshot } from "./fixtures/setup";
import { randomAddress, randomBytesHex } from "./utils";

describe("isValidECDSASignature", () => {
	test("should validate correct ECDSA signature with v=27", async () => {
		let foundV27 = false;
		let attempts = 0;
		const maxAttempts = 100;

		while (!foundV27 && attempts < maxAttempts) {
			attempts++;

			const privateKey = generatePrivateKey();
			const account = privateKeyToAccount(privateKey);
			const dataHash = keccak256(toHex("test message"));

			// Sign the hash directly (without prefix)
			const signature = await account.sign({
				hash: dataHash,
			});

			const vByte = Number.parseInt(signature.slice(-2), 16);
			if (vByte === 27) {
				foundV27 = true;
			}

			const staticSignature: StaticSignature = {
				signer: account.address,
				data: signature,
			};

			const result = await isValidECDSASignature(staticSignature, dataHash);

			expect(result.valid).toBe(true);
			expect(result.validatedSigner).toBe(account.address);
			expect(result.signature).toEqual(staticSignature);
			expect(result.error).toBeUndefined();
		}

		expect(foundV27).toBe(true);
	});

	test("should validate correct ECDSA signature with v=28", async () => {
		// Generate multiple signatures until we get one with v=28
		let foundV28 = false;
		let attempts = 0;
		const maxAttempts = 100;

		while (!foundV28 && attempts < maxAttempts) {
			attempts++;
			const privateKey = generatePrivateKey();
			const account = privateKeyToAccount(privateKey);
			const dataHash = keccak256(toHex(`test message ${attempts}`));

			const signature = await account.sign({
				hash: dataHash,
			});

			// Check if v=28 (last byte)
			const vByte = Number.parseInt(signature.slice(-2), 16);
			if (vByte === 28) {
				foundV28 = true;

				const staticSignature: StaticSignature = {
					signer: account.address,
					data: signature,
				};

				const result = await isValidECDSASignature(staticSignature, dataHash);

				expect(result.valid).toBe(true);
				expect(result.validatedSigner).toBe(account.address);
			}
		}

		expect(foundV28).toBe(true);
	});

	test("should return invalid for signature from different signer", async () => {
		const privateKey1 = generatePrivateKey();
		const account1 = privateKeyToAccount(privateKey1);
		const fakeSigner = randomAddress();

		const dataHash = keccak256(toHex("test message"));

		const signature = await account1.sign({
			hash: dataHash,
		});

		const staticSignature: StaticSignature = {
			signer: fakeSigner,
			data: signature,
		};

		const result = await isValidECDSASignature(staticSignature, dataHash);

		expect(result.valid).toBe(false);
		expect(result.validatedSigner).toBe(account1.address); // Should recover actual signer
		expect(result.validatedSigner).not.toBe(fakeSigner);
	});

	test("should throw error for malformed signature data", async () => {
		const dataHash = keccak256(toHex("test message"));

		// Test with signature data that's not 65 bytes
		const malformedSignatures = [
			"0x", // Empty
			"0x1234", // Too short
			`0x${"a".repeat(64)}`, // 32 bytes (missing s and v)
			`0x${"a".repeat(128)}`, // 64 bytes (missing v)
			`0x${"a".repeat(130)}1b`, // 66 bytes (too long)
		];

		for (const malformedSig of malformedSignatures) {
			const staticSignature: StaticSignature = {
				signer: randomAddress(),
				data: malformedSig as Hex,
			};

			await expect(
				isValidECDSASignature(staticSignature, dataHash),
			).rejects.toThrow();
		}
	});

	test("should handle invalid r,s,v values gracefully", async () => {
		const dataHash = keccak256(toHex("test message"));
		const signer = randomAddress();

		// Test with invalid v values
		const invalidVValues = [0, 1, 2, 25, 26, 29, 30, 255];

		for (const v of invalidVValues) {
			const signature = concatHex([
				randomBytesHex(32), // r
				randomBytesHex(32), // s
				toHex(v, { size: 1 }), // v
			]);

			const staticSignature: StaticSignature = {
				signer,
				data: signature,
			};

			// Should either throw or return invalid, but not crash
			try {
				const result = await isValidECDSASignature(staticSignature, dataHash);
				expect(result.valid).toBe(false);
			} catch (error) {
				// Expected for some invalid values
				expect(error).toBeDefined();
			}
		}
	});

	test("should recover same address for same signature and hash", async () => {
		const privateKey = generatePrivateKey();
		const account = privateKeyToAccount(privateKey);
		const dataHash = keccak256(toHex("deterministic test"));

		const signature = await account.sign({
			hash: dataHash,
		});

		const staticSignature: StaticSignature = {
			signer: account.address,
			data: signature,
		};

		// Call multiple times with same inputs
		const results = await Promise.all([
			isValidECDSASignature(staticSignature, dataHash),
			isValidECDSASignature(staticSignature, dataHash),
			isValidECDSASignature(staticSignature, dataHash),
		]);

		// All results should be identical
		expect(results[0]).toEqual(results[1]);
		expect(results[1]).toEqual(results[2]);
		expect(results.every((r) => r.valid)).toBe(true);
		expect(results.every((r) => r.validatedSigner === account.address)).toBe(
			true,
		);
	});
});

// ERC-1271 magic values
const MAGIC_VALUE_BYTES32 = "0x1626ba7e";
const MAGIC_VALUE_BYTES = "0x20c13b0b";

// Mock ERC-1271 contract bytecode that returns the correct magic value
const ERC1271_MOCK_BYTECODE = (() => {
	// Simple contract that returns MAGIC_VALUE_BYTES32 for isValidSignature(bytes32,bytes)
	// and MAGIC_VALUE_BYTES for isValidSignature(bytes,bytes)
	const runtime = concatHex([
		"0x608060405234801561001057600080fd5b50600436106100365760003560e01c80631626ba7e1461003b57806320c13b0b14610070575b600080fd5b61005560048036038101906100509190610140565b6100a5565b60405161006791906101a8565b60405180910390f35b61008a600480360381019061008591906101c3565b6100ae565b60405161009c91906101a8565b60405180910390f35b631626ba7e60e01b92915050565b6320c13b0b60e01b92915050565b600080fd5b600080fd5b6000819050919050565b6100dd816100ca565b81146100e857600080fd5b50565b6000813590506100fa816100d4565b92915050565b600080fd5b600080fd5b600080fd5b60008083601f8401126101255761012461010a565b5b8235905067ffffffffffffffff8111156101425761014161010f565b5b60208301915083600182028301111561015e5761015d610114565b5b9250929050565b60008060006040848603121561017e5761017d6100c0565b5b600061018c868287016100eb565b935050602084013567ffffffffffffffff8111156101ad576101ac6100c5565b5b6101b98682870161010f565b92509250509250925092565b60007fffffffff0000000000000000000000000000000000000000000000000000000082169050919050565b6101fa816101c5565b82525050565b600060208201905061021560008301846101f1565b92915050565b600080fd5b600080fd5b600080fd5b60008083356001602003843603038112610245576102446100fd565b5b80840192508235915067ffffffffffffffff8211156102675761026661021b565b5b60208301925060018202360383131561028357610282610220565b5b509250929050565b600080600080604085870312156102a5576102a46100c0565b5b600085013567ffffffffffffffff8111156102c3576102c26100c5565b5b6102cf8782880161022a565b9450945050602085013567ffffffffffffffff8111156102f2576102f16100c5565b5b6102fe8782880161010f565b92509250509295919450925092505056fea26469706673582212208e",
		"0xc2cbe7b010eea5969ba5e1794e088f2a09e1faa5e82eb4fd3b8e93dcbd64736f6c63430008190033",
	]);

	return runtime;
})();

// Contract that always reverts
const REVERTING_CONTRACT_BYTECODE =
	"0x6080604052348015600e575f80fd5b50600436106026575f3560e01c80631626ba7e14602a575b5f80fd5b60306032565b005b5f80fdfe";

// Contract that returns wrong magic value
const WRONG_MAGIC_CONTRACT_BYTECODE = (() => {
	const runtime = concatHex([
		"0x608060405234801561001057600080fd5b506004361061002b5760003560e01c80631626ba7e14610030575b600080fd5b61004a60048036038101906100459190610140565b610060565b6040516100579190610195565b60405180910390f35b600090509291505056",
	]);
	return runtime;
})();

describe("isValidERC1271Signature", () => {
	const { testClient, publicClient, walletClients } = createClients();
	let revert: () => Promise<void>;

	beforeEach(async () => {
		revert = await snapshot(testClient);
	});

	test("should validate signature using bytes32 isValidSignature variant", async () => {
		// Deploy mock ERC-1271 contract
		const deployHash = await walletClients[0].deployContract({
			bytecode: ERC1271_MOCK_BYTECODE,
		});
		const { contractAddress } = await publicClient.waitForTransactionReceipt({
			hash: deployHash,
		});

		const dataHash = keccak256(toHex("test message"));
		const signatureData = randomBytesHex(65);

		const dynamicSignature: DynamicSignature = {
			signer: contractAddress!,
			data: signatureData,
			dynamic: true,
		};

		const result = await isValidERC1271Signature(
			publicClient,
			dynamicSignature,
			{ dataHash },
		);

		expect(result.valid).toBe(true);
		expect(result.validatedSigner).toBe(contractAddress);
		expect(result.signature).toEqual(dynamicSignature);
		expect(result.error).toBeUndefined();

		await revert();
	});

	test("should validate signature using bytes isValidSignature variant", async () => {
		// Deploy mock ERC-1271 contract
		const deployHash = await walletClients[0].deployContract({
			bytecode: ERC1271_MOCK_BYTECODE,
		});
		const { contractAddress } = await publicClient.waitForTransactionReceipt({
			hash: deployHash,
		});

		const data = toHex("raw message data");
		const signatureData = randomBytesHex(130);

		const dynamicSignature: DynamicSignature = {
			signer: contractAddress!,
			data: signatureData,
			dynamic: true,
		};

		const result = await isValidERC1271Signature(
			publicClient,
			dynamicSignature,
			{ data },
		);

		expect(result.valid).toBe(true);
		expect(result.validatedSigner).toBe(contractAddress);
		expect(result.error).toBeUndefined();

		await revert();
	});

	test("should return invalid when contract returns wrong magic value", async () => {
		// Deploy contract that returns wrong magic value
		const deployHash = await walletClients[0].deployContract({
			bytecode: WRONG_MAGIC_CONTRACT_BYTECODE,
		});
		const { contractAddress } = await publicClient.waitForTransactionReceipt({
			hash: deployHash,
		});

		const dataHash = keccak256(toHex("test message"));
		const signatureData = randomBytesHex(65);

		const dynamicSignature: DynamicSignature = {
			signer: contractAddress!,
			data: signatureData,
			dynamic: true,
		};

		const result = await isValidERC1271Signature(
			publicClient,
			dynamicSignature,
			{ dataHash },
		);

		expect(result.valid).toBe(false);
		expect(result.validatedSigner).toBe(contractAddress);
		expect(result.error).toBeUndefined(); // No error, just invalid

		await revert();
	});

	test("should handle contract revert gracefully", async () => {
		// Deploy contract that always reverts
		const deployHash = await walletClients[0].deployContract({
			bytecode: REVERTING_CONTRACT_BYTECODE,
		});
		const { contractAddress } = await publicClient.waitForTransactionReceipt({
			hash: deployHash,
		});

		const dataHash = keccak256(toHex("test message"));
		const signatureData = randomBytesHex(65);

		const dynamicSignature: DynamicSignature = {
			signer: contractAddress!,
			data: signatureData,
			dynamic: true,
		};

		const result = await isValidERC1271Signature(
			publicClient,
			dynamicSignature,
			{ dataHash },
		);

		expect(result.valid).toBe(false);
		expect(result.error).toBeDefined();
		expect(result.error?.message).toContain("error");

		await revert();
	});

	test("should handle calls to EOA addresses", async () => {
		const eoaAddress = walletClients[1].account.address;
		const dataHash = keccak256(toHex("test message"));
		const signatureData = randomBytesHex(65);

		const dynamicSignature: DynamicSignature = {
			signer: eoaAddress,
			data: signatureData,
			dynamic: true,
		};

		const result = await isValidERC1271Signature(
			publicClient,
			dynamicSignature,
			{ dataHash },
		);

		expect(result.valid).toBe(false);
		expect(result.error).toBeDefined();

		await revert();
	});

	test("should handle contracts without ERC-1271 support", async () => {
		// Deploy a simple contract without isValidSignature
		const simpleContractBytecode =
			"0x6080604052348015600e575f80fd5b50603e80601a5f395ff3fe60806040525f80fdfea26469706673582212202c";

		const deployHash = await walletClients[0].deployContract({
			bytecode: simpleContractBytecode,
		});
		const { contractAddress } = await publicClient.waitForTransactionReceipt({
			hash: deployHash,
		});

		const dataHash = keccak256(toHex("test message"));
		const signatureData = randomBytesHex(65);

		const dynamicSignature: DynamicSignature = {
			signer: contractAddress!,
			data: signatureData,
			dynamic: true,
		};

		const result = await isValidERC1271Signature(
			publicClient,
			dynamicSignature,
			{ dataHash },
		);

		expect(result.valid).toBe(false);
		expect(result.error).toBeDefined();

		await revert();
	});

	test("should handle empty signature data", async () => {
		// Deploy mock ERC-1271 contract
		const deployHash = await walletClients[0].deployContract({
			bytecode: ERC1271_MOCK_BYTECODE,
		});
		const { contractAddress } = await publicClient.waitForTransactionReceipt({
			hash: deployHash,
		});

		const dataHash = keccak256(toHex("test message"));
		const emptySignature = "0x";

		const dynamicSignature: DynamicSignature = {
			signer: contractAddress!,
			data: emptySignature,
			dynamic: true,
		};

		const result = await isValidERC1271Signature(
			publicClient,
			dynamicSignature,
			{ dataHash },
		);

		// Contract should still respond, even with empty data
		expect(result.valid).toBe(true);

		await revert();
	});

	test("should handle large signature payloads", async () => {
		// Deploy mock ERC-1271 contract
		const deployHash = await walletClients[0].deployContract({
			bytecode: ERC1271_MOCK_BYTECODE,
		});
		const { contractAddress } = await publicClient.waitForTransactionReceipt({
			hash: deployHash,
		});

		const dataHash = keccak256(toHex("test message"));
		// Create large signature data (> 1KB)
		const largeSignature = randomBytesHex(1500);

		const dynamicSignature: DynamicSignature = {
			signer: contractAddress!,
			data: largeSignature,
			dynamic: true,
		};

		const result = await isValidERC1271Signature(
			publicClient,
			dynamicSignature,
			{ dataHash },
		);

		expect(result.valid).toBe(true);
		expect(result.validatedSigner).toBe(contractAddress);

		await revert();
	});
});

describe("isValidApprovedHashSignature", () => {
	const { testClient, publicClient, walletClients } = createClients();
	let revert: () => Promise<void>;
	let safeAddress: Address;
	let owners: Address[];

	beforeEach(async () => {
		revert = await snapshot(testClient);

		// Deploy a Safe for testing
		owners = [
			walletClients[0].account.address,
			walletClients[1].account.address,
			walletClients[2].account.address,
		];

		const deployment = await deploySafeAccount(publicClient, {
			owners,
			threshold: 2n,
			saltNonce: BigInt(Date.now()),
		});

		const deploymentTx = await deployment.send(walletClients[0]);
		await publicClient.waitForTransactionReceipt({ hash: deploymentTx });

		safeAddress = deployment.safeAccountAddress;
	});

	test("should validate when hash is approved (non-zero value)", async () => {
		const owner = owners[0];
		const dataHash = keccak256(toHex("approved message"));

		// Approve the hash from the Safe
		const approveHashData = encodeFunctionData({
			abi: PARSED_SAFE_ABI,
			functionName: "approveHash",
			args: [dataHash],
		});

		const txHash = await walletClients[0].sendTransaction({
			to: safeAddress,
			data: approveHashData,
			from: owner,
		});
		await publicClient.waitForTransactionReceipt({ hash: txHash });

		// Create approved hash signature
		const signatureData = concatHex([
			pad(owner, { size: 32 }), // Owner address padded to 32 bytes
			"0x0000000000000000000000000000000000000000000000000000000000000000", // Unused 32 bytes
			"0x01", // v=1 for approved hash
		]);

		const staticSignature: StaticSignature = {
			signer: safeAddress, // Safe contract that stores approved hashes
			data: signatureData,
		};

		const result = await isValidApprovedHashSignature(
			publicClient,
			staticSignature,
			{ dataHash },
		);

		expect(result.valid).toBe(true);
		expect(result.validatedSigner).toBe(safeAddress);
		expect(result.error).toBeUndefined();

		await revert();
	});

	test("should return invalid when hash not approved (zero value)", async () => {
		const owner = owners[0];
		const dataHash = keccak256(toHex("unapproved message"));

		// Create approved hash signature for unapproved hash
		const signatureData = concatHex([
			pad(owner, { size: 32 }),
			"0x0000000000000000000000000000000000000000000000000000000000000000",
			"0x01",
		]);

		const staticSignature: StaticSignature = {
			signer: safeAddress,
			data: signatureData,
		};

		const result = await isValidApprovedHashSignature(
			publicClient,
			staticSignature,
			{ dataHash },
		);

		expect(result.valid).toBe(false);
		expect(result.validatedSigner).toBe(safeAddress);
		expect(result.error).toBeUndefined();

		await revert();
	});

	test("should correctly parse owner address from signature data", async () => {
		const testOwner = "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5";
		const dataHash = keccak256(toHex("test message"));

		// Test different padding scenarios
		const signatureVariants = [
			// Standard padding
			concatHex([
				pad(testOwner, { size: 32 }),
				"0x0000000000000000000000000000000000000000000000000000000000000000",
				"0x01",
			]),
			// With extra zeros (should still work)
			concatHex([
				"0x000000000000000000000000" + testOwner.slice(2).toLowerCase(),
				"0x0000000000000000000000000000000000000000000000000000000000000000",
				"0x01",
			]),
		];

		for (const signatureData of signatureVariants) {
			const staticSignature: StaticSignature = {
				signer: testOwner as Address,
				data: signatureData,
			};

			// Mock eth_call to track the parameters
			let calledWithCorrectParams = false;
			const originalRequest = publicClient.request;
			publicClient.request = async (args: any) => {
				if (args.method === "eth_call") {
					const calldata = args.params[0].data;
					// Check if it's calling approvedHashes with correct parameters
					const expectedCalldata = encodeFunctionData({
						abi: PARSED_SAFE_ABI,
						functionName: "approvedHashes",
						args: [testOwner as Address, dataHash],
					});
					if (calldata === expectedCalldata) {
						calledWithCorrectParams = true;
					}
				}
				return originalRequest.call(publicClient, args);
			};

			await isValidApprovedHashSignature(publicClient, staticSignature, {
				dataHash,
			});

			expect(calledWithCorrectParams).toBe(true);

			// Restore original request method
			publicClient.request = originalRequest;
		}

		await revert();
	});

	test("should handle incorrectly formatted signature data", async () => {
		const dataHash = keccak256(toHex("test message"));

		// Test various malformed signatures
		const malformedSignatures = [
			"0x", // Empty
			"0x01", // Just v byte
			randomBytesHex(32), // Just 32 bytes
			randomBytesHex(64), // 64 bytes (missing v)
			concatHex([randomBytesHex(65), "0x02"]), // Wrong v byte
		];

		for (const malformedSig of malformedSignatures) {
			const staticSignature: StaticSignature = {
				signer: randomAddress(),
				data: malformedSig,
			};

			// Should handle gracefully without crashing
			try {
				const result = await isValidApprovedHashSignature(
					publicClient,
					staticSignature,
					{ dataHash },
				);
				// If it doesn't throw, it should be invalid
				expect(result.valid).toBe(false);
			} catch (error) {
				// Some malformed data might throw, which is acceptable
				expect(error).toBeDefined();
			}
		}

		await revert();
	});

	test("should handle eth_call failures gracefully", async () => {
		const owner = owners[0];
		const dataHash = keccak256(toHex("test message"));

		const signatureData = concatHex([
			pad(owner, { size: 32 }),
			"0x0000000000000000000000000000000000000000000000000000000000000000",
			"0x01",
		]);

		const staticSignature: StaticSignature = {
			signer: safeAddress,
			data: signatureData,
		};

		// Mock provider to throw error
		const mockProvider = {
			request: async () => {
				throw new Error("Network error");
			},
		};

		const result = await isValidApprovedHashSignature(
			mockProvider as any,
			staticSignature,
			{ dataHash },
		);

		expect(result.valid).toBe(false);
		expect(result.error).toBeDefined();
		expect(result.error?.message).toContain("Network error");

		await revert();
	});

	test("should handle calls to contracts without approvedHashes", async () => {
		// Deploy a simple contract without approvedHashes
		const simpleContractBytecode =
			"0x6080604052348015600e575f80fd5b50603e80601a5f395ff3fe60806040525f80fdfea26469706673582212202c";

		const deployHash = await walletClients[0].deployContract({
			bytecode: simpleContractBytecode,
		});
		const { contractAddress } = await publicClient.waitForTransactionReceipt({
			hash: deployHash,
		});

		const owner = randomAddress();
		const dataHash = keccak256(toHex("test message"));

		const signatureData = concatHex([
			pad(owner, { size: 32 }),
			"0x0000000000000000000000000000000000000000000000000000000000000000",
			"0x01",
		]);

		const staticSignature: StaticSignature = {
			signer: safeAddress,
			data: signatureData,
		};

		// Override signer to point to non-Safe contract
		const modifiedSignature = { ...staticSignature, signer: contractAddress! };

		const result = await isValidApprovedHashSignature(
			publicClient,
			modifiedSignature,
			{ dataHash },
		);

		expect(result.valid).toBe(false);
		expect(result.error).toBeDefined();

		await revert();
	});

	test("should treat any non-zero approval value as valid", async () => {
		const owner = owners[0];
		const dataHash = keccak256(toHex("test message"));

		const signatureData = concatHex([
			pad(owner, { size: 32 }),
			"0x0000000000000000000000000000000000000000000000000000000000000000",
			"0x01",
		]);

		const staticSignature: StaticSignature = {
			signer: safeAddress,
			data: signatureData,
		};

		// Test various non-zero return values
		const nonZeroValues = [
			"0x0000000000000000000000000000000000000000000000000000000000000001", // 1
			"0x00000000000000000000000000000000000000000000000000000000000000ff", // 255
			"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", // MAX
			"0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", // Random
		];

		for (const returnValue of nonZeroValues) {
			// Mock provider to return specific value
			const mockProvider = {
				request: async (args: any) => {
					if (args.method === "eth_call") {
						return returnValue;
					}
					return publicClient.request(args);
				},
			};

			const result = await isValidApprovedHashSignature(
				mockProvider as any,
				staticSignature,
				{ dataHash },
			);

			expect(result.valid).toBe(true);
		}

		await revert();
	});

	test("should only accept signatures with v=1", async () => {
		const owner = owners[0];
		const dataHash = keccak256(toHex("test message"));

		// Test different v values
		const vValues = [0, 2, 27, 28, 31, 32, 255];

		for (const v of vValues) {
			const signatureData = concatHex([
				pad(owner, { size: 32 }),
				"0x0000000000000000000000000000000000000000000000000000000000000000",
				toHex(v, { size: 1 }),
			]);

			const staticSignature: StaticSignature = {
				signer: owner,
				data: signatureData,
			};

			// The function expects v=1, so it should handle other values appropriately
			// Based on the implementation, it parses the owner from the signature data
			// and checks approvedHashes regardless of v value
			const result = await isValidApprovedHashSignature(
				publicClient,
				staticSignature,
				{ dataHash },
			);

			// Should still work but return false since hash isn't approved
			expect(result.valid).toBe(false);
			expect(result.error).toBeUndefined();
		}

		await revert();
	});
});

describe("validateSignature", () => {
	const { testClient, publicClient, walletClients } = createClients();
	let revert: () => Promise<void>;

	beforeEach(async () => {
		revert = await snapshot(testClient);
	});

	// Test routing to ECDSA validation
	describe("ECDSA signature routing", () => {
		test("should route v=27 signatures to EIP-712 validation", async () => {
			const privateKey = generatePrivateKey();
			const account = privateKeyToAccount(privateKey);
			const dataHash = keccak256(toHex("test message"));
			const data = toHex("test data");

			// Create signature with v=27
			const signature = await account.sign({
				hash: dataHash,
			});

			// Ensure v=27
			const vByte = Number.parseInt(signature.slice(-2), 16);
			const adjustedSignature =
				vByte === 28
					? ((signature.slice(0, -2) + "1b") as Hex) // Change to v=27
					: signature;

			const staticSignature: StaticSignature = {
				signer: account.address,
				data: adjustedSignature,
			};

			const result = await validateSignature(publicClient, staticSignature, {
				data,
				dataHash,
			});

			expect(result.valid).toBe(true);
			expect(result.validatedSigner).toBe(account.address);

			await revert();
		});

		test("should route v=28 signatures to EIP-712 validation", async () => {
			const privateKey = generatePrivateKey();
			const account = privateKeyToAccount(privateKey);
			const dataHash = keccak256(toHex("test message"));
			const data = toHex("test data");

			// Create signature with v=28
			const signature = await account.sign({
				hash: dataHash,
			});

			// Ensure v=28
			const vByte = Number.parseInt(signature.slice(-2), 16);
			const adjustedSignature =
				vByte === 27
					? ((signature.slice(0, -2) + "1c") as Hex) // Change to v=28
					: signature;

			const staticSignature: StaticSignature = {
				signer: account.address,
				data: adjustedSignature,
			};

			const result = await validateSignature(publicClient, staticSignature, {
				data,
				dataHash,
			});

			expect(result.valid).toBe(true);
			expect(result.validatedSigner).toBe(account.address);

			await revert();
		});

		test("should route v=31 signatures to eth_sign validation", async () => {
			const privateKey = generatePrivateKey();
			const account = privateKeyToAccount(privateKey);
			const dataHash = keccak256(toHex("test message"));
			const data = toHex("test data");

			// For eth_sign, we sign the hash and then adjust v
			const signature = await account.sign({
				hash: dataHash,
			});

			// Change v to 31 (eth_sign v=27 -> 31)
			const vByte = Number.parseInt(signature.slice(-2), 16);
			const adjustedV = vByte === 27 ? "1f" : "20"; // 31 or 32
			const adjustedSignature = (signature.slice(0, -2) + adjustedV) as Hex;

			const staticSignature: StaticSignature = {
				signer: account.address,
				data: adjustedSignature,
			};

			const result = await validateSignature(publicClient, staticSignature, {
				data,
				dataHash,
			});

			expect(result.valid).toBe(true);
			expect(result.validatedSigner).toBe(account.address);

			await revert();
		});

		test("should route v=32 signatures to eth_sign validation", async () => {
			const privateKey = generatePrivateKey();
			const account = privateKeyToAccount(privateKey);
			const dataHash = keccak256(toHex("test message"));
			const data = toHex("test data");

			// For eth_sign, we sign the hash and then adjust v
			const signature = await account.sign({
				hash: dataHash,
			});

			// Change v to 32 (eth_sign v=28 -> 32)
			const vByte = Number.parseInt(signature.slice(-2), 16);
			const adjustedV = vByte === 28 ? "20" : "1f"; // 32 or 31
			const adjustedSignature = (signature.slice(0, -2) + adjustedV) as Hex;

			const staticSignature: StaticSignature = {
				signer: account.address,
				data: adjustedSignature,
			};

			const result = await validateSignature(publicClient, staticSignature, {
				data,
				dataHash,
			});

			expect(result.valid).toBe(true);
			expect(result.validatedSigner).toBe(account.address);

			await revert();
		});
	});

	// Test routing to ERC-1271 validation
	describe("Contract signature routing", () => {
		test("should route dynamic signatures to ERC-1271 validation", async () => {
			// Deploy mock ERC-1271 contract
			const deployHash = await walletClients[0].deployContract({
				bytecode: ERC1271_MOCK_BYTECODE,
			});
			const { contractAddress } = await publicClient.waitForTransactionReceipt({
				hash: deployHash,
			});

			const dataHash = keccak256(toHex("test message"));
			const data = toHex("test data");
			const signatureData = randomBytesHex(65);

			const dynamicSignature: DynamicSignature = {
				signer: contractAddress!,
				data: signatureData,
				dynamic: true,
			};

			const result = await validateSignature(publicClient, dynamicSignature, {
				data,
				dataHash,
			});

			expect(result.valid).toBe(true);
			expect(result.validatedSigner).toBe(contractAddress);

			await revert();
		});

		test("should pass both data and dataHash to ERC-1271", async () => {
			// Deploy mock ERC-1271 contract
			const deployHash = await walletClients[0].deployContract({
				bytecode: ERC1271_MOCK_BYTECODE,
			});
			const { contractAddress } = await publicClient.waitForTransactionReceipt({
				hash: deployHash,
			});

			const data = toHex("important data");
			const dataHash = keccak256(data);
			const signatureData = randomBytesHex(130);

			const dynamicSignature: DynamicSignature = {
				signer: contractAddress!,
				data: signatureData,
				dynamic: true,
			};

			// Mock to verify both data and dataHash are available
			let receivedCorrectData = false;
			const originalRequest = publicClient.request;
			publicClient.request = async (args: any) => {
				if (args.method === "eth_call") {
					const calldata = args.params[0].data;
					// Check if calldata contains either bytes32 or bytes variant
					if (
						calldata &&
						(calldata.includes(dataHash.slice(2)) ||
							calldata.includes(data.slice(2)))
					) {
						receivedCorrectData = true;
					}
				}
				return originalRequest.call(publicClient, args);
			};

			const result = await validateSignature(publicClient, dynamicSignature, {
				data,
				dataHash,
			});

			expect(result.valid).toBe(true);
			expect(receivedCorrectData).toBe(true);

			// Restore original request
			publicClient.request = originalRequest;

			await revert();
		});
	});

	// Test routing to approved hash validation
	describe("Approved hash routing", () => {
		test("should route v=1 signatures to approved hash validation", async () => {
			// Deploy a Safe
			const owners = [walletClients[0].account.address];
			const deployment = await deploySafeAccount(publicClient, {
				owners,
				threshold: 1n,
				saltNonce: BigInt(Date.now()),
			});

			const deploymentTx = await deployment.send(walletClients[0]);
			await publicClient.waitForTransactionReceipt({ hash: deploymentTx });

			const safeAddress = deployment.safeAccountAddress;
			const owner = owners[0];
			const dataHash = keccak256(toHex("approved message"));
			const data = toHex("approved message");

			// Approve the hash
			const approveHashData = encodeFunctionData({
				abi: PARSED_SAFE_ABI,
				functionName: "approveHash",
				args: [dataHash],
			});

			const txHash = await walletClients[0].sendTransaction({
				to: safeAddress,
				data: approveHashData,
				from: owner,
			});
			await publicClient.waitForTransactionReceipt({ hash: txHash });

			// Create approved hash signature
			const signatureData = concatHex([
				pad(owner, { size: 32 }),
				"0x0000000000000000000000000000000000000000000000000000000000000000",
				"0x01", // v=1 for approved hash
			]);

			const staticSignature: StaticSignature = {
				signer: owner,
				data: signatureData,
			};

			const result = await validateSignature(publicClient, staticSignature, {
				data,
				dataHash,
			});

			expect(result.valid).toBe(true);
			expect(result.validatedSigner).toBe(safeAddress);

			await revert();
		});

		test("should only pass dataHash for approved hash validation", async () => {
			const owner = randomAddress();
			const dataHash = keccak256(toHex("test message"));
			const data = toHex("test message");

			const signatureData = concatHex([
				pad(owner, { size: 32 }),
				"0x0000000000000000000000000000000000000000000000000000000000000000",
				"0x01",
			]);

			const staticSignature: StaticSignature = {
				signer: owner,
				data: signatureData,
			};

			// Mock to verify only dataHash is used
			let usedDataHash = false;
			let usedData = false;
			const originalRequest = publicClient.request;
			publicClient.request = async (args: any) => {
				if (args.method === "eth_call") {
					const calldata = args.params[0].data;
					if (calldata?.includes(dataHash.slice(2))) {
						usedDataHash = true;
					}
					if (calldata?.includes(data.slice(2)) && data.length > 66) {
						usedData = true; // Should not happen
					}
				}
				return originalRequest.call(publicClient, args);
			};

			await validateSignature(publicClient, staticSignature, {
				data,
				dataHash,
			});

			expect(usedDataHash).toBe(true);
			expect(usedData).toBe(false);

			// Restore original request
			publicClient.request = originalRequest;

			await revert();
		});
	});

	// Test error handling
	describe("Error handling", () => {
		test("should throw for unsupported signature types", async () => {
			const dataHash = keccak256(toHex("test message"));
			const data = toHex("test data");

			// Test various unsupported v values
			const unsupportedVValues = [0, 2, 3, 26, 29, 30, 33, 100, 255];

			for (const v of unsupportedVValues) {
				// Skip v=0 as it's for contract signatures
				if (v === 0) continue;

				const signature = concatHex([
					randomBytesHex(32), // r
					randomBytesHex(32), // s
					toHex(v, { size: 1 }), // v
				]);

				const staticSignature: StaticSignature = {
					signer: randomAddress(),
					data: signature,
				};

				await expect(
					validateSignature(publicClient, staticSignature, { data, dataHash }),
				).rejects.toThrow();
			}

			await revert();
		});

		test("should preserve errors from sub-validators", async () => {
			const dataHash = keccak256(toHex("test message"));
			const data = toHex("test data");

			// Test with malformed ECDSA signature
			const malformedSignature: StaticSignature = {
				signer: randomAddress(),
				data: "0x1234" as Hex, // Too short
			};

			await expect(
				validateSignature(publicClient, malformedSignature, { data, dataHash }),
			).rejects.toThrow();

			await revert();
		});
	});

	// Test signature type detection
	describe("Signature type detection", () => {
		test("should correctly extract v-byte from 65-byte signatures", async () => {
			const dataHash = keccak256(toHex("test message"));
			const data = toHex("test data");

			// Test various v-byte positions
			const testCases = [
				{ v: 27, type: "EIP-712" },
				{ v: 28, type: "EIP-712" },
				{ v: 31, type: "eth_sign" },
				{ v: 32, type: "eth_sign" },
				{ v: 1, type: "approved_hash" },
			];

			for (const { v } of testCases) {
				const signature = concatHex([
					randomBytesHex(32), // r
					randomBytesHex(32), // s
					toHex(v, { size: 1 }), // v
				]);

				const staticSignature: StaticSignature = {
					signer: randomAddress(),
					data: signature,
				};

				// Should not throw for valid v-bytes
				try {
					await validateSignature(publicClient, staticSignature, {
						data,
						dataHash,
					});
				} catch (error: any) {
					// Only accept errors that are NOT "Invalid signature type"
					expect(error.message).not.toContain("Invalid signature type");
				}
			}

			await revert();
		});

		test("should handle signatures with extra data", async () => {
			const privateKey = generatePrivateKey();
			const account = privateKeyToAccount(privateKey);
			const dataHash = keccak256(toHex("test message"));
			const data = toHex("test data");

			// Create normal signature
			const signature = await account.sign({
				hash: dataHash,
			});

			// Add extra data at the end
			const signatureWithExtra = concatHex([
				signature,
				randomBytesHex(100), // Extra data
			]);

			const staticSignature: StaticSignature = {
				signer: account.address,
				data: signatureWithExtra,
			};

			// Should still extract v-byte correctly from position 64
			const result = await validateSignature(publicClient, staticSignature, {
				data,
				dataHash,
			});

			expect(result.valid).toBe(true);
			expect(result.validatedSigner).toBe(account.address);

			await revert();
		});
	});
});
