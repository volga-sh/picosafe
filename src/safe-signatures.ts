import type { Address, Hex } from "viem";
import { encodeFunctionData, hashMessage, recoverAddress } from "viem";
import { PARSED_SAFE_ABI } from "./abis.js";
import { getOwners, getThreshold } from "./account-state.js";
import type { SignatureValidationResult } from "./signature-validation.js";
import { validateSignature } from "./signature-validation.js";
import type {
	EIP1193ProviderWithRequestFn,
	PicosafeRpcBlockIdentifier,
	PicosafeSignature,
	SafeSignaturesParam,
	SignatureValidationContext,
} from "./types.js";
import {
	isApprovedHashSignature,
	isDynamicSignature,
	isECDSASignature,
	SignatureTypeVByte,
} from "./types.js";
import { checksumAddress } from "./utilities/address.js";
import { captureError } from "./utilities/captureError.js";
import {
	ECDSA_SIGNATURE_LENGTH_BYTES,
	ECDSA_SIGNATURE_LENGTH_HEX,
} from "./utilities/constants.js";
import { concatHex, padStartHex } from "./utilities/encoding.js";

/**
 * Encodes multiple signatures into the Safe signature format
 *
 * Combines multiple signatures into a single hex string, sorted by signer
 * address in ascending order. This format is required by Safe contracts for
 * transaction execution with multiple signers.
 *
 * Encoding format:
 * - Static part: All 65-byte signature entries concatenated
 * - Dynamic part: Variable-length data appended after static part
 *
 * For standard signatures (ECDSA or pre-approved):
 * - 65 bytes containing signature data directly: r (32) + s (32) + v (1)
 * - v determines signature type: 1 for pre-approved, 27/28 for eth_sign, 31/32 for EIP-712
 *
 * For contract signatures (EIP-1271):
 * - Static part (65 bytes):
 *   - Bytes 0-32: Signer address padded to 32 bytes
 *   - Bytes 32-64: Offset to dynamic data (relative to start of signatures)
 *   - Byte 64: v = 0 (signature type identifier)
 * - Dynamic part (at specified offset):
 *   - Bytes 0-32: Length of signature data
 *   - Remaining bytes: Actual signature data for EIP-1271 validation
 *
 * The Safe contract requires signatures to be sorted by signer address to
 * prevent duplicates and ensure deterministic ordering.
 *
 * @param signatures - Array of signature objects to encode
 * @param signatures[].signer - The address of the account that created this signature
 * @param signatures[].data - The signature data (65 bytes for ECDSA, variable for dynamic)
 * @param signatures[].dynamic - Optional flag indicating this is a dynamic/contract signature
 * @returns The encoded signatures as a single hex string, sorted by signer address
 * @throws {Error} If signatures array is empty
 * @example
 * ```typescript
 * import { encodeSafeSignaturesBytes } from "picosafe";
 *
 * // Encode standard ECDSA signatures from two owners
 * const encoded = encodeSafeSignaturesBytes([
 *   {
 *     signer: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
 *     data: "0x" + "a".repeat(64) + "1b" // 65 bytes: r (32) + s (32) + v (1)
 *   },
 *   {
 *     signer: "0x0123456789012345678901234567890123456789",
 *     data: "0x" + "b".repeat(64) + "1c" // 65 bytes
 *   }
 * ]);
 * // Signatures sorted by signer address (ascending)
 * // Returns: "0x" + signature2 + signature1 (if address2 < address1)
 * ```
 *
 * @example
 * ```typescript
 * import { encodeSafeSignaturesBytes, signSafeTransaction } from "picosafe";
 *
 * // Use with Safe transaction execution
 * const signatures = await Promise.all(
 *   owners.map(async (owner) => ({
 *     signer: owner.address,
 *     data: await signSafeTransaction(provider, safeAddress, tx, owner.address)
 *   }))
 * );
 * const encodedSigs = encodeSafeSignaturesBytes(signatures);
 * await executeSafeTransaction(provider, safeAddress, tx, signatures);
 * ```
 *
 * @example
 * ```typescript
 * import { encodeSafeSignaturesBytes } from "picosafe";
 *
 * // Encode mixed signature types including contract signature
 * const encoded = encodeSafeSignaturesBytes([
 *   {
 *     signer: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
 *     data: "0x" + "a".repeat(64) + "1b", // Standard ECDSA (v=27)
 *     dynamic: false
 *   },
 *   {
 *     signer: "0x5678901234567890123456789012345678901234", // Contract wallet
 *     data: "0x" + "c".repeat(130), // Dynamic signature data for EIP-1271
 *     dynamic: true
 *   }
 * ]);
 * // Returns: static part (130 bytes) + dynamic part (length + data)
 * // Contract signature encoded as: padded address + offset + 0x00
 * ```
 */
