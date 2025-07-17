import type { Address, Hex } from "viem";
import { encodeFunctionData, hashMessage, recoverAddress } from "viem";
import { PARSED_SAFE_ABI } from "./abis";
import type {
	DynamicSignature,
	EIP1193ProviderWithRequestFn,
	PicosafeSignature,
	StaticSignature,
} from "./types";
import { SignatureTypeVByte } from "./types";

type SignatureValidationResult<T> = Readonly<{
	valid: boolean;
	error?: Error;
	validatedSigner: Address;
	signature: T;
}>;

async function isValidECDSASignature(
	signature: StaticSignature,
	dataHash: Hex,
): Promise<SignatureValidationResult<StaticSignature>> {
	const recoveredSigner = await recoverAddress({
		hash: dataHash,
		signature: signature.data,
	});

	return {
		valid: recoveredSigner === signature.signer,
		validatedSigner: recoveredSigner,
		signature,
	};
}

// ERC-1271 magic values
const MAGIC_VALUE_BYTES32 = "0x1626ba7e" as const; // bytes4(keccak256("isValidSignature(bytes32,bytes)"))
const MAGIC_VALUE_BYTES = "0x20c13b0b" as const; // bytes4(keccak256("isValidSignature(bytes,bytes)"))

async function isValidERC1271Signature(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	signature: DynamicSignature,
	validationData: { data: Hex } | { dataHash: Hex },
): Promise<SignatureValidationResult<DynamicSignature>> {
	// Normalize any return value to a canonical 4-byte (bytes4) hex string
	const normalizeBytes4 = (result: unknown): Hex | undefined => {
		if (typeof result !== "string" || !result.startsWith("0x"))
			return undefined;
		// Empty return value ("0x") indicates "not implemented"; treat as undefined
		if (result.length === 2) return "0x00000000";
		return result as Hex;
	};

	// Helper to perform the eth_call
	const callIsValid = async (calldata: Hex): Promise<Hex | undefined> => {
		const raw = (await provider.request({
			method: "eth_call",
			params: [{ to: signature.signer, data: calldata }, "latest"],
		})) as Hex;
		return normalizeBytes4(raw);
	};

	// Determine which variant to call based on provided validationData
	let calldata: Hex;
	let expectedMagic: Hex;

	if ("dataHash" in validationData) {
		// bytes32 variant
		calldata = encodeFunctionData({
			abi: [
				"function isValidSignature(bytes32 dataHash, bytes signature) view returns (bytes4)",
			] as const,
			functionName: "isValidSignature",
			args: [validationData.dataHash, signature.data],
		});
		expectedMagic = MAGIC_VALUE_BYTES32;
	} else {
		// bytes variant
		calldata = encodeFunctionData({
			abi: [
				"function isValidSignature(bytes data, bytes signature) view returns (bytes4)",
			] as const,
			functionName: "isValidSignature",
			args: [validationData.data, signature.data],
		});
		expectedMagic = MAGIC_VALUE_BYTES;
	}

	let capturedError: Error | undefined;

	try {
		const result = await callIsValid(calldata);
		if (result && result.toLowerCase() === expectedMagic.toLowerCase()) {
			return {
				valid: true,
				validatedSigner: signature.signer,
				signature,
			};
		}
	} catch (err) {
		if (err instanceof Error) capturedError = err;
	}

	return {
		valid: false,
		validatedSigner: signature.signer,
		signature,
		error: capturedError ?? new Error("Invalid ERC1271 signature"),
	};
}

async function isValidApprovedHashSignature(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	signature: StaticSignature,
	validationData: { dataHash: Hex },
): Promise<SignatureValidationResult<StaticSignature>> {
	const { dataHash } = validationData;

	const approvedHashesCalldata = encodeFunctionData({
		abi: PARSED_SAFE_ABI,
		functionName: "approvedHashes",
		args: [signature.signer, dataHash],
	});

	let approvedHash: Hex | undefined;
	let capturedError: Error | undefined;

	try {
		approvedHash = await provider.request({
			method: "eth_call",
			params: [
				{
					to: signature.signer,
					data: approvedHashesCalldata,
				},
			],
		});
	} catch (err) {
		if (err instanceof Error) {
			capturedError = err;
		} else {
			capturedError = new Error(
				`Unknown error while calling approvedHashes: ${err}`,
			);
		}
	}

	return {
		valid: approvedHash !== undefined && approvedHash !== "0x",
		validatedSigner: signature.signer,
		signature,
		error: capturedError,
	};
}

// this method verifies signature for a given data hash and data
async function validateSignature(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	signature: PicosafeSignature,
	validationData: { data: Hex; dataHash: Hex },
): Promise<SignatureValidationResult<PicosafeSignature>> {
	if ("dynamic" in signature && signature.dynamic) {
		return await isValidERC1271Signature(provider, signature, validationData);
	}

	if (signature.data.length !== 130) {
		throw new Error("Invalid signature data length");
	}

	const vByte = Number.parseInt(signature.data.slice(-2), 16);
	switch (vByte) {
		case SignatureTypeVByte.EIP712_RECID_1:
		case SignatureTypeVByte.EIP712_RECID_2: {
			const recoveredSigner = await recoverAddress({
				hash: validationData.dataHash,
				signature: signature.data,
			});

			return {
				valid: recoveredSigner === signature.signer,
				validatedSigner: recoveredSigner,
				signature,
			};
		}
		case SignatureTypeVByte.ETH_SIGN_RECID_1:
		case SignatureTypeVByte.ETH_SIGN_RECID_2: {
			const recoveredSigner = await recoverAddress({
				hash: hashMessage(validationData.dataHash),
				signature: signature.data,
			});

			return {
				valid: recoveredSigner === signature.signer,
				validatedSigner: recoveredSigner,
				signature,
			};
		}
		case SignatureTypeVByte.APPROVED_HASH:
			return await isValidApprovedHashSignature(
				provider,
				signature,
				validationData,
			);
		default:
			throw new Error("Invalid signature type");
	}
}

export type { SignatureValidationResult };
export {
	isValidECDSASignature,
	isValidERC1271Signature,
	isValidApprovedHashSignature,
	validateSignature,
};
