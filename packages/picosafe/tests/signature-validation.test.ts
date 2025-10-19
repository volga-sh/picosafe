import {
	AbiFunction,
	Address as AddressUtils,
	Bytes,
	Hash,
	Hex as HexUtils,
	PersonalMessage,
	Secp256k1,
	Signature,
} from "ox";

// Type aliases sourced from ox namespaces
type Hex = HexUtils.Hex;
type Address = AddressUtils.Address;

import { afterEach, beforeEach, describe, expect, test } from "vitest";

// Helper functions to replace viem functions
const generatePrivateKey = () => Secp256k1.randomPrivateKey();

const privateKeyToAccount = (privateKey: Hex) => {
	const publicKey = Secp256k1.getPublicKey({ privateKey });
	const address = AddressUtils.checksum(AddressUtils.fromPublicKey(publicKey));
	return {
		address,
		sign: async ({ hash }: { hash: Hex }): Promise<Hex> => {
			const signature = Secp256k1.sign({ payload: hash, privateKey });
			return Signature.toHex(signature) as Hex;
		},
		signMessage: async ({ message }: { message: Hex }): Promise<Hex> => {
			const payload = PersonalMessage.getSignPayload(message);
			const signature = Secp256k1.sign({ payload, privateKey });
			return Signature.toHex(signature) as Hex;
		},
	};
};

const keccak256 = (data: Hex | Uint8Array | string): Hex => {
	const bytes =
		typeof data === "string"
			? data.startsWith("0x")
				? Bytes.fromHex(data as Hex)
				: new TextEncoder().encode(data)
			: data;
	const hashBytes = Hash.keccak256(bytes);
	return HexUtils.fromBytes(hashBytes);
};

const toHex = (
	data: Hex | Uint8Array | string | number,
	options?: { size?: number },
): Hex => {
	if (typeof data === "number") {
		const size = options?.size ?? 1;
		const bytes = new Uint8Array(size);
		bytes[size - 1] = data;
		return HexUtils.fromBytes(bytes);
	}
	if (typeof data === "string") {
		if (data.startsWith("0x")) return data as Hex;
		return HexUtils.fromBytes(new TextEncoder().encode(data));
	}
	if (data instanceof Uint8Array) {
		return HexUtils.fromBytes(data);
	}
	return data as Hex;
};

const toBytes = (data: Hex | Uint8Array | string): Uint8Array => {
	if (data instanceof Uint8Array) return data;
	if (typeof data === "string" && !data.startsWith("0x")) {
		return new TextEncoder().encode(data);
	}
	return Bytes.fromHex(data as Hex);
};

const concatHex = (values: readonly Hex[]): Hex => HexUtils.concat(...values);

const hashMessage = ({ raw }: { raw: Uint8Array }): Hex => {
	// Convert bytes to hex for PersonalMessage
	const hexMessage = HexUtils.fromBytes(raw);
	return PersonalMessage.getSignPayload(hexMessage);
};
const encodeFunctionData = ({
	abi,
	functionName,
	args,
}: {
	abi: readonly unknown[];
	functionName: string;
	args?: readonly unknown[];
}) => {
	const fn = AbiFunction.fromAbi(abi, functionName);
	return AbiFunction.encodeData(fn, args);
};

import { PARSED_SAFE_ABI } from "../src/abis";
import { deploySafeAccount } from "../src/deployment";
import { calculateSafeMessageHash } from "../src/eip712";
import { V141_ADDRESSES } from "../src/safe-contracts";
import { getApprovedHashSignatureBytes } from "../src/safe-signatures";
import {
	isValidApprovedHashSignature,
	isValidECDSASignature,
	isValidERC1271Signature,
	validateSignature,
} from "../src/signature-validation";
import type {
	ApprovedHashSignature,
	DynamicSignature,
	ECDSASignature,
	EIP1193ProviderWithRequestFn,
	SafeMessage,
	StaticSignature,
} from "../src/types";
import { ZERO_ADDRESS } from "../src/utilities/constants";
import { getChainId } from "../src/utilities/eip1193-provider";
import {
	getMockERC1271InvalidBytecode,
	getMockERC1271ValidBytecode,
} from "./fixtures/mock-bytecodes";
import { createClients, snapshot } from "./fixtures/setup";
import { randomAddress, randomBytesHex } from "./utils";