function encodeSafeSignaturesBytes(
	signatures: readonly PicosafeSignature[],
): Hex {
	if (signatures.length === 0) {
		throw new Error("Cannot encode empty signatures array");
	}

	const sortedSignatures = [...signatures].sort((a, b) =>
		a.signer.toLowerCase().localeCompare(b.signer.toLowerCase()),
	);

	let staticPart = "";
	let dynamicPart = "";

	for (const signature of sortedSignatures) {
		// Handle ApprovedHashSignature without data field
		let signatureData: string;
		if (!("data" in signature)) {
			// This is an ApprovedHashSignature without data - generate the signature bytes
			const approvedHashBytes = getApprovedHashSignatureBytes(signature.signer);
			signatureData = approvedHashBytes.slice(2);
		} else {
			signatureData = signature.data.slice(2);
		}

		if ("dynamic" in signature && signature.dynamic) {
			// Calculate offset for dynamic data
			const dynamicOffset =
				sortedSignatures.length * ECDSA_SIGNATURE_LENGTH_BYTES +
				dynamicPart.length / 2;

			// Static part: signer address (32) + offset (32) + signature type (1)
			const paddedSigner = padStartHex(signature.signer);
			const offsetHex = padStartHex(dynamicOffset.toString(16));
			staticPart += concatHex(paddedSigner, offsetHex, "00").slice(2);

			// Dynamic part: length (32) + data
			const dataLength = padStartHex(
				(signatureData.length / 2).toString(16),
				32,
			);
			dynamicPart += concatHex(dataLength, signatureData).slice(2);
		} else {
			// Standard ECDSA signature - validate length
			if (signatureData.length !== ECDSA_SIGNATURE_LENGTH_HEX) {
				throw new Error(
					`Invalid ECDSA signature length: expected ${ECDSA_SIGNATURE_LENGTH_BYTES} bytes (${ECDSA_SIGNATURE_LENGTH_HEX} hex chars), got ${signatureData.length / 2} bytes (${signatureData.length} hex chars)`,
				);
			}
			staticPart += signatureData;
		}
	}

	return concatHex(staticPart, dynamicPart);
}

/**
 * Parameters for on-chain signature verification using Safe's checkNSignatures
 * @property {Address} safeAddress - The Safe contract address
 * @property {Hex} dataHash - The hash of the data that was signed
 * @property {Hex} data - The original data that was signed
 * @property {SafeSignaturesParam} signatures - Array of signatures to verify or encoded signatures hex
 * @property {bigint} requiredSignatures - Number of valid signatures required
 */
type CheckNSignaturesVerificationParams = {
	dataHash: Hex;
	data: Hex;
	signatures: SafeSignaturesParam;
	requiredSignatures: bigint;
	block?: PicosafeRpcBlockIdentifier;
};

