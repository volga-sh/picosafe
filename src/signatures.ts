import type { Address, Hex } from "viem";
import {
	decodeFunctionResult,
	encodeFunctionData,
	hashMessage,
	isHex,
	recoverAddress,
} from "viem";
import { PARSED_SAFE_ABI } from "./abis.js";
import type {
	EIP1193ProviderWithRequestFn,
	PicoSafeRpcBlockIdentifier,
	SafeContractSignature,
	SafeSignature,
	UnidentifiedSafeSignature,
} from "./types";
import { SignatureType } from "./types.js";
import { checksumAddress } from "./utilities/address.js";
import { concatHex, padStartHex } from "./utilities/encoding.js";

/**
 * Union type for signature parameters that can be either an array of SafeSignature objects or encoded hex
 */
type SafeSignaturesParam = readonly SafeSignature[] | Hex;

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
 * @throws {Error} If any signature data is invalid format
 * @example
 * ```typescript
 * import { encodeSafeSignatures } from "picosafe";
 *
 * // Encode standard ECDSA signatures from two owners
 * const encoded = encodeSafeSignatures([
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
 * import { encodeSafeSignatures, signSafeTransaction } from "picosafe";
 *
 * // Use with Safe transaction execution
 * const signatures = await Promise.all(
 *   owners.map(async (owner) => ({
 *     signer: owner.address,
 *     data: await signSafeTransaction(provider, safeAddress, tx, owner.address)
 *   }))
 * );
 * const encodedSigs = encodeSafeSignatures(signatures);
 * await executeSafeTransaction(provider, safeAddress, tx, signatures);
 * ```
 *
 * @example
 * ```typescript
 * import { encodeSafeSignatures } from "picosafe";
 *
 * // Encode mixed signature types including contract signature
 * const encoded = encodeSafeSignatures([
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
function encodeSafeSignatures(signatures: readonly SafeSignature[]): Hex {
	const ECDSA_SIGNATURE_LENGTH = 65;

	const sortedSignatures = [...signatures].sort((a, b) =>
		a.signer.toLowerCase().localeCompare(b.signer.toLowerCase()),
	);

	let staticPart = "";
	let dynamicPart = "";

	for (const signature of sortedSignatures) {
		const signatureData = signature.data.slice(2);

		if (signature.dynamic) {
			// Dynamic signature encoding (e.g., EIP-1271 contract signatures)
			// Calculate offset for dynamic data
			const dynamicOffset =
				sortedSignatures.length * ECDSA_SIGNATURE_LENGTH +
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
			// Standard ECDSA signature
			staticPart += signatureData;
		}
	}

	return concatHex(staticPart, dynamicPart);
}

/**
 * Determines the type of a Safe signature based on its v value
 *
 * Safe signatures are differentiated by their v value:
 * - v = 0: Contract signature (EIP-1271) - signer is a smart contract
 * - v = 1: Pre-approved hash - hash was approved via approveHash()
 * - v = 27/28: ECDSA signature with EIP-712 (structured data)
 * - v = 31/32: ECDSA signature with eth_sign (adjusted v = 27/28 + 4)
 *
 * @param signature - The signature to analyze
 * @returns The signature type (EIP712, ETH_SIGN, CONTRACT, or APPROVED_HASH)
 * @throws {Error} If ECDSA signature has invalid length or v value was unknown
 */
function parseSignatureType(signature: SafeSignature): SignatureType {
	// Dynamic (EIP-1271) signatures are identified separately
	if (signature.dynamic) {
		return SignatureType.CONTRACT;
	}

	// All static (ECDSA / approved hash) signatures must be 65 bytes (0x + 128/130 hex chars)
	if (signature.data.length !== 130 && signature.data.length !== 132) {
		throw new Error("Invalid ECDSA signature length");
	}

	const vByte = BigInt(signature.data.slice(-2));

	switch (vByte) {
		case 1n:
			return SignatureType.APPROVED_HASH;
		case 27n:
		case 28n:
			return SignatureType.EIP712;
		case 31n:
		case 32n:
			return SignatureType.ETH_SIGN;
		default:
			throw new Error("Invalid signature type");
	}
}

/**
 * Detailed validation result for a single signature
 * @property {Address} signer - The address that created the signature
 * @property {boolean} isValid - Whether the signature is valid
 * @property {SignatureType} type - The type of signature (ecdsa/contract/approved)
 * @property {string} error - Error message if signature is invalid
 */
type SignatureValidationDetails = {
	signer: Address;
	isValid: boolean;
	type: SignatureType;
	error?: string;
};

/**
 * Result of off-chain signature verification
 * @property {boolean} isValid - Whether enough valid signatures were found
 * @property {number} validSignatures - Number of valid signatures found
 * @property {SignatureValidationDetails[]} details - Per-signature validation details
 */
type SignatureVerificationResult = {
	isValid: boolean;
	validSignatures: number;
	details: SignatureValidationDetails[];
};

/**
 * Parameters for on-chain signature verification using Safe's checkNSignatures
 * @property {Address} safeAddress - The Safe contract address
 * @property {Hex} dataHash - The hash of the data that was signed
 * @property {Hex} data - The original data that was signed
 * @property {SafeSignaturesParam} signatures - Array of signatures to verify or encoded signatures hex
 * @property {bigint} requiredSignatures - Number of valid signatures required
 */
type VerifySafeSignaturesParams = {
	dataHash: Hex;
	data: Hex;
	signatures: SafeSignaturesParam;
	requiredSignatures: bigint;
	block?: PicoSafeRpcBlockIdentifier;
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
 * @param params.requiredSignatures - Number of valid signatures required (must be <= threshold)
 * @param params.block - Optional block number or tag to use for the RPC call
 * @returns Promise that resolves to true if signatures are valid, false otherwise
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
	provider: EIP1193ProviderWithRequestFn,
	safeAddress: Address,
	params: VerifySafeSignaturesParams,
): Promise<boolean> {
	const encodedSignatures = isHex(params.signatures)
		? params.signatures
		: encodeSafeSignatures(params.signatures);

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

	// The call reverts if the signatures are invalid, so we catch the error and return false
	try {
		await provider.request({
			method: "eth_call",
			params: [
				{
					to: safeAddress,
					data,
				},
				params.block ?? "latest",
			],
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Parameters for off-chain signature verification with minimal on-chain calls
 * @property {Address} safeAddress - The Safe contract address
 * @property {bigint} chainId - The chain ID for domain separator calculation
 * @property {Hex} dataHash - The hash of the data that was signed
 * @property {Hex} data - The original data that was signed
 * @property {SafeSignaturesParam} signatures - Array of signatures to verify or encoded signatures hex
 * @property {readonly Address[]} owners - Array of Safe owner addresses
 * @property {bigint} threshold - Number of valid signatures required
 */
type VerifySafeSignaturesOffchainParams = {
	dataHash: Hex;
	data: Hex;
	signatures: SafeSignaturesParam;
	owners: readonly Address[];
	threshold: bigint;
};

/**
 * Verifies Safe signatures off-chain with minimal on-chain calls
 *
 * This function performs signature verification primarily off-chain for efficiency,
 * only making on-chain calls when necessary (for contract signatures via EIP-1271
 * and checking approved hashes). It validates each signature individually and
 * provides detailed results.
 *
 * @param provider - EIP-1193 provider to interact with the blockchain
 * @param safeAddress - Address of the Safe contract
 * @param params - Verification parameters
 * @param params.dataHash - The hash of the data that was signed
 * @param params.data - The original data that was signed
 * @param params.signatures - Array of signatures to verify or encoded signatures hex
 * @param params.owners - Array of Safe owner addresses
 * @param params.threshold - Number of valid signatures required
 * @returns Detailed verification result with per-signature validation details
 * @example
 * ```typescript
 * import { verifySafeSignaturesOffchain } from "picosafe";
 *
 * // Verify signatures with detailed results
 * const result = await verifySafeSignaturesOffchain(provider, safeAddress, {
 *   dataHash: "0x...",
 *   data: "0x...",
 *   signatures: [
 *     { signer: owner1, data: signature1 },
 *     { signer: owner2, data: signature2 }
 *   ],
 *   owners: [owner1, owner2, owner3],
 *   threshold: 2n
 * });
 *
 * console.log('Valid:', result.isValid);
 * console.log('Valid signatures:', result.validSignatures);
 * result.details.forEach(detail => {
 *   console.log(`${detail.signer}: ${detail.isValid} (${detail.type})`);
 * });
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L274
 */
