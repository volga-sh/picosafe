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
 * Encodes multiple signatures into the Safe signature format.
 *
 * Combines multiple signatures into a single hex string, sorted by signer
 * address in ascending order. This format is required by Safe contracts for
 * transaction execution with multiple signers.
 *
 * Supports two signature types:
 * - Standard ECDSA signatures (65 bytes): r (32) + s (32) + v (1)
 * - Dynamic signatures (e.g., EIP-1271 contract signatures): Variable length with
 *   a 65-byte header pointing to dynamic data appended at the end
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
 * // Returns: "0x" + sorted concatenated signatures
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
 * // Encode with a dynamic/contract signature (EIP-1271)
 * const encoded = encodeSafeSignatures([
 *   {
 *     signer: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
 *     data: "0x" + "a".repeat(64) + "1b", // Standard ECDSA
 *     dynamic: false
 *   },
 *   {
 *     signer: "0x5678901234567890123456789012345678901234", // Contract wallet
 *     data: "0x" + "c".repeat(130), // Dynamic signature data
 *     dynamic: true
 *   }
 * ]);
 * // Returns encoded signatures with dynamic data appended at the end
 * ```
 */
function encodeSafeSignatures(signatures: readonly SafeSignature[]): Hex {
	const ECDSA_SIGNATURE_LENGTH = 65;

	// Sort signatures by signer address (required by Safe contracts)
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
 * Determines the type of a Safe signature
 * @param signature - The signature to analyze
 * @returns The signature type (ecdsa, contract, or approved)
 */
function parseSignatureType(signature: SafeSignature): SignatureType {
	if (signature.dynamic) {
		return SignatureType.CONTRACT;
	}

	if (signature.data.length !== 130 && signature.data.length !== 132) {
		throw new Error("Invalid ECDSA signature length");
	}

	const vByte = BigInt(signature.data.slice(-2));
	if (vByte === 1n) {
		return SignatureType.APPROVED_HASH;
	}

	if (vByte > 30n) {
		return SignatureType.ETH_SIGN;
	}

	return SignatureType.EIP712;
}

/**
 * Extracts r, s, v components from an ECDSA signature
 * @param signature - The hex signature (65 bytes)
 * @returns Object with r, s, v components
 */
function extractSignatureComponents(signature: Hex): {
	r: Hex;
	s: Hex;
	v: bigint;
} {
	if (!isHex(signature) || signature.length !== 132) {
		// 0x + 130 hex chars = 65 bytes
		throw new Error("Invalid ECDSA signature length");
	}

	const data = signature.slice(2);
	const r = `0x${data.slice(0, 64)}` as Hex;
	const s = `0x${data.slice(64, 128)}` as Hex;
	const v = BigInt(`0x${data.slice(128, 130)}`);

	return { r, s, v };
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
};

/**
 * Verifies Safe signatures using the Safe contract's checkNSignatures function
 *
 * This function calls the Safe contract's checkNSignatures method to verify
 * that the provided signatures are valid for the given data hash. The function
 * will revert if the signatures are invalid or insufficient.
 *
 * @param provider - EIP-1193 provider to interact with the blockchain
 * @param safeAddress - Address of the Safe contract
 * @param params - Verification parameters
 * @param params.dataHash - The hash of the data that was signed
 * @param params.data - The original data that was signed
 * @param params.signatures - Array of signatures to verify or encoded signatures hex
 * @param params.requiredSignatures - Number of valid signatures required
 * @returns Promise that resolves to true if signatures are valid, false otherwise
 * @example
 * ```typescript
 * import { verifySafeSignatures } from "picosafe";
 *
 * // Verify signatures for a Safe transaction
 * const isValid = await verifySafeSignatures(provider, safeAddress, {
 *   dataHash: "0x...", // The transaction hash
 *   data: "0x...", // The transaction data
 *   signatures: [
 *     { signer: "0x...", data: "0x..." },
 *     { signer: "0x...", data: "0x..." }
 *   ],
 *   requiredSignatures: 2n
 * });
 * console.log('Signatures valid:', isValid);
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L274
 */