/**
 * Verifies Safe signatures by calling the Safe contract's checkNSignatures function on-chain
 *
 * This function calls the Safe contract's checkNSignatures method to verify
 * that the provided signatures are valid for the given data hash. The Safe contract
 * performs comprehensive validation including:
 *
 * - ECDSA signature recovery and verification
 * - EIP-1271 contract signature validation
 * - Pre-approved hash checking
 * - Owner validation and ordering checks
 * - Duplicate signer prevention
 *
 * The function gracefully handles reverts - if the Safe contract reverts (invalid
 * signatures), this function returns false rather than throwing.
 *
 * Signature validation rules enforced by Safe:
 * - Signers must be current Safe owners
 * - Signers must be ordered by address (ascending)
 * - No duplicate signers allowed
 * - Contract signatures (v=0) call isValidSignature on the signer
 * - Pre-validated signatures (v=1) check approvedHashes mapping
 * - ECDSA signatures use ecrecover with appropriate hash handling
 *
 * @param provider - EIP-1193 provider to interact with the blockchain
 * @param safeAddress - Address of the Safe contract
 * @param params - Verification parameters
 * @param params.dataHash - The hash of the data that was signed (transaction hash or message hash)
 * @param params.data - The original data that was signed (used for EIP-1271 validation)
 * @param params.signatures - Array of signatures to verify or encoded signatures hex
 * @param params.requiredSignatures - Number of valid signatures required (must be > 0 and <= threshold)
 * @param params.block - Optional block number or tag to use for the RPC call
 * @returns Promise that resolves to true if signatures are valid, false otherwise
 * @throws {Error} If requiredSignatures is <= 0
 * @example
 * ```typescript
 * import { checkNSignatures, buildSafeTransaction, calculateSafeTransactionHash } from "picosafe";
 *
 * // Build a Safe transaction
 * const safeTx = buildSafeTransaction({
 *   to: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fA8e",
 *   value: 0n,
 *   data: "0x",
 *   // ... other parameters
 * });
 *
 * // Calculate transaction hash
 * const txHash = await calculateSafeTransactionHash(provider, safeAddress, safeTx);
 *
 * // Verify signatures for the transaction
 * const isValid = await checkNSignatures(provider, safeAddress, {
 *   dataHash: txHash,
 *   data: "0x", // Original data (empty for ETH transfer)
 *   signatures: [
 *     { signer: "0x...", data: "0x..." }, // ECDSA signature
 *     { signer: "0x...", data: "0x...", dynamic: true } // Contract signature
 *   ],
 *   requiredSignatures: 2n
 * });
 * console.log('Signatures valid:', isValid);
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L274
 */
async function checkNSignatures(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	params: Readonly<CheckNSignaturesVerificationParams>,
): Promise<{
	valid: boolean;
	error?: Error;
}> {
	if (params.requiredSignatures <= 0n) {
		throw new Error("Required signatures must be greater than 0");
	}

	// checkNSignatures doesn't return anything on success
	// If we get a result, it should be "0x" (empty) for success
	// If calling an EOA, we'll get "0x" as well, but the call succeeds which is wrong
	// So we need to check if the contract exists first
	let [code, error] = await captureError(
		() =>
			provider.request({
				method: "eth_getCode",
				params: [safeAddress, params.block ?? "latest"],
			}),
		`Failed to get code for ${safeAddress}`,
	);

	// If there's no code at the address, it's not a contract
	if (error || code === "0x" || code === "0x0") {
		return { valid: false, error };
	}

	// We skip additional runtime validation checks (e.g., validating addresses, signature formats)
	// because the Safe contract's checkNSignatures function will handle all validation
	// and revert if signatures are invalid, which we catch and return as false
	let encodedSignatures: Hex;
	if (Array.isArray(params.signatures)) {
		// Handle empty array case - provide minimal valid signature bytes
		if (params.signatures.length === 0) {
			encodedSignatures = "0x";
		} else {
			encodedSignatures = encodeSafeSignaturesBytes(params.signatures);
		}
	} else {
		encodedSignatures = params.signatures as Hex;
	}

	const data = encodeFunctionData({
		abi: PARSED_SAFE_ABI,
		functionName: "checkNSignatures",
		args: [
			params.dataHash,
			params.data,
			encodedSignatures,
			params.requiredSignatures,
		],
	});

	// CheckNSignatures doesn't return anything on success, that's why we omit the result
	[, error] = await captureError(
		() =>
			provider.request({
				method: "eth_call",
				params: [
					{
						to: safeAddress,
						data,
					},
					params.block ?? "latest",
				],
			}),
		`checkNSignatures failed for ${safeAddress}`,
	);

	if (error) {
		return { valid: false, error };
	}

	return { valid: true };
}