async function checkSafeSignaturesOffchain(
	provider: EIP1193ProviderWithRequestFn,
	safeAddress: Address,
	params: VerifySafeSignaturesOffchainParams,
): Promise<SignatureVerificationResult> {
	const signatures = Array.isArray(params.signatures)
		? params.signatures
		: decodeSafeSignatureBytes(params.signatures as Hex);

	const ownerSet = new Set(params.owners.map((owner) => owner.toLowerCase()));

	const details: SignatureValidationDetails[] = [];
	let validSignatures = 0;

	// Calculate message hash for eth_sign recovery
	const messageHash = hashMessage({ raw: params.dataHash });

	for (const signature of signatures) {
		const signerLower = signature.signer.toLowerCase();
		const signatureType = parseSignatureType(signature);

		// Check if signer is an owner
		if (!ownerSet.has(signerLower)) {
			details.push({
				signer: checksumAddress(signature.signer),
				isValid: false,
				type: signatureType,
				error: "Signer is not an owner",
			});
			continue;
		}

		let isValid = false;
		let error: string | undefined;

		try {
			switch (signatureType) {
				case SignatureType.APPROVED_HASH: {
					// Check if hash is approved on-chain
					const data = encodeFunctionData({
						abi: PARSED_SAFE_ABI,
						functionName: "approvedHashes",
						args: [signature.signer, params.dataHash],
					});

					const result = await provider.request({
						method: "eth_call",
						params: [
							{
								to: safeAddress,
								data,
							},
							"latest",
						],
					});

					const approvalTime = decodeFunctionResult({
						abi: PARSED_SAFE_ABI,
						functionName: "approvedHashes",
						data: result,
					}) as bigint;

					isValid = approvalTime > 0n;
					if (!isValid) {
						error = "Hash not approved";
					}
					break;
				}

				case SignatureType.CONTRACT: {
					// Verify via EIP-1271
					const data = encodeFunctionData({
						abi: PARSED_SAFE_ABI,
						functionName: "isValidSignature",
						args: [params.dataHash, signature.data],
					});

					try {
						const result = await provider.request({
							method: "eth_call",
							params: [
								{
									to: signature.signer,
									data,
								},
								"latest",
							],
						});

						// EIP-1271 magic value: 0x1626ba7e
						isValid =
							result === "0x1626ba7e" ||
							result ===
								"0x1626ba7e00000000000000000000000000000000000000000000000000000000";
						if (!isValid) {
							error = "Invalid EIP-1271 signature";
						}
					} catch {
						isValid = false;
						error = "Contract signature verification failed";
					}
					break;
				}

				case SignatureType.EIP712:
				case SignatureType.ETH_SIGN: {
					const hashToRecover =
						signatureType === SignatureType.ETH_SIGN
							? messageHash
							: params.dataHash;

					try {
						const recoveredAddress = await recoverAddress({
							hash: hashToRecover,
							signature: signature.data,
						});

						isValid = recoveredAddress.toLowerCase() === signerLower;
						if (!isValid) {
							error = `Recovered address ${recoveredAddress} does not match signer ${signature.signer}`;
						}
					} catch {
						isValid = false;
						error = "Failed to recover signer from signature";
					}
					break;
				}

				default:
					error = "Unknown signature type";
			}
		} catch (e) {
			isValid = false;
			error = e instanceof Error ? e.message : "Signature verification failed";
		}

		if (isValid) {
			validSignatures++;
		}

		details.push({
			signer: checksumAddress(signature.signer),
			isValid,
			type: signatureType,
			...(error && { error }),
		});
	}

	return {
		isValid: validSignatures >= Number(params.threshold),
		validSignatures,
		details,
	};
}

