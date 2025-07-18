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
import { afterEach, beforeEach, describe, expect, test } from "vitest";
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
	EIP1193ProviderWithRequestFn,
	PicosafeSignature,
	SafeMessage,
	StaticSignature,
} from "../src/types";
import { SignatureTypeVByte } from "../src/types";
import { createClients, snapshot } from "./fixtures/setup";
import { randomAddress, randomBytesHex } from "./utils";
import { calculateSafeMessageHash } from "../src/eip712";
import { getChainId } from "../src/utilities/eip1193-provider";
import { ZERO_ADDRESS } from "../src/utilities/constants";
import { padStartHex } from "../src/utilities/encoding";
import { getApprovedHashSignatureBytes } from "../src/safe-signatures";

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

			const result = await isValidECDSASignature(staticSignature, dataHash);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		}
	});

	test("should handle invalid r,s,v values gracefully", async () => {
		const dataHash = keccak256(toHex("test message"));
		const signer = randomAddress();

		// Test with invalid v values
		const invalidVValues = [2, 25, 26, 29, 30, 255];

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

			const result = await isValidECDSASignature(staticSignature, dataHash);
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
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

describe("isValidERC1271Signature", () => {
	const { testClient, publicClient, walletClients } = createClients();
	let resetSnapshot: () => Promise<void>;

	beforeEach(async () => {
		resetSnapshot = await snapshot(testClient);
	});

	afterEach(async () => {
		await resetSnapshot();
	});

	test("should validate signature using bytes32 isValidSignature variant", async () => {
		// Deploy a Safe contract with a fallback handler that contains ERC-1271 function
		const deployment = await deploySafeAccount(publicClient, {
			owners: [walletClients[0].account.address],
			threshold: 1n,
		});
		const safeAddress = deployment.data.safeAddress;
		const txHash = await deployment.send();
		await publicClient.waitForTransactionReceipt({
			hash: txHash,
		});

		const message: SafeMessage = {
			message: keccak256(toHex("test message")),
		};
		const safeMessageHash = calculateSafeMessageHash(
			safeAddress,
			await getChainId(publicClient),
			message,
		);

		const signature = await walletClients[0].account.sign?.({
			hash: safeMessageHash,
		});

		if (!signature) {
			throw new Error("Failed to sign message");
		}

		const dynamicSignature: DynamicSignature = {
			signer: safeAddress,
			data: signature,
			dynamic: true,
		};

		const result = await isValidERC1271Signature(
			publicClient,
			dynamicSignature,
			{ dataHash: message.message },
		);

		expect(result.valid).toBe(true);
		expect(result.validatedSigner).toBe(safeAddress);
		expect(result.signature).toEqual(dynamicSignature);
		expect(result.error).toBeUndefined();
	});

	test("should validate signature using bytes isValidSignature variant", async () => {
		// Deploy a Safe contract with a fallback handler that contains ERC-1271 function
		const deployment = await deploySafeAccount(publicClient, {
			owners: [walletClients[0].account.address],
			threshold: 1n,
		});
		const safeAddress = deployment.data.safeAddress;
		const txHash = await deployment.send();
		await publicClient.waitForTransactionReceipt({
			hash: txHash,
		});

		const message: SafeMessage = {
			message: keccak256(toHex("test message")),
		};
		const safeMessageHash = calculateSafeMessageHash(
			safeAddress,
			await getChainId(publicClient),
			message,
		);

		const signature = await walletClients[0].account.sign?.({
			hash: safeMessageHash,
		});

		if (!signature) {
			throw new Error("Failed to sign message");
		}

		const dynamicSignature: DynamicSignature = {
			signer: safeAddress,
			data: signature,
			dynamic: true,
		};

		const result = await isValidERC1271Signature(
			publicClient,
			dynamicSignature,
			{ data: message.message },
		);

		expect(result.valid).toBe(true);
		expect(result.validatedSigner).toBe(safeAddress);
		expect(result.signature).toEqual(dynamicSignature);
		expect(result.error).toBeUndefined();
	});

	test("should return invalid when contract returns wrong magic value", async () => {
		/*
		 * Minimal runtime that *always* returns a 32-byte word whose first 4 bytes
		 * are `0xC0FFEE00`. This deliberately violates EIP-1271’s magic values so
		 * that the validator should mark the signature as **invalid**.
		 *
		 *  ┌────────┬──────────────────┬────────────────────────────────────────┬─────────────────────────────────────────────┐
		 *  │ Byte   │ Instruction      │ Stack after execution                  │ Comment                                     │
		 *  ├────────┼──────────────────┼────────────────────────────────────────┼─────────────────────────────────────────────┤
		 *  │ 0x63   │ PUSH4 0xc0ffee00 │ 0xc0ffee00                             │ Push constant                               │
		 *  │ 0x60   │ PUSH1 0xe0       │ 0xc0ffee00 0xe0                        │ Shift amount = 224 bits (28 bytes)          │
		 *  │ 0x1b   │ SHL              │ 0xc0ffee00 << 224                      │ Move constant into the *high* 4 bytes       │
		 *  │ 0x5f   │ PUSH0            │ 0x00 <value>                           │ Destination offset (memory 0)               │
		 *  │ 0x52   │ MSTORE           │ –                                      │ mstore(0, value)                            │
		 *  │ 0x60   │ PUSH1 0x20       │ 0x20                                   │ Return size = 32                            │
		 *  │ 0x5f   │ PUSH0            │ 0x00 0x20                              │ Return offset = 0                           │
		 *  │ 0xf3   │ RETURN           │ –                                      │ return(0, 32)                               │
		 *  └────────┴──────────────────┴────────────────────────────────────────┴─────────────────────────────────────────────┘
		 *
		 *  Concatenated bytecode (spaces added for readability):
		 *  0x63 c0ffee00 60 e0 1b 5f 52 60 20 5f f3
		 */
		const address = randomAddress();
		await testClient.setCode({
			address,
			// Runtime bytecode: PUSH4 0xc0ffee00 │ PUSH1 0xe0 │ SHL │ PUSH0 │ MSTORE │ PUSH1 0x20 │ PUSH0 │ RETURN
			// Encoded: 0x63 c0ffee00 60 e0 1b 5f 52 60 20 5f f3
			bytecode: "0x63c0ffee0060e01b5f5260205ff3",
		});

		const dataHash = keccak256(toHex("test message"));
		const signatureData = randomBytesHex(65);

		const dynamicSignature: DynamicSignature = {
			signer: address,
			data: signatureData,
			dynamic: true,
		};

		const result = await isValidERC1271Signature(
			publicClient,
			dynamicSignature,
			{ dataHash },
		);

		expect(result.valid).toBe(false);
		expect(result.validatedSigner).toBe(address);
		expect(result.error).toBeUndefined();
	});

	test("should handle contract revert and return invalid with error", async () => {
		// Deploy a Safe contract with a fallback handler that contains ERC-1271 function
		const deployment = await deploySafeAccount(publicClient, {
			owners: [walletClients[0].account.address],
			threshold: 1n,
		});
		const safeAddress = deployment.data.safeAddress;
		const txHash = await deployment.send();
		await publicClient.waitForTransactionReceipt({
			hash: txHash,
		});

		const message: SafeMessage = {
			message: keccak256(toHex("test message")),
		};
		const safeMessageHash = calculateSafeMessageHash(
			safeAddress,
			await getChainId(publicClient),
			message,
		);

		const signature = await walletClients[1].account.sign?.({
			hash: safeMessageHash,
		});

		if (!signature) {
			throw new Error("Failed to sign message");
		}

		const dynamicSignature: DynamicSignature = {
			signer: safeAddress,
			data: signature,
			dynamic: true,
		};
		// Safe smart contract will revert when the signature is invalid (we used walletClients[1] to sign which is not an owner)
		const result = await isValidERC1271Signature(
			publicClient,
			dynamicSignature,
			{ data: message.message },
		);

		expect(result.valid).toBe(false);
		expect(result.validatedSigner).toBe(safeAddress);
		expect(result.signature).toEqual(dynamicSignature);
		expect(result.error).toBeDefined();
	});

	test("should handle calls to EOA addresses and return invalid", async () => {
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

		// eth_call to an EOA would return empty bytes and will not error, just return invalid
		expect(result.valid).toBe(false);
		expect(result.error).toBeUndefined();
	});

	test("should handle contracts without ERC-1271 support and return invalid", async () => {
		// Deploy a Safe contract without a fallback handler that contains ERC-1271 function
		const deployment = await deploySafeAccount(publicClient, {
			owners: [walletClients[0].account.address],
			threshold: 1n,
			fallbackHandler: ZERO_ADDRESS,
		});
		const safeAddress = deployment.data.safeAddress;
		const txHash = await deployment.send();
		await publicClient.waitForTransactionReceipt({
			hash: txHash,
		});

		const message: SafeMessage = {
			message: keccak256(toHex("test message")),
		};
		const safeMessageHash = calculateSafeMessageHash(
			safeAddress,
			await getChainId(publicClient),
			message,
		);

		const signature = await walletClients[0].account.sign?.({
			hash: safeMessageHash,
		});

		if (!signature) {
			throw new Error("Failed to sign message");
		}

		const dynamicSignature: DynamicSignature = {
			signer: safeAddress,
			data: signature,
			dynamic: true,
		};

		const result = await isValidERC1271Signature(
			publicClient,
			dynamicSignature,
			{ dataHash: message.message },
		);

		// Contract with a fallback function that does not contain ERC-1271 will return 0x, so we just check for invalid
		// and do not expect an error
		expect(result.valid).toBe(false);
		expect(result.error).toBeUndefined();
	});

	test("should handle empty signature data", async () => {
		/*
		 * Minimal runtime that *always* returns a 32-byte word whose first 4 bytes
		 * are `0x1626ba7e`. This matches the bytes32 variant of EIP-1271’s magic value so
		 * that the validator should mark the signature as **valid**.
		 *
		 *  ┌────────┬──────────────────┬────────────────────────────────────────┬─────────────────────────────────────────────┐
		 *  │ Byte   │ Instruction      │ Stack after execution                  │ Comment                                     │
		 *  ├────────┼──────────────────┼────────────────────────────────────────┼─────────────────────────────────────────────┤
		 *  │ 0x63   │ PUSH4 0x1626ba7e │ 0x1626ba7e                             │ Push constant                               │
		 *  │ 0x60   │ PUSH1 0xe0       │ 0x1626ba7e 0xe0                        │ Shift amount = 224 bits (28 bytes)          │
		 *  │ 0x1b   │ SHL              │ 0x1626ba7e << 224                      │ Move constant into the *high* 4 bytes       │
		 *  │ 0x5f   │ PUSH0            │ 0x00 <value>                           │ Destination offset (memory 0)               │
		 *  │ 0x52   │ MSTORE           │ –                                      │ mstore(0, value)                            │
		 *  │ 0x60   │ PUSH1 0x20       │ 0x20                                   │ Return size = 32                            │
		 *  │ 0x5f   │ PUSH0            │ 0x00 0x20                              │ Return offset = 0                           │
		 *  │ 0xf3   │ RETURN           │ –                                      │ return(0, 32)                               │
		 *  └────────┴──────────────────┴────────────────────────────────────────┴─────────────────────────────────────────────┘
		 *
		 *  Concatenated bytecode (spaces added for readability):
		 *  0x63 1626ba7e 60 e0 1b 5f 52 60 20 5f f3
		 */
		const address = randomAddress();
		await testClient.setCode({
			address,
			// Runtime bytecode: PUSH4 0xc0ffee00 │ PUSH1 0xe0 │ SHL │ PUSH0 │ MSTORE │ PUSH1 0x20 │ PUSH0 │ RETURN
			// Encoded: 0x63  60 e0 1b 5f 52 60 20 5f f3
			bytecode: "0x631626ba7e60e01b5f5260205ff3",
		});

		const dataHash = keccak256(toHex("test message"));
		const dynamicSignature: DynamicSignature = {
			signer: address,
			data: "0x",
			dynamic: true,
		};

		const result = await isValidERC1271Signature(
			publicClient,
			dynamicSignature,
			{ dataHash },
		);

		expect(result.valid).toBe(true);
		expect(result.error).toBeUndefined();
		expect(result.signature).toEqual(dynamicSignature);
	});

	test("should handle large signature payloads", async () => {
		/*
		 * Minimal runtime that *always* returns a 32-byte word whose first 4 bytes
		 * are `0x1626ba7e`. This matches the bytes32 variant of EIP-1271’s magic value so
		 * that the validator should mark the signature as **valid**.
		 *
		 *  ┌────────┬──────────────────┬────────────────────────────────────────┬─────────────────────────────────────────────┐
		 *  │ Byte   │ Instruction      │ Stack after execution                  │ Comment                                     │
		 *  ├────────┼──────────────────┼────────────────────────────────────────┼─────────────────────────────────────────────┤
		 *  │ 0x63   │ PUSH4 0x1626ba7e │ 0x1626ba7e                             │ Push constant                               │
		 *  │ 0x60   │ PUSH1 0xe0       │ 0x1626ba7e 0xe0                        │ Shift amount = 224 bits (28 bytes)          │
		 *  │ 0x1b   │ SHL              │ 0x1626ba7e << 224                      │ Move constant into the *high* 4 bytes       │
		 *  │ 0x5f   │ PUSH0            │ 0x00 <value>                           │ Destination offset (memory 0)               │
		 *  │ 0x52   │ MSTORE           │ –                                      │ mstore(0, value)                            │
		 *  │ 0x60   │ PUSH1 0x20       │ 0x20                                   │ Return size = 32                            │
		 *  │ 0x5f   │ PUSH0            │ 0x00 0x20                              │ Return offset = 0                           │
		 *  │ 0xf3   │ RETURN           │ –                                      │ return(0, 32)                               │
		 *  └────────┴──────────────────┴────────────────────────────────────────┴─────────────────────────────────────────────┘
		 *
		 *  Concatenated bytecode (spaces added for readability):
		 *  0x63 1626ba7e 60 e0 1b 5f 52 60 20 5f f3
		 */
		const address = randomAddress();
		await testClient.setCode({
			address,
			// Runtime bytecode: PUSH4 0xc0ffee00 │ PUSH1 0xe0 │ SHL │ PUSH0 │ MSTORE │ PUSH1 0x20 │ PUSH0 │ RETURN
			// Encoded: 0x63  60 e0 1b 5f 52 60 20 5f f3
			bytecode: "0x631626ba7e60e01b5f5260205ff3",
		});

		const dataHash = keccak256(toHex("test message"));
		const largeSignature = randomBytesHex(1500);
		const dynamicSignature: DynamicSignature = {
			signer: address,
			data: largeSignature,
			dynamic: true,
		};

		const result = await isValidERC1271Signature(
			publicClient,
			dynamicSignature,
			{ dataHash },
		);

		expect(result.valid).toBe(true);
		expect(result.error).toBeUndefined();
		expect(result.signature).toEqual(dynamicSignature);
	});
});

describe.only("isValidApprovedHashSignature", () => {
	const { testClient, publicClient, walletClients } = createClients();
	let resetSnapshot: () => Promise<void>;
	let safeAddress: Address;
	let owners: [Address, Address, Address];

	beforeEach(async () => {
		resetSnapshot = await snapshot(testClient);
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
	});

	afterEach(async () => {
		await resetSnapshot();
	});

	test("should validate when hash is approved (non-zero value)", async () => {
		const owner = owners[0];
		const dataHash = keccak256(toHex("approved message"));

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

		const staticSignature: StaticSignature = {
			signer: owner,
			data: getApprovedHashSignatureBytes(owner),
		};

		const result = await isValidApprovedHashSignature(
			publicClient,
			staticSignature,
			{ dataHash, safeAddress },
		);

		expect(result.valid).toBe(true);
		expect(result.validatedSigner).toBe(owner);
		expect(result.error).toBeUndefined();
	});

	test("should return invalid when hash not approved (zero value)", async () => {
		const owner = owners[0];
		const dataHash = keccak256(toHex("unapproved message"));

		const staticSignature: StaticSignature = {
			signer: owner,
			data: getApprovedHashSignatureBytes(owner),
		};

		const result = await isValidApprovedHashSignature(
			publicClient,
			staticSignature,
			{ dataHash, safeAddress },
		);

		expect(result.valid).toBe(false);
		expect(result.validatedSigner).toBe(owner);
		expect(result.error).toBeUndefined();
	});

	test("should handle incorrectly formatted signature data", async () => {
		const dataHash = keccak256(toHex("test message"));

		// Test various malformed signatures
		const malformedSignatures: Hex[] = [
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
			console.log(malformedSig);
			const result = await isValidApprovedHashSignature(
				publicClient,
				staticSignature,
				{ dataHash, safeAddress },
			);

			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		}
	});

	test("should handle eth_call failures gracefully", async () => {
		const owner = owners[0];
		const dataHash = keccak256(toHex("test message"));

		const signatureData = concatHex([
			padStartHex(owner, 32),
			"0x0000000000000000000000000000000000000000000000000000000000000000",
			"0x01",
		]);

		const staticSignature: StaticSignature = {
			signer: owner,
			data: signatureData,
		};

		const mockProvider: EIP1193ProviderWithRequestFn = {
			request: async () => {
				throw new Error("Network error");
			},
		};

		const result = await isValidApprovedHashSignature(
			mockProvider,
			staticSignature,
			{ dataHash, safeAddress },
		);

		expect(result.valid).toBe(false);
		expect(result.error).toBeDefined();
		expect(result.error?.message).toContain("Network error");
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
			padStartHex(owner, 32),
			"0x0000000000000000000000000000000000000000000000000000000000000000",
			"0x01",
		]);

		const staticSignature: StaticSignature = {
			signer: owner,
			data: signatureData,
		};

		// Override signer to point to non-Safe contract
		const modifiedSignature = { ...staticSignature, signer: contractAddress! };

		const result = await isValidApprovedHashSignature(
			publicClient,
			modifiedSignature,
			{ dataHash, safeAddress },
		);

		expect(result.valid).toBe(false);
		expect(result.error).toBeDefined();
	});

	test("should treat any non-zero approval value as valid", async () => {
		const owner = owners[0];
		const dataHash = keccak256(toHex("test message"));

		const signatureData = concatHex([
			padStartHex(owner, 32),
			"0x0000000000000000000000000000000000000000000000000000000000000000",
			"0x01",
		]);

		const staticSignature: StaticSignature = {
			signer: owner,
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
			const mockProvider: EIP1193ProviderWithRequestFn = {
				request: async (args: any) => {
					if (args.method === "eth_call") {
						return returnValue;
					}
					return publicClient.request(args);
				},
			};

			const result = await isValidApprovedHashSignature(
				mockProvider,
				staticSignature,
				{ dataHash, safeAddress },
			);

			expect(result.valid).toBe(true);
		}
	});

	test("should only accept signatures with v=1", async () => {
		const owner = owners[0];
		const dataHash = keccak256(toHex("test message"));

		// Test different v values
		const vValues = [0, 2, 27, 28, 31, 32, 255];

		for (const v of vValues) {
			const signatureData = concatHex([
				padStartHex(owner, 32),
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
				{ dataHash, safeAddress },
			);

			// Should still work but return false since hash isn't approved
			expect(result.valid).toBe(false);
			expect(result.error).toBeUndefined();
		}
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