/**
 * Helper to safely read dynamic data with bounds checking
 * @internal
 */
function readDynamicData(
	data: string,
	offset: number,
): { length: number; data: Hex } {
	const lengthOffset = offset;

	// Check if we can read the length (64 hex chars = 32 bytes)
	if (lengthOffset + 64 > data.length) {
		throw new Error(
			`Invalid signature: cannot read length at offset ${lengthOffset}, data length is ${data.length}`,
		);
	}

	const dataLength =
		Number.parseInt(data.slice(lengthOffset, lengthOffset + 64), 16) * 2;

	// Check if the calculated data range is within bounds
	if (lengthOffset + 64 + dataLength > data.length) {
		throw new Error(
			`Invalid signature: data range [${lengthOffset + 64}, ${lengthOffset + 64 + dataLength}] exceeds data length ${data.length}`,
		);
	}

	return {
		length: dataLength,
		data: `0x${data.slice(lengthOffset + 64, lengthOffset + 64 + dataLength)}`,
	};
}

/**
 * Decodes Safe signature bytes back into individual signature components
 *
 * Parses the concatenated signature format used by Safe contracts back into
 * an array of individual {@link PicoSafeSignature} objects. This function performs
 * signature recovery for ECDSA signatures to populate the signer address field.
 *
 * The function handles all Safe signature types as defined by {@link SignatureTypeVByte}:
 * - `CONTRACT` (v=0): EIP-1271 contract signatures with dynamic data
 * - `APPROVED_HASH` (v=1): Pre-approved hash signatures
 * - `EIP712_RECID_1/2` (v=27/28): EIP-712 typed data signatures
 * - `ETH_SIGN_RECID_1/2` (v=31/32): eth_sign/personal_sign signatures
 *
 * For ECDSA signatures (EIP-712 and eth_sign), the function performs signature
 * recovery to determine the signer address from the signature data and signed hash.
 * For contract and pre-approved signatures, the signer address is extracted from
 * the encoded signature data itself.
 *
 * @param encodedSignatures - The encoded signatures hex string to decode
 * @param signedHash - The 32-byte hash that was signed. For Safe transactions, this is the
 *                     result of calculateSafeTransactionHash. For messages, this is the hash
 *                     of the message (not the raw message itself). The Safe contract expects
 *                     this to be a hash for all signature types:
 *                     - EIP-712: Used directly with ecrecover
 *                     - eth_sign: Safe applies "\x19Ethereum Signed Message:\n32" prefix internally
 *                     - Contract: Passed to isValidSignature
 *                     - Approved: Checked against approvedHashes mapping
 * @returns Array of {@link PicoSafeSignature} objects with recovered signer addresses
 * @throws {Error} If signature data is malformed, has invalid type bytes, or offsets are invalid
 * @example
 * ```typescript
 * import { decodeSafeSignatureBytesToPicosafeSignatures, calculateSafeTransactionHash } from "picosafe";
 *
 * // Decode EIP-712 signature with recovery
 * const txHash = await calculateSafeTransactionHash(provider, safeAddress, safeTx);
 * const decoded = await decodeSafeSignatureBytesToPicosafeSignatures(
 *   "0x" + "a".repeat(64) + "1b", // r (32) + s (32) + v=27 (EIP-712)
 *   txHash
 * );
 * console.log(decoded);
 * // [{ signer: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fA8e", data: "0x..." + "1b" }]
 * ```
 *
 * @example
 * ```typescript
 * import { decodeSafeSignatureBytesToPicosafeSignatures, encodeSafeSignaturesBytes } from "picosafe";
 *
 * // Round-trip encoding/decoding with mixed signature types
 * const signatures = [
 *   {
 *     signer: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fA8e",
 *     data: "0x" + "a".repeat(64) + "1c" // EIP-712 signature
 *   },
 *   {
 *     signer: "0x1234567890123456789012345678901234567890",
 *     data: "0x" + "b".repeat(130), // EIP-1271 contract signature
 *     dynamic: true
 *   }
 * ];
 *
 * const encoded = encodeSafeSignaturesBytes(signatures);
 * const decoded = await decodeSafeSignatureBytesToPicosafeSignatures(encoded, txHash);
 * // All signers are recovered/extracted correctly
 * ```
 *
 * @example
 * ```typescript
 * import { decodeSafeSignatureBytesToPicosafeSignatures, SignatureTypeVByte } from "picosafe";
 *
 * // Decode pre-approved hash signature
 * const encoded = "0x" +
 *   "000000000000000000000000" + "742d35cc6634c0532925a3b844bc9e7595f8fa8e" +
 *   "0000000000000000000000000000000000000000000000000000000000000000" +
 *   "01"; // v=1 (APPROVED_HASH)
 *
 * const decoded = await decodeSafeSignatureBytesToPicosafeSignatures(encoded, txHash);
 * console.log(decoded);
 * // [{ signer: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fA8e", data: "0x..." }]
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L274
 */
