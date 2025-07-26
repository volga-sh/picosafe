import type { Address, Hex } from "viem";
import { encodeFunctionData, hashMessage, recoverAddress, toBytes } from "viem";
import {
	PARSED_ERC_1271_ABI_CURRENT,
	PARSED_ERC_1271_ABI_LEGACY,
	PARSED_SAFE_ABI,
} from "./abis";
import { getSignatureTypeVByte } from "./safe-signatures";
import type {
	ApprovedHashSignature,
	DynamicSignature,
	ECDSASignature,
	EIP1193ProviderWithRequestFn,
	PicosafeSignature,
} from "./types";
import { SignatureTypeVByte } from "./types";
import { captureError } from "./utilities/captureError";

type SignatureValidationResult<T> = Readonly<{
	valid: boolean;
	error?: Error;
	validatedSigner?: Address;
	signature: T;
}>;

const ERC1271 = {
	MAGIC_VALUE_BYTES32: "0x1626ba7e",
	MAGIC_VALUE_BYTES: "0x20c13b0b",
	RESULT_LENGTH: 10,
} as const;

const ZERO_HASH =
	"0x0000000000000000000000000000000000000000000000000000000000000000";

type ValidationContext<S extends PicosafeSignature> = S extends DynamicSignature
	? { data: Hex } | { dataHash: Hex }
	: S extends ECDSASignature
		? { dataHash: Hex }
		: S extends ApprovedHashSignature
			? { dataHash: Hex; safeAddress: Address }
			: never;

/**
 * Type guard to check if validation context is for approved hash signatures
 * @internal
 * @param ctx - The validation context to check
 * @returns True if context contains dataHash and safeAddress properties
 */
function isApprovedHashContext(
	ctx: unknown,
): ctx is { dataHash: Hex; safeAddress: Address } {
	return (
		typeof ctx === "object" &&
		ctx !== null &&
		"dataHash" in ctx &&
		"safeAddress" in ctx
	);
}

/**
 * Type guard to check if validation context is for dynamic signatures
 * @internal
 * @param ctx - The validation context to check
 * @returns True if context contains either data or dataHash property
 */
function isDynamicContext(
	ctx: unknown,
): ctx is { data: Hex } | { dataHash: Hex } {
	return (
		typeof ctx === "object" &&
		ctx !== null &&
		("data" in ctx || "dataHash" in ctx)
	);
}

/**
 * Builds calldata for EIP-1271 signature validation
 *
 * Constructs the appropriate calldata for calling a contract's isValidSignature
 * function based on the validation data type. Supports both variants of EIP-1271:
 * - Current variant: isValidSignature(bytes32 hash, bytes signature)
 * - Legacy variant: isValidSignature(bytes data, bytes signature)
 *
 * @internal
 * @param validationData - Either a data hash or raw data to validate
 * @param signatureData - The signature bytes to validate
 * @returns Object containing the encoded calldata and expected magic value
 * @returns result.calldata - The encoded function call data
 * @returns result.expectedMagic - The magic value expected for valid signatures
 */
function buildERC1271Calldata(
	validationData: { dataHash: Hex } | { data: Hex },
	signatureData: Hex,
): { calldata: Hex; expectedMagic: Hex } {
	if ("dataHash" in validationData) {
		return {
			calldata: encodeFunctionData({
				abi: PARSED_ERC_1271_ABI_CURRENT,
				functionName: "isValidSignature",
				args: [validationData.dataHash, signatureData],
			}),
			expectedMagic: ERC1271.MAGIC_VALUE_BYTES32,
		};
	}

	return {
		calldata: encodeFunctionData({
			abi: PARSED_ERC_1271_ABI_LEGACY,
			functionName: "isValidSignature",
			args: [validationData.data, signatureData],
		}),
		expectedMagic: ERC1271.MAGIC_VALUE_BYTES,
	};
}

/**
 * Adjusts eth_sign signature v-byte for standard ECDSA recovery
 *
 * Safe uses v-bytes 31/32 for eth_sign signatures to distinguish them from
 * EIP-712 signatures (v=27/28). This function converts the Safe-specific
 * v-bytes back to standard ECDSA recovery IDs (27/28) for signature recovery.
 *
 * @internal
 * @param signature - The 65-byte signature with Safe's eth_sign v-byte (31/32)
 * @param vByte - The original v-byte value (must be 31 or 32)
 * @returns The signature with adjusted v-byte suitable for ecrecover (27/28)
 */