/**
 * Decodes Safe signatures from encoded hex format back to signature array
 *
 * Parses the concatenated signature bytes format used by Safe contracts and returns
 * an array of signature objects. The encoded format consists of 65-byte chunks where
 * each chunk contains either a standard ECDSA signature or a pointer to dynamic data.
 *
 * Signature Types by v value:
 * - v = 0: Contract signature (EIP-1271)
 * - v = 1: Pre-validated signature (approved hash)
 * - v > 1: ECDSA signature (v = 27/28 for eth_sign, v = 31/32 for EIP-712)
 *
 * For standard ECDSA signatures (v > 1):
 * - The 65 bytes contain the signature data directly: r (32) + s (32) + v (1)
 * - Returns as UnidentifiedSafeSignature (data only, no signer address recovered)
 *
 * For contract signatures (v == 0):
 * - Bytes 0-32: r = packed encoding of signer address (address(uint160(uint256(r))))
 * - Bytes 32-64: s = offset to dynamic data section (must be >= requiredSignatures * 65)
 * - Byte 64: v = 0 (signature type identifier)
 * - Dynamic data located at offset s contains: length (32 bytes) + signature data
 * - Returns as SafeSignature with signer address extracted from r
 *
 * For pre-validated signatures (v == 1):
 * - Uses same 65-byte format as ECDSA but with v = 1
 * - Indicates the hash was pre-approved by the signer
 * - Returns as UnidentifiedSafeSignature
 *
 * Note: This function does NOT recover signer addresses for ECDSA signatures. It only
 * extracts the raw signature bytes. Signer recovery for ECDSA signatures must be done
 * separately using the appropriate message hash (either the raw hash for EIP-712 or
 * the prefixed hash for eth_sign).
 *
 * @param encodedSignatures - Hex string containing concatenated Safe signatures
 * @returns Array of decoded signatures (UnidentifiedSafeSignature for ECDSA, SafeSignature for dynamic)
 * @throws {Error} If the encoded signatures format is invalid
 * @example
 * ```typescript
 * import { decodeSafeSignatureBytes } from "picosafe";
 *
 * // Decode a hex string containing two ECDSA signatures
 * const encoded = "0x" + "a".repeat(64) + "1b" + "b".repeat(64) + "1c";
 * const signatures = decodeSafeSignatureBytes(encoded);
 * // Returns: [
 * //   { data: "0x" + "a".repeat(64) + "1b" }, // v=27, ECDSA signature
 * //   { data: "0x" + "b".repeat(64) + "1c" }  // v=28, ECDSA signature
 * // ]
 * ```
 *
 * @example
 * ```typescript
 * import { decodeSafeSignatureBytes } from "picosafe";
 *
 * // Decode signatures with contract signature (EIP-1271)
 * // Example from Safe contracts documentation
 * const encoded = "0x" +
 *   "0000000000000000000000000000000000000000000000000000000000000001" + // r: signer address
 *   "00000000000000000000000000000000000000000000000000000000000000c3" + // s: offset to dynamic data
 *   "00" + // v: 0 for contract signature
 *   "b".repeat(64) + "1c" + // another ECDSA signature
 *   // Dynamic data at offset 0xc3 (195 bytes):
 *   "0000000000000000000000000000000000000000000000000000000000000008" + // length: 8 bytes
 *   "00000000deadbeef"; // signature data
 *
 * const signatures = decodeSafeSignatureBytes(encoded);
 * // Returns: [
 * //   { signer: "0x0000000000000000000000000000000000000001", data: "0x00000000deadbeef", dynamic: true },
 * //   { data: "0x" + "b".repeat(64) + "1c" }
 * // ]
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L274
 */