async function decodeSafeSignatureBytesToPicosafeSignatures(
	encodedSignatures: Hex,
	signedHash: Hex,
): Promise<PicosafeSignature[]> {
	const signatures: PicosafeSignature[] = [];
	const data = encodedSignatures.slice(2); // Remove 0x prefix

	let offset = 0;
	const staticLength = ECDSA_SIGNATURE_LENGTH_HEX;

	while (offset < data.length) {
		if (offset + staticLength > data.length) break;

		const signatureData = data.slice(offset, offset + staticLength);
		const v = Number.parseInt(signatureData.slice(-2), 16);

		if (v === SignatureTypeVByte.CONTRACT) {
			// Dynamic signature - extract signer and offset
			const signer = checksumAddress(`0x${signatureData.slice(24, 64)}`);
			const dynamicOffset =
				Number.parseInt(signatureData.slice(64, 128), 16) * 2;

			// Check that dynamicOffset is within bounds to read the length field (32 bytes)
			if (dynamicOffset + 64 > data.length) {
				throw new Error(
					`Invalid signature: dynamicOffset ${dynamicOffset} is out of bounds to read length, data length is ${data.length}`,
				);
			}

			// Read dynamic data using helper
			const { data: dynamicData } = readDynamicData(data, dynamicOffset);

			signatures.push({
				signer,
				data: dynamicData,
				dynamic: true,
			});
		} else if (v === SignatureTypeVByte.APPROVED_HASH) {
			// Pre-approved hash signature - extract from position
			signatures.push({
				signer: checksumAddress(`0x${signatureData.slice(24, 64)}`),
				data: `0x${signatureData}`,
			});
		} else if (
			v === SignatureTypeVByte.EIP712_RECID_1 ||
			v === SignatureTypeVByte.EIP712_RECID_2
		) {
			// Static signature - extract from position
			const signature: Hex = `0x${signatureData}`;
			const signer = await recoverAddress({
				hash: signedHash,
				signature,
			});
			signatures.push({
				data: signature,
				signer,
			});
		} else if (
			v === SignatureTypeVByte.ETH_SIGN_RECID_1 ||
			v === SignatureTypeVByte.ETH_SIGN_RECID_2
		) {
			// ECDSA signature - extract from position
			const signature: Hex = `0x${signatureData}`;
			const signer = await recoverAddress({
				hash: hashMessage(signedHash),
				signature,
			});
			signatures.push({
				data: signature,
				signer,
			});
		} else {
			throw new Error(
				`Invalid signature type: ${v} (expected ${SignatureTypeVByte.CONTRACT}, ${SignatureTypeVByte.APPROVED_HASH}, ${SignatureTypeVByte.EIP712_RECID_1}, ${SignatureTypeVByte.EIP712_RECID_2}, ${SignatureTypeVByte.ETH_SIGN_RECID_1}, ${SignatureTypeVByte.ETH_SIGN_RECID_2})`,
			);
		}

		offset += staticLength;
	}

	return signatures;
}