function adjustEthSignSignature(
	signature: Hex,
	vByte:
		| SignatureTypeVByte.ETH_SIGN_RECID_1
		| SignatureTypeVByte.ETH_SIGN_RECID_2,
): Hex {
	const adjustedV = vByte - 4;
	return (signature.slice(0, -2) +
		adjustedV.toString(16).padStart(2, "0")) as Hex;
}

/**
 * Validates an ECDSA signature by recovering the signer address
 *
 * Performs signature recovery using the provided signature data and data hash,
 * then compares the recovered address against the expected signer. This is used
 * for standard Ethereum ECDSA signatures (both EIP-712 and eth_sign types).
 *
 * The function does not verify that the signer is a Safe owner - it only validates
 * the cryptographic signature itself. For full Safe signature validation including
 * owner checks, use `validateSignaturesForSafe` from safe-signatures.ts.
 *
 * @param signature - The signature object containing signer address and signature data
 * @param signature.signer - The expected signer address to validate against
 * @param signature.data - The 65-byte ECDSA signature (r + s + v)
 * @param dataHash - The hash of the data that was signed
 * @returns Promise resolving to validation result with recovered signer
 * @returns result.valid - True if recovered signer matches expected signer
 * @returns result.validatedSigner - The address recovered from the signature
 * @returns result.signature - The original signature object
 * @returns result.error - Error if the signature is invalid
 * @throws {Error} If the signature is invalid (invalid r or s values)
 * @example
 * ```typescript
 * import { isValidECDSASignature, calculateSafeTransactionHash } from "picosafe";
 * import { encodeFunctionData } from "viem";
 *
 * // Validate an EIP-712 signature for a Safe transaction
 * const txHash = await calculateSafeTransactionHash(provider, safeAddress, safeTx);
 * const signature = {
 *   signer: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fA8e",
 *   data: "0x" + "a".repeat(64) + "1b" // r (32) + s (32) + v=27
 * };
 *
 * const result = await isValidECDSASignature(signature, txHash);
 * console.log('Valid:', result.valid);
 * console.log('Recovered signer:', result.validatedSigner);
 * ```
 */
async function isValidECDSASignature(
	signature: Readonly<ECDSASignature>,
	dataHash: Hex,
): Promise<SignatureValidationResult<ECDSASignature>> {
	const [recoveredSigner, error] = await captureError(
		() =>
			recoverAddress({
				hash: dataHash,
				signature: signature.data,
			}),
		"Unknown error while calling recoverAddress",
	);

	if (error) {
		return {
			valid: false,
			validatedSigner: recoveredSigner,
			signature,
			error,
		};
	}

	return {
		valid: recoveredSigner === signature.signer,
		validatedSigner: recoveredSigner,
		signature,
	};
}