async function verifySafeSignatures(
	provider: EIP1193ProviderWithRequestFn,
	safeAddress: Address,
	params: VerifySafeSignaturesParams,
): Promise<boolean> {
	// Encode signatures if they're provided as SafeSignature array
	const encodedSignatures = isHex(params.signatures)
		? params.signatures
		: encodeSafeSignatures(params.signatures);

	// Encode the checkNSignatures call
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

	try {
		// Call the Safe contract - it will revert if signatures are invalid
		await provider.request({
			method: "eth_call",
			params: [
				{
					to: safeAddress,
					data,
				},
				"latest",
			],
		});
		return true;
	} catch {
		// The contract reverted, signatures are invalid
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
async function verifySafeSignaturesOffchain(
	provider: EIP1193ProviderWithRequestFn,
	safeAddress: Address,
	params: VerifySafeSignaturesOffchainParams,
): Promise<SignatureVerificationResult> {
	// Parse signatures
	const signatures = Array.isArray(params.signatures)
		? params.signatures
		: decodeSafeSignatureBytes(params.signatures as Hex);

	// Create owner lookup set for efficient checking
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
					// Verify ECDSA signature off-chain
					const { r, s, v } = extractSignatureComponents(signature.data);

					// Determine which hash to use for recovery
					const hashToRecover =
						signatureType === SignatureType.ETH_SIGN
							? messageHash
							: params.dataHash;

					try {
						const recoveredAddress = await recoverAddress({
							hash: hashToRecover,
							signature: { r, s, v },
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
 * For standard ECDSA signatures (v != 0):
 * - The 65 bytes contain the signature data directly: r (32) + s (32) + v (1)
 * - Returns as UnidentifiedSafeSignature (data only, no signer address recovered)
 *
 * For dynamic signatures (v == 0):
 * - First 20 bytes: signer address (padded to 32 bytes)
 * - Next 32 bytes: offset to dynamic data section
 * - Last 1 byte: signature type (0 for dynamic)
 * - Dynamic data is appended after all static parts with format: length (32) + data
 * - Returns as SafeSignature with signer address extracted from the encoded data
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
 * //   { data: "0x" + "a".repeat(64) + "1b" }, // No signer address
 * //   { data: "0x" + "b".repeat(64) + "1c" }  // No signer address
 * // ]
 * ```
 *
 * @example
 * ```typescript
 * import { decodeSafeSignatureBytes } from "picosafe";
 *
 * // Decode signatures with dynamic/contract signature
 * const signatures = decodeSafeSignatureBytes(encodedHex);
 * // Returns array with both standard and dynamic signatures:
 * // [
 * //   { data: "0x..." }, // ECDSA - no signer recovered
 * //   { signer: "0x...", data: "0x...", dynamic: true } // Contract signature with signer
 * // ]
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L274
 */
function decodeSafeSignatureBytes(
	encodedSignatures: Hex,
): (UnidentifiedSafeSignature | SafeContractSignature)[] {
	const signatures: (UnidentifiedSafeSignature | SafeContractSignature)[] = [];
	const data = encodedSignatures.slice(2); // Remove 0x prefix

	// First pass: decode static parts and identify dynamic signatures
	let offset = 0;
	const staticLength = 65 * 2; // 65 bytes in hex

	while (offset < data.length) {
		if (offset + staticLength > data.length) break;

		const signatureData = data.slice(offset, offset + staticLength);
		const v = Number.parseInt(signatureData.slice(-2), 16);

		if (v === 0) {
			// Dynamic signature - extract signer and offset
			const signerPadded = `0x${signatureData.slice(0, 40)}`;
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
				signer: checksumAddress(`0x${signerPadded.slice(-40)}`),
				data: `0x${dynamicData}` as Hex,
				dynamic: true,
			});
		} else {
			// Standard ECDSA signature - extract from position
			signatures.push({
				data: `0x${signatureData}` as Hex,
			});
		}

		offset += staticLength;
	}

	return signatures;
}

export {
	encodeSafeSignatures,
	verifySafeSignatures,
	verifySafeSignaturesOffchain,
	parseSignatureType,
	extractSignatureComponents,
};

export type {
	SignatureValidationDetails,
	SignatureVerificationResult,
	VerifySafeSignaturesParams,
	VerifySafeSignaturesOffchainParams,
	SafeSignaturesParam,
};