/**
 * Extracts and returns the signature type from the v-byte of a Safe signature
 *
 * Safe signatures always end with a type byte (v-byte) that indicates how the
 * signature should be validated. This function extracts that byte and returns
 * the corresponding {@link SignatureTypeVByte} enum value.
 *
 * For standard 65-byte signatures, the v-byte is simply the last byte.
 * For dynamic signatures (like EIP-1271), you should pass the 65-byte static
 * header portion that contains the v-byte at position 64.
 *
 * @param signature - Hex-encoded signature (at least 65 bytes). Must include
 *                    the v-byte as the last byte of the provided data.
 * @returns The {@link SignatureTypeVByte} enum value corresponding to the v-byte
 * @throws {Error} If signature is shorter than 65 bytes (130 hex chars)
 * @throws {Error} If the v-byte value is not a recognized signature type
 * @example
 * ```typescript
 * import { getSignatureTypeVByte, SignatureTypeVByte } from "picosafe";
 *
 * // EIP-712 signature with v=27
 * const eip712Sig = "0x" + "a".repeat(64) + "1b"; // v=27
 * const type1 = getSignatureTypeVByte(eip712Sig);
 * console.log(type1 === SignatureTypeVByte.EIP712_RECID_1); // true
 *
 * // eth_sign signature with v=31
 * const ethSignSig = "0x" + "b".repeat(64) + "1f"; // v=31
 * const type2 = getSignatureTypeVByte(ethSignSig);
 * console.log(type2 === SignatureTypeVByte.ETH_SIGN_RECID_1); // true
 *
 * // Contract signature header with v=0
 * const contractSigHeader = "0x" + "00".repeat(64) + "00"; // v=0
 * const type3 = getSignatureTypeVByte(contractSigHeader);
 * console.log(type3 === SignatureTypeVByte.CONTRACT); // true
 * ```
 * @see {@link SignatureTypeVByte} for all possible signature types
 */
function getSignatureTypeVByte(signature: Hex): SignatureTypeVByte {
	if (signature.length < ECDSA_SIGNATURE_LENGTH_HEX + 2) {
		// +2 for '0x' prefix
		throw new Error("Signature too short to determine v-byte");
	}

	const vByte = Number.parseInt(signature.slice(-2), 16);

	switch (vByte) {
		case SignatureTypeVByte.CONTRACT:
		case SignatureTypeVByte.APPROVED_HASH:
		case SignatureTypeVByte.EIP712_RECID_1:
		case SignatureTypeVByte.EIP712_RECID_2:
		case SignatureTypeVByte.ETH_SIGN_RECID_1:
		case SignatureTypeVByte.ETH_SIGN_RECID_2:
			return vByte;
		default:
			throw new Error(`Unknown signature v-byte: ${vByte}`);
	}
}

type SignaturesValidationParams = SignatureValidationContext & {
	signatures: SafeSignaturesParam;
};

type SafeConfigurationForValidation = {
	threshold?: bigint;
	owners?: Address[];
};