/**
 * Validates a signature using EIP-1271 standard for contract signatures
 *
 * Calls the signer contract's `isValidSignature` function to validate the signature.
 * EIP-1271 allows contracts to act as signers by implementing signature validation logic.
 * This enables smart contract wallets, multisigs, and other contracts to sign Safe transactions.
 *
 * The function supports both variants of EIP-1271:
 * - `isValidSignature(bytes32,bytes)` - For validating a hash
 * - `isValidSignature(bytes,bytes)` - For validating raw data (used by Safe for transactions before V1.5.0)
 *
 * The signer contract must return the appropriate magic value to indicate a valid signature:
 * - `0x1626ba7e` for the bytes32 variant
 * - `0x20c13b0b` for the bytes variant
 *
 * @param provider - EIP-1193 provider to interact with the blockchain
 * @param signature - The dynamic signature object
 * @param signature.signer - The contract address that should validate the signature
 * @param signature.data - The signature data to be validated by the contract
 * @param signature.dynamic - Must be true to indicate this is a contract signature
 * @param validationData - Either the data hash or raw data to validate
 * @param validationData.dataHash - The hash of the data (for bytes32 variant)
 * @param validationData.data - The raw data (for bytes variant)
 * @returns Promise resolving to validation result
 * @returns result.valid - True if the contract returns the expected magic value
 * @returns result.validatedSigner - The signer address (same as input)
 * @returns result.signature - The original signature object
 * @returns result.error - Error if the contract call failed or returned wrong value
 * @example
 * ```typescript
 * import { isValidERC1271Signature } from "picosafe";
 *
 * // Validate a contract signature for a transaction hash
 * const contractSignature = {
 *   signer: "0x1234567890123456789012345678901234567890", // Smart wallet address
 *   data: "0x" + "a".repeat(130), // Contract-specific signature data
 *   dynamic: true
 * };
 *
 * const result = await isValidERC1271Signature(
 *   provider,
 *   contractSignature,
 *   { dataHash: transactionHash }
 * );
 *
 * if (result.valid) {
 *   console.log('Contract signature is valid');
 * } else {
 *   console.error('Invalid signature:', result.error);
 * }
 * ```
 * @example
 * ```typescript
 * import { isValidERC1271Signature, hashMessage } from "picosafe";
 *
 * // Validate a contract signature for a message
 * const message = "0x48656c6c6f20576f726c64"; // "Hello World" in hex
 * const messageHash = hashMessage(message);
 *
 * const result = await isValidERC1271Signature(
 *   provider,
 *   contractSignature,
 *   { data: message } // Pass raw data for message validation
 * );
 * ```
 * @see https://eips.ethereum.org/EIPS/eip-1271
 */
async function isValidERC1271Signature(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	signature: Readonly<DynamicSignature>,
	validationData: Readonly<{ data: Hex } | { dataHash: Hex }>,
): Promise<SignatureValidationResult<DynamicSignature>> {
	const { calldata, expectedMagic } = buildERC1271Calldata(
		validationData,
		signature.data,
	);

	const [result, error] = await captureError(
		() =>
			provider
				.request({
					method: "eth_call",
					params: [{ to: signature.signer, data: calldata }, "latest"],
				})
				.then((res) => res.slice(0, ERC1271.RESULT_LENGTH)),
		"Unknown error while calling isValidSignature",
	);

	if (error) {
		return {
			valid: false,
			validatedSigner: signature.signer,
			signature,
			error,
		};
	}

	return {
		valid: result === expectedMagic,
		validatedSigner: signature.signer,
		signature,
	};
}

/**
 * Validates a pre-approved hash signature by checking the Safe's approvedHashes mapping
 *
 * Safe contracts allow owners to pre-approve transaction hashes without providing a signature.
 * This is done by calling the Safe's `approveHash` function, which stores the approval on-chain.
 * During execution, a signature with v=1 indicates to check this mapping instead of validating
 * a cryptographic signature.
 *
 * Pre-approved signatures are useful for:
 * - Transactions initiated by the transaction sender (who is also an owner)
 * - Asynchronous approval flows where owners approve at different times
 * - Gas-efficient approvals that don't require signature verification
 *
 * The signature data for pre-approved hashes is formatted as:
 * - First 32 bytes: The owner address (padded to 32 bytes)
 * - Next 32 bytes: Unused (typically zeros)
 * - Last byte: 0x01 (signature type indicator)
 *
 * @param provider - EIP-1193 provider to interact with the blockchain
 * @param signature - The signature object with v=1 indicating pre-approval
 * @param signature.signer - The Safe contract address to check approvals on
 * @param signature.data - 65-byte signature with owner address and v=1
 * @param validationData - The validation data containing the hash to check
 * @param validationData.dataHash - The transaction or message hash to verify approval for
 * @returns Promise resolving to validation result
 * @returns result.valid - True if the hash is approved (non-zero value in mapping)
 * @returns result.validatedSigner - The signer address (Safe contract)
 * @returns result.signature - The original signature object
 * @returns result.error - Error if the contract call failed
 * @example
 * ```typescript
 * import { isValidApprovedHashSignature } from "picosafe";
 *
 * // Check if a transaction hash is pre-approved
 * const approvedSignature = {
 *   signer: safeAddress, // The Safe contract address
 *   data: "0x" +
 *     "000000000000000000000000" + ownerAddress.slice(2) + // Owner padded to 32 bytes
 *     "0000000000000000000000000000000000000000000000000000000000000000" + // Unused
 *     "01" // v=1 for approved hash
 * };
 *
 * const result = await isValidApprovedHashSignature(
 *   provider,
 *   approvedSignature,
 *   { dataHash: transactionHash }
 * );
 *
 * if (result.valid) {
 *   console.log('Transaction is pre-approved by owner');
 * }
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L233
 */