function decodeSafeSignatureBytes(
	encodedSignatures: Hex,
): (UnidentifiedSafeSignature | SafeContractSignature)[] {
	const signatures: (UnidentifiedSafeSignature | SafeContractSignature)[] = [];
	const data = encodedSignatures.slice(2); // Remove 0x prefix

	let offset = 0;
	const staticLength = 65 * 2; // 65 bytes in hex

	while (offset < data.length) {
		if (offset + staticLength > data.length) break;

		const signatureData = data.slice(offset, offset + staticLength);
		const v = Number.parseInt(signatureData.slice(-2), 16);

		if (v === 0) {
			// Dynamic signature - extract signer and offset
			const signer = checksumAddress(`0x${signatureData.slice(24, 64)}`);
			const dynamicOffset =
				Number.parseInt(signatureData.slice(40, 104), 16) * 2;

			// Read dynamic data
			const lengthOffset = dynamicOffset;
			const dataLength =
				Number.parseInt(data.slice(lengthOffset, lengthOffset + 64), 16) * 2;
			const dynamicData = data.slice(
				lengthOffset + 64,
				lengthOffset + 64 + dataLength,
			);

			signatures.push({
				signer,
				data: `0x${dynamicData}`,
				dynamic: true,
			});
		} else {
			// Static signature - extract from position
			signatures.push({
				data: `0x${signatureData}`,
			});
		}

		offset += staticLength;
	}

	return signatures;
}

export {
	encodeSafeSignatures,
	decodeSafeSignatureBytes,
	checkNSignatures,
	checkSafeSignaturesOffchain,
	parseSignatureType,
};

export type {
	SignatureValidationDetails,
	SignatureVerificationResult,
	VerifySafeSignaturesParams,
	VerifySafeSignaturesOffchainParams,
	SafeSignaturesParam,
};