/**
 * Validates signatures and verifies signers are Safe owners with sufficient threshold
 *
 * This function performs complete Safe signature validation by:
 * 1. Validating each signature cryptographically (ECDSA recovery, EIP-1271, or pre-approved)
 * 2. Verifying that each valid signer is a current Safe owner
 * 3. Checking that the number of valid owner signatures meets the Safe's threshold
 *
 * This is the recommended function for validating Safe signatures as it performs
 * all necessary checks. For lower-level validation without owner checks, use
 * `validateSignature` from signature-validation.ts.
 *
 * The function accepts signatures either as an array of {@link PicosafeSignature} objects
 * or as an encoded hex string (which will be decoded automatically).
 *
 * @param provider - EIP-1193 provider to interact with the blockchain
 * @param safeAddress - Address of the Safe contract
 * @param validationParams - Parameters for signature validation
 * @param validationParams.signatures - Array of signatures or encoded signatures hex
 * @param validationParams.data - Optional original data that was signed. Only required for EIP-1271 signatures.
 * @param validationParams.dataHash - The hash of the data
 * @param safeConfig - Optional Safe configuration to avoid fetching from chain
 * @param safeConfig.threshold - The minimum number of signatures required
 * @param safeConfig.owners - Array of current Safe owner addresses
 * @returns Promise resolving to validation results
 * @returns result.valid - True if enough valid owner signatures are present
 * @returns result.results - Array of individual signature validation results
 * @example
 * ```typescript
 * import { validateSignaturesForSafe, calculateSafeTransactionHash, buildSafeTransaction } from "picosafe";
 *
 * // Build and hash a Safe transaction
 * const safeTx = buildSafeTransaction({
 *   to: recipient,
 *   value: 0n,
 *   data: "0x",
 *   // ... other params
 * });
 * const txHash = await calculateSafeTransactionHash(provider, safeAddress, safeTx);
 *
 * // Validate signatures from multiple owners
 * const signatures = [
 *   { signer: owner1, data: await signTransaction(owner1, txHash) },
 *   { signer: owner2, data: await signTransaction(owner2, txHash) },
 *   { signer: smartWallet, data: contractSigData, dynamic: true }
 * ];
 *
 * const validation = await validateSignaturesForSafe(
 *   provider,
 *   safeAddress,
 *   {
 *     signatures,
 *     data: encodeSafeTransaction(safeTx),
 *     dataHash: txHash
 *   }
 * );
 *
 * if (validation.valid) {
 *   console.log('Signatures are valid and threshold is met');
 *   // Can now execute the transaction
 * } else {
 *   console.log('Invalid signatures:', validation.results.filter(r => !r.valid));
 * }
 * ```
 * @example
 * ```typescript
 * import { validateSignaturesForSafe, encodeSafeSignaturesBytes } from "picosafe";
 *
 * // Validate pre-encoded signatures
 * const encodedSigs = encodeSafeSignaturesBytes(signatures);
 * const validation = await validateSignaturesForSafe(
 *   provider,
 *   safeAddress,
 *   {
 *     signatures: encodedSigs, // Pass encoded hex instead of array
 *     data: "0x",
 *     dataHash: messageHash
 *   },
 *   {
 *     // Optionally provide config to avoid chain calls
 *     threshold: 2n,
 *     owners: [owner1, owner2, owner3]
 *   }
 * );
 * ```
 * @see {@link validateSignature} for single signature validation
 * @see {@link checkNSignatures} for on-chain validation via Safe contract
 */