async function isValidApprovedHashSignature(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	signature: Readonly<ApprovedHashSignature>,
	validationData: Readonly<{
		dataHash: Hex;
		safeAddress: Address;
	}>,
): Promise<SignatureValidationResult<ApprovedHashSignature>> {
	const { dataHash, safeAddress } = validationData;

	const approvedHashesCalldata = encodeFunctionData({
		abi: PARSED_SAFE_ABI,
		functionName: "approvedHashes",
		args: [signature.signer, dataHash],
	});

	const [approvedHash, error] = await captureError(
		() =>
			provider.request({
				method: "eth_call",
				params: [
					{
						to: safeAddress,
						data: approvedHashesCalldata,
					},
				],
			}),
		"Unknown error while calling approvedHashes",
	);

	if (error) {
		return {
			valid: false,
			signature,
			validatedSigner: signature.signer,
			error,
		};
	}

	return {
		valid: approvedHash !== undefined && approvedHash !== ZERO_HASH,
		signature,
		validatedSigner: signature.signer,
	};
}

/**
 * Validates a Safe signature based on its type (ECDSA, EIP-1271, or pre-approved)
 *
 * This is the main signature validation function that determines the signature type
 * from the v-byte and routes to the appropriate validation method. It handles all
 * Safe-supported signature types:
 *
 * - **ECDSA signatures** (v=27,28,31,32): Standard Ethereum signatures validated via ecrecover
 *   - EIP-712 (v=27,28): Direct signature of the Safe transaction hash
 *   - eth_sign (v=31,32): Signature of "\x19Ethereum Signed Message:\n32" + hash
 * - **Contract signatures** (v=0): EIP-1271 signatures validated by calling the signer contract
 * - **Pre-approved hashes** (v=1): On-chain approvals checked via Safe's approvedHashes
 *
 * ### eth_sign Signature Handling (v=31,32)
 *
 * Safe uses special v-bytes (31,32) to distinguish eth_sign signatures from EIP-712 signatures.
 * When validating eth_sign signatures, this function:
 *
 * 1. Detects v=31 or v=32 indicating an eth_sign signature
 * 2. Adjusts the v-byte by subtracting 4 (31→27, 32→28) for standard ecrecover
 * 3. Converts the hash to bytes and wraps it with the Ethereum Signed Message prefix
 * 4. Validates against the prefixed hash to recover the original signer
 *
 * **Important**: When creating eth_sign signatures, the transaction hash must be treated as raw bytes,
 * not as a hex-encoded string. This means using `hashMessage({ raw: toBytes(dataHash) })` rather than
 * `hashMessage(dataHash)`. This ensures the correct message format for eth_sign validation.
 *
 * This function only validates the signature itself - it does not check if the signer
 * is a Safe owner. For complete validation including owner checks, use
 * `validateSignaturesForSafe` from safe-signatures.ts.
 *
 * @param provider - EIP-1193 provider to interact with the blockchain
 * @param signature - The signature to validate (static or dynamic)
 * @param validationData - Data needed for validation
 * @param validationData.data - The original data that was signed
 * @param validationData.dataHash - The hash of the data
 * @param validationData.safeAddress - The address of the Safe contract
 * @returns Promise resolving to validation result
 * @returns result.valid - True if the signature is cryptographically valid
 * @returns result.validatedSigner - The recovered or validated signer address
 * @returns result.signature - The original signature object
 * @returns result.error - Error details if validation failed (optional)
 * @throws {Error} If the signature has an invalid type byte
 * @example
 * ```typescript
 * import { validateSignature, calculateSafeTransactionHash } from "picosafe";
 *
 * // Validate an EIP-712 signature
 * const txHash = await calculateSafeTransactionHash(provider, safeAddress, safeTx);
 * const signature = {
 *   signer: expectedSigner,
 *   data: signatureData // 65 bytes with v=27 or 28
 * };
 *
 * const result = await validateSignature(provider, signature, {
 *   data: encodedTxData,
 *   dataHash: txHash
 * });
 *
 * if (result.valid && result.validatedSigner === expectedSigner) {
 *   console.log('Signature is valid');
 * }
 * ```
 * @example
 * ```typescript
 * import { validateSignature } from "picosafe";
 *
 * // Validate a contract signature (EIP-1271)
 * const contractSig = {
 *   signer: smartWalletAddress,
 *   data: contractSignatureData,
 *   dynamic: true
 * };
 *
 * const result = await validateSignature(provider, contractSig, {
 *   data: originalData,
 *   dataHash: dataHash
 * });
 * ```
 * @example
 * ```typescript
 * import { validateSignature, calculateSafeTransactionHash, hashMessage, toBytes } from "picosafe";
 *
 * // Validate an eth_sign signature (v=31 or 32)
 * const txHash = await calculateSafeTransactionHash(provider, safeAddress, safeTx);
 *
 * // For eth_sign, the hash must be treated as bytes when signing
 * const ethSignHash = hashMessage({ raw: toBytes(txHash) });
 * const ethSignSignature = await signer.sign({ hash: ethSignHash });
 *
 * // Adjust v-byte from 27/28 to 31/32 for eth_sign
 * const vByte = parseInt(ethSignSignature.slice(-2), 16);
 * const adjustedSignature = ethSignSignature.slice(0, -2) + (vByte + 4).toString(16);
 *
 * const signature = {
 *   signer: expectedSigner,
 *   data: adjustedSignature // 65 bytes with v=31 or 32
 * };
 *
 * // The function automatically detects eth_sign by v-byte and handles the conversion
 * const result = await validateSignature(provider, signature, {
 *   dataHash: txHash
 * });
 * ```
 * @see {@link SignatureTypeVByte} for all supported signature types
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L284
 */