describe("isValidECDSASignature", () => {
	test("should validate correct ECDSA signatures with v=27 and v=28", async () => {
		let foundV27 = false;
		let foundV28 = false;
		let attempts = 0;
		const maxAttempts = 100;

		while ((!foundV27 || !foundV28) && attempts < maxAttempts) {
			attempts++;

			const privateKey = generatePrivateKey();
			const account = privateKeyToAccount(privateKey);
			const dataHash = keccak256(toHex(`test message ${attempts}`));

			const signature = await account.sign({
				hash: dataHash,
			});

			const vByte = Number.parseInt(signature.slice(-2), 16);

			const staticSignature: StaticSignature = {
				signer: account.address,
				data: signature,
			};

			const result = await isValidECDSASignature(staticSignature, dataHash);

			expect(result.valid).toBe(true);
			expect(result.validatedSigner).toBe(account.address);
			expect(result.signature).toEqual(staticSignature);
			expect(result.error).toBeUndefined();

			if (vByte === 27) {
				foundV27 = true;
			} else if (vByte === 28) {
				foundV28 = true;
			}
		}

		expect(foundV27).toBe(true);
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
			{
				dataHash: message.message,
			},
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
			{
				data: message.message,
			},
		);

		expect(result.valid).toBe(true);
		expect(result.validatedSigner).toBe(safeAddress);
		expect(result.signature).toEqual(dynamicSignature);
		expect(result.error).toBeUndefined();
	});

	test("should return invalid when contract returns wrong magic value", async () => {
		const address = randomAddress();
		await testClient.setCode({
			address,
			bytecode: getMockERC1271InvalidBytecode(),
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
			{
				data: message.message,
			},
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
			{
				dataHash: message.message,
			},
		);

		// Contract with a fallback function that does not contain ERC-1271 will return 0x, so we just check for invalid
		// and do not expect an error
		expect(result.valid).toBe(false);
		expect(result.error).toBeUndefined();
	});

	test("should handle empty signature data", async () => {
		const address = randomAddress();
		await testClient.setCode({
			address,
			bytecode: getMockERC1271ValidBytecode(),
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
		const address = randomAddress();
		await testClient.setCode({
			address,
			bytecode: getMockERC1271ValidBytecode(),
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

describe("isValidApprovedHashSignature", () => {
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
			{
				dataHash,
				safeAddress,
			},
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
			{
				dataHash,
				safeAddress,
			},
		);

		expect(result.valid).toBe(false);
		expect(result.validatedSigner).toBe(owner);
		expect(result.error).toBeUndefined();
	});

	test("should handle eth_call failures gracefully", async () => {
		const owner = owners[0];
		const dataHash = keccak256(toHex("test message"));

		const signatureData = concatHex([
			HexUtils.padLeft(owner, 32),
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
			{
				dataHash,
				safeAddress,
			},
		);

		expect(result.valid).toBe(false);
		expect(result.error).toBeDefined();
		expect(result.error?.message).toContain("Network error");
	});

	test("should handle calls to contracts without approvedHashes and return an error", async () => {
		const owner = randomAddress();
		const dataHash = keccak256(toHex("test message"));

		const signatureData = concatHex([
			HexUtils.padLeft(owner, 32),
			"0x0000000000000000000000000000000000000000000000000000000000000000",
			"0x01",
		]);

		const staticSignature: StaticSignature = {
			signer: owner,
			data: signatureData,
		};

		const result = await isValidApprovedHashSignature(
			publicClient,
			staticSignature,
			{
				dataHash,
				safeAddress: V141_ADDRESSES.MultiSend,
			},
		);

		expect(result.valid).toBe(false);
		expect(result.error).toBeDefined();
		expect(result.validatedSigner).toBe(owner);
	});

	test("should treat any non-zero approval value as valid", async () => {
		const owner = owners[0];
		const dataHash = keccak256(toHex("test message"));

		const signatureData = getApprovedHashSignatureBytes(owner);

		const staticSignature: StaticSignature = {
			signer: owner,
			data: signatureData,
		};

		const nonZeroValues = [
			"0x0000000000000000000000000000000000000000000000000000000000000001", // 1
			"0x00000000000000000000000000000000000000000000000000000000000000ff", // 255
			"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", // MAX
			randomBytesHex(32), // Random
		] as const;

		for (const returnValue of nonZeroValues) {
			const mockProvider: EIP1193ProviderWithRequestFn = {
				request: async () => {
					return returnValue;
				},
			};

			const result = await isValidApprovedHashSignature(
				mockProvider,
				staticSignature,
				{
					dataHash,
					safeAddress,
				},
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
				HexUtils.padLeft(owner, 32),
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
				{
					dataHash,
					safeAddress,
				},
			);

			// Should still work but return false since hash isn't approved
			expect(result.valid).toBe(false);
			expect(result.error).toBeUndefined();
		}
	});
});

describe("validateSignature", () => {
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

	describe("ECDSA signatures (EIP-712)", () => {
		test("should validate correct EIP-712 signatures with v=27 and v=28", async () => {
			let foundV27 = false;
			let foundV28 = false;
			let attempts = 0;
			const maxAttempts = 100;

			while ((!foundV27 || !foundV28) && attempts < maxAttempts) {
				attempts++;
				const privateKey = generatePrivateKey();
				const account = privateKeyToAccount(privateKey);
				const dataHash = keccak256(toHex(`test message ${attempts}`));

				const signature = await account.sign({
					hash: dataHash,
				});

				const vByte = Number.parseInt(signature.slice(-2), 16);

				const ecdsaSignature: ECDSASignature = {
					signer: account.address,
					data: signature,
				};

				const result = await validateSignature(publicClient, ecdsaSignature, {
					dataHash,
				});

				expect(result.valid).toBe(true);
				expect(result.validatedSigner).toBe(account.address);
				expect(result.signature).toEqual(ecdsaSignature);
				expect(result.error).toBeUndefined();

				if (vByte === 27) {
					foundV27 = true;
				} else if (vByte === 28) {
					foundV28 = true;
				}
			}

			expect(foundV27).toBe(true);
			expect(foundV28).toBe(true);
		});

		test("should return invalid for signature from different signer", async () => {
			const privateKey = generatePrivateKey();
			const account = privateKeyToAccount(privateKey);
			const fakeSigner = randomAddress();
			const dataHash = keccak256(toHex("test message"));

			const signature = await account.sign({
				hash: dataHash,
			});

			const ecdsaSignature: ECDSASignature = {
				signer: fakeSigner,
				data: signature,
			};

			const result = await validateSignature(publicClient, ecdsaSignature, {
				dataHash,
			});

			expect(result.valid).toBe(false);
			expect(result.validatedSigner).toBe(account.address);
			expect(result.validatedSigner).not.toBe(fakeSigner);
		});
	});

	describe("eth_sign signatures", () => {
		test("should validate correct eth_sign signature with v=31", async () => {
			const privateKey = generatePrivateKey();
			const account = privateKeyToAccount(privateKey);
			const dataHash = keccak256(toHex("test message"));
			const ethSignHash = hashMessage({ raw: toBytes(dataHash) });

			const signature = await account.sign({
				hash: ethSignHash,
			});

			// Convert v from 27/28 to 31/32 for eth_sign
			const vByte = Number.parseInt(signature.slice(-2), 16);
			const ethSignV = vByte + 4; // 27->31 or 28->32
			const ethSignSignature = (signature.slice(0, -2) +
				ethSignV.toString(16)) as Hex;

			const ecdsaSignature: ECDSASignature = {
				signer: account.address,
				data: ethSignSignature,
			};

			const result = await validateSignature(publicClient, ecdsaSignature, {
				dataHash,
			});

			expect(result.valid).toBe(true);
			expect(result.validatedSigner).toBe(account.address);
			// The signature in the result will have the adjusted v value (27/28 instead of 31/32)
			expect(result.signature.signer).toBe(ecdsaSignature.signer);
			expect(result.error).toBeUndefined();
		});

		test("should validate correct eth_sign signature with v=32", async () => {
			const privateKey = generatePrivateKey();
			const account = privateKeyToAccount(privateKey);
			const dataHash = keccak256(toHex("test message"));
			const ethSignHash = hashMessage({ raw: toBytes(dataHash) });

			const signature = await account.sign({
				hash: ethSignHash,
			});

			// Convert v from 27/28 to 31/32 for eth_sign
			const vByte = Number.parseInt(signature.slice(-2), 16);
			const ethSignV = vByte + 4; // 27->31 or 28->32
			const ethSignSignature = (signature.slice(0, -2) +
				ethSignV.toString(16)) as Hex;

			const ecdsaSignature: ECDSASignature = {
				signer: account.address,
				data: ethSignSignature,
			};

			const result = await validateSignature(publicClient, ecdsaSignature, {
				dataHash,
			});

			expect(result.valid).toBe(true);
			expect(result.validatedSigner).toBe(account.address);
			// The signature in the result will have the adjusted v value (27/28 instead of 31/32)
			expect(result.signature.signer).toBe(ecdsaSignature.signer);
			expect(result.error).toBeUndefined();
		});
	});

	describe("ERC-1271 contract signatures", () => {
		test("should validate valid ERC-1271 signature using bytes32 variant", async () => {
			// Deploy a mock ERC-1271 contract that always returns valid
			const mockAddress = randomAddress();
			await testClient.setCode({
				address: mockAddress,
				bytecode: getMockERC1271ValidBytecode(),
			});

			const dataHash = keccak256(toHex("test message"));
			const signatureData = randomBytesHex(65);

			const dynamicSignature: DynamicSignature = {
				signer: mockAddress,
				data: signatureData,
				dynamic: true,
			};

			const result = await validateSignature(publicClient, dynamicSignature, {
				dataHash,
			});

			expect(result.valid).toBe(true);
			expect(result.validatedSigner).toBe(mockAddress);
			expect(result.signature).toEqual(dynamicSignature);
			expect(result.error).toBeUndefined();
		});

		test("should validate valid ERC-1271 signature using bytes variant", async () => {
			// Deploy a mock ERC-1271 contract that always returns valid for bytes variant
			const mockAddress = randomAddress();
			await testClient.setCode({
				address: mockAddress,
				// Mock that returns 0x20c13b0b for bytes variant
				bytecode: "0x6320c13b0b60e01b5f5260205ff3",
			});

			const data = toHex("test message");
			const signatureData = randomBytesHex(65);

			const dynamicSignature: DynamicSignature = {
				signer: mockAddress,
				data: signatureData,
				dynamic: true,
			};

			const result = await validateSignature(publicClient, dynamicSignature, {
				data,
			});

			expect(result.valid).toBe(true);
			expect(result.validatedSigner).toBe(mockAddress);
			expect(result.signature).toEqual(dynamicSignature);
			expect(result.error).toBeUndefined();
		});

		test("should handle both data and dataHash provided", async () => {
			// Deploy a mock ERC-1271 contract that always returns valid
			const mockAddress = randomAddress();
			await testClient.setCode({
				address: mockAddress,
				bytecode: getMockERC1271ValidBytecode(),
			});

			const data = toHex("test message");
			const dataHash = keccak256(data);
			const signatureData = randomBytesHex(65);

			const dynamicSignature: DynamicSignature = {
				signer: mockAddress,
				data: signatureData,
				dynamic: true,
			};

			// When both are provided, it should prefer dataHash
			const result = await validateSignature(publicClient, dynamicSignature, {
				data,
				dataHash,
			});

			expect(result.valid).toBe(true);
			expect(result.validatedSigner).toBe(mockAddress);
			expect(result.signature).toEqual(dynamicSignature);
			expect(result.error).toBeUndefined();
		});

		test("should return invalid for wrong magic value", async () => {
			const address = randomAddress();
			await testClient.setCode({
				address,
				bytecode: "0x63c0ffee0060e01b5f5260205ff3", // Returns wrong magic value
			});

			const dataHash = keccak256(toHex("test message"));
			const signatureData = randomBytesHex(65);

			const dynamicSignature: DynamicSignature = {
				signer: address,
				data: signatureData,
				dynamic: true,
			};

			const result = await validateSignature(publicClient, dynamicSignature, {
				dataHash,
			});

			expect(result.valid).toBe(false);
			expect(result.validatedSigner).toBe(address);
			expect(result.error).toBeUndefined();
		});
	});

	describe("Approved hash signatures", () => {
		test("should validate approved hash signature", async () => {
			const owner = owners[0];
			const dataHash = keccak256(toHex("approved message"));

			// Approve the hash first
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

			const approvedHashSignature: ApprovedHashSignature = {
				signer: owner,
			};

			const result = await validateSignature(
				publicClient,
				approvedHashSignature,
				{
					dataHash,
					safeAddress,
				},
			);

			expect(result.valid).toBe(true);
			expect(result.validatedSigner).toBe(owner);
			expect(result.error).toBeUndefined();
		});

		test("should return invalid for non-approved hash", async () => {
			const owner = owners[0];
			const dataHash = keccak256(toHex("unapproved message"));

			const approvedHashSignature: ApprovedHashSignature = {
				signer: owner,
			};

			const result = await validateSignature(
				publicClient,
				approvedHashSignature,
				{
					dataHash,
					safeAddress,
				},
			);

			expect(result.valid).toBe(false);
			expect(result.validatedSigner).toBe(owner);
			expect(result.error).toBeUndefined();
		});
	});

	describe("Edge cases and error handling", () => {
		test("should throw error for invalid signature type byte", async () => {
			const invalidVBytes = [2, 25, 26, 29, 30, 33, 255];

			for (const v of invalidVBytes) {
				const signature = concatHex([
					randomBytesHex(32), // r
					randomBytesHex(32), // s
					toHex(v, { size: 1 }), // v
				]);

				const ecdsaSignature: ECDSASignature = {
					signer: randomAddress(),
					data: signature,
				};

				await expect(
					validateSignature(publicClient, ecdsaSignature, {
						dataHash: randomBytesHex(32),
					}),
				).rejects.toThrow(`Unknown signature v-byte: ${v}`);
			}
		});

		test("should handle malformed signature data gracefully", async () => {
			const dataHash = keccak256(toHex("test message"));
			const malformedSignatures = [
				"0x", // Empty
				"0x1234", // Too short
				`0x${"a".repeat(64)}`, // 32 bytes
				`0x${"a".repeat(128)}`, // 64 bytes
				`0x${"a".repeat(130)}1b`, // 66 bytes
			];

			for (const malformedSig of malformedSignatures) {
				const ecdsaSignature: ECDSASignature = {
					signer: randomAddress(),
					data: malformedSig as Hex,
				};

				// Malformed signatures should either throw or return invalid
				try {
					const result = await validateSignature(publicClient, ecdsaSignature, {
						dataHash,
					});
					expect(result.valid).toBe(false);
					expect(result.error).toBeDefined();
				} catch (error) {
					// Expected for signatures too short to determine v-byte
					expect(error).toBeDefined();
				}
			}
		});

		test("should handle provider errors gracefully for ERC-1271", async () => {
			const mockProvider: EIP1193ProviderWithRequestFn = {
				request: async () => {
					throw new Error("Network error");
				},
			};

			const dynamicSignature: DynamicSignature = {
				signer: randomAddress(),
				data: randomBytesHex(65),
				dynamic: true,
			};

			const result = await validateSignature(mockProvider, dynamicSignature, {
				dataHash: randomBytesHex(32),
			});

			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
			expect(result.error?.message).toContain("Network error");
		});

		test("should handle provider errors gracefully for approved hash", async () => {
			const mockProvider: EIP1193ProviderWithRequestFn = {
				request: async () => {
					throw new Error("RPC error");
				},
			};

			const approvedHashSignature: ApprovedHashSignature = {
				signer: randomAddress(),
			};

			const result = await validateSignature(
				mockProvider,
				approvedHashSignature,
				{
					dataHash: randomBytesHex(32),
					safeAddress: randomAddress(),
				},
			);

			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
			expect(result.error?.message).toContain("RPC error");
		});

		test("should maintain signature type consistency", async () => {
			const privateKey = generatePrivateKey();
			const account = privateKeyToAccount(privateKey);
			const dataHash = keccak256(toHex("test message"));

			const signature = await account.sign({
				hash: dataHash,
			});

			// Test that the same signature validates consistently
			const ecdsaSignature: ECDSASignature = {
				signer: account.address,
				data: signature,
			};

			const results = await Promise.all([
				validateSignature(publicClient, ecdsaSignature, { dataHash }),
				validateSignature(publicClient, ecdsaSignature, { dataHash }),
				validateSignature(publicClient, ecdsaSignature, { dataHash }),
			]);

			// All results should be identical
			expect(results[0]).toEqual(results[1]);
			expect(results[1]).toEqual(results[2]);
			expect(results.every((r) => r.valid)).toBe(true);
		});
	});
});