async function validateSignaturesForSafe(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	validationParams: SignaturesValidationParams,
	safeConfig?: SafeConfigurationForValidation,
): Promise<{
	valid: boolean;
	results: SignatureValidationResult<PicosafeSignature>[];
}> {
	const safeOwners =
		safeConfig?.owners ?? (await getOwners(provider, safeAddress));
	const requiredSignatures =
		safeConfig?.threshold ?? (await getThreshold(provider, safeAddress));
	const seenOwners = new Set<Address>();

	const signatures = Array.isArray(validationParams.signatures)
		? (validationParams.signatures as PicosafeSignature[])
		: await decodeSafeSignatureBytesToPicosafeSignatures(
				validationParams.signatures as Hex,
				validationParams.dataHash,
			);

	let validSignaturesCount = 0;
	const results: SignatureValidationResult<PicosafeSignature>[] = [];

	for (const signature of signatures) {
		let result: SignatureValidationResult<PicosafeSignature>;

		if (isApprovedHashSignature(signature)) {
			// ApprovedHashSignature - requires dataHash and safeAddress
			result = await validateSignature(provider, signature, {
				dataHash: validationParams.dataHash,
				safeAddress,
			});
		} else if (isDynamicSignature(signature)) {
			// DynamicSignature - requires data or dataHash
			if (validationParams.data) {
				result = await validateSignature(provider, signature, {
					data: validationParams.data,
				});
			} else {
				result = await validateSignature(provider, signature, {
					dataHash: validationParams.dataHash,
				});
			}
		} else if (isECDSASignature(signature)) {
			// ECDSASignature - requires only dataHash
			result = await validateSignature(provider, signature, {
				dataHash: validationParams.dataHash,
			});
		} else {
			// This should never happen due to type exhaustiveness
			throw new Error("Unknown signature type");
		}

		if (
			result.valid &&
			result.validatedSigner &&
			safeOwners.includes(result.validatedSigner) &&
			!seenOwners.has(result.validatedSigner)
		) {
			validSignaturesCount++;
			seenOwners.add(result.validatedSigner);
		}

		results.push(result);
	}

	return {
		valid: validSignaturesCount >= requiredSignatures,
		results,
	};
}

/**
 * Creates a pre-approved hash signature for a Safe owner
 *
 * Pre-approved hash signatures are used when a Safe owner has already approved
 * a specific transaction or message hash on-chain using the Safe's `approveHash`
 * function. This creates a signature that the Safe contract will validate by
 * checking its internal `approvedHashes` mapping instead of performing ECDSA
 * recovery or EIP-1271 validation.
 *
 * The signature format is a 65-byte structure:
 * - Bytes 0-31: Owner address padded to 32 bytes
 * - Bytes 32-63: Padded zeros (unused for approved hash signatures)
 * - Byte 64: Signature type (v=1 for {@link SignatureTypeVByte.APPROVED_HASH})
 *
 * This type of signature is gas-efficient for execution since it only requires
 * a simple mapping lookup, but requires a separate transaction to pre-approve
 * the hash before it can be used.
 *
 * @param signer - The address of the Safe owner who has pre-approved the hash
 * @returns A 65-byte hex string representing the approved hash signature
 * @example
 * ```typescript
 * import { getApprovedHashSignatureBytes, approveHash, calculateSafeTransactionHash } from "picosafe";
 *
 * // First, owner approves a transaction hash on-chain
 * const safeTx = buildSafeTransaction({
 *   to: recipient,
 *   value: 0n,
 *   data: "0x",
 *   // ... other params
 * });
 * const txHash = await calculateSafeTransactionHash(provider, safeAddress, safeTx);
 *
 * // Owner approves the hash
 * await approveHash(provider, safeAddress, txHash).send();
 *
 * // Create the approved hash signature
 * const approvedSig = getApprovedHashSignatureBytes(ownerAddress);
 * console.log(approvedSig);
 * // "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f8fa8e01"
 *
 * // Use with other signatures for transaction execution
 * const signatures = [
 *   { signer: owner1, data: ecdsaSignature },
 *   { signer: owner2, data: approvedSig }  // Pre-approved signature
 * ];
 * ```
 * @see {@link SignatureTypeVByte} for signature type constants
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L274
 */
function getApprovedHashSignatureBytes(signer: Address): Hex {
	return concatHex(
		padStartHex(signer, 32), // Next 32 bytes are the signer address
		padStartHex("00", 32), // First 32 bytes are zeros for approved hash
		SignatureTypeVByte.APPROVED_HASH.toString(16).padStart(2, "0"), // v-byte
	);
}

export {
	encodeSafeSignaturesBytes,
	decodeSafeSignatureBytesToPicosafeSignatures,
	checkNSignatures,
	validateSignature,
	validateSignaturesForSafe,
	getSignatureTypeVByte,
	getApprovedHashSignatureBytes,
};