async function validateSignature<T extends PicosafeSignature>(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	signature: Readonly<T>,
	validationData: Readonly<ValidationContext<T>>,
): Promise<SignatureValidationResult<T>> {
	if (!("data" in signature)) {
		if (!isApprovedHashContext(validationData)) {
			throw new Error(
				"ApprovedHashSignature validation requires dataHash and safeAddress",
			);
		}
		return isValidApprovedHashSignature(
			provider,
			signature,
			validationData,
		) as Promise<SignatureValidationResult<T>>;
	}

	if ("dynamic" in signature && signature.dynamic === true) {
		if (!isDynamicContext(validationData)) {
			throw new Error("DynamicSignature validation requires data or dataHash");
		}
		return isValidERC1271Signature(
			provider,
			signature as DynamicSignature,
			validationData,
		) as Promise<SignatureValidationResult<T>>;
	}

	const sigWithData = signature as unknown as { data: Hex; signer: Address };
	const vByte = getSignatureTypeVByte(sigWithData.data);

	// At this point, signature is ECDSASignature, so validationData should have dataHash
	// We need to check and narrow the type properly
	if (!("dataHash" in validationData)) {
		throw new Error("ECDSA signature validation requires dataHash");
	}

	switch (vByte) {
		case SignatureTypeVByte.EIP712_RECID_1:
		case SignatureTypeVByte.EIP712_RECID_2: {
			return isValidECDSASignature(
				sigWithData,
				(validationData as { dataHash: Hex }).dataHash,
			) as Promise<SignatureValidationResult<T>>;
		}

		case SignatureTypeVByte.ETH_SIGN_RECID_1:
		case SignatureTypeVByte.ETH_SIGN_RECID_2: {
			const adjustedSig = adjustEthSignSignature(sigWithData.data, vByte);
			const validationResult = await isValidECDSASignature(
				{ ...sigWithData, data: adjustedSig },
				hashMessage({ raw: toBytes(validationData.dataHash as Hex) }),
			);

			// We should restore the validation result to the original message and signature
			return {
				valid: validationResult.valid,
				validatedSigner: validationResult.validatedSigner,
				signature: sigWithData,
				error: validationResult.error,
			} as unknown as SignatureValidationResult<T>;
		}

		default:
			throw new Error(`Invalid signature type byte: ${vByte}`);
	}
}

export type { SignatureValidationResult };
export {
	isValidECDSASignature,
	isValidERC1271Signature,
	isValidApprovedHashSignature,
	validateSignature,
};
