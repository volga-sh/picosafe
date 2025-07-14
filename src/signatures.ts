import type { Address, Hex } from "viem";
import { isAddress, isHex, recoverAddress, encodeFunctionData } from "viem";
import type { 
	SafeSignature, 
	EIP1193ProviderWithRequestFn,
	VerifySafeSignaturesParams,
	VerifySafeSignaturesOffchainParams,
	SignatureType,
	SignatureVerificationResult,
} from "./types";
import { concatHex, padStartHex } from "./utilities/encoding.js";
import { PARSED_SAFE_ABI } from "./abis.js";
import { checksumAddress } from "./utilities/address.js";

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
	// Check if it's a dynamic signature (contract signature)
	if (signature.dynamic) {
		return "contract";
	}
	
	// Check signature length for ECDSA vs approved hash
	const dataWithoutPrefix = signature.data.slice(2);
	const signatureLength = dataWithoutPrefix.length / 2;
	
	if (signatureLength === 65) {
		// Standard ECDSA signature
		return "ecdsa";
	} else if (signatureLength === 0) {
		// Approved hash (empty signature)
		return "approved";
	} else {
		// Assume contract signature for other lengths
		return "contract";
	}
}

/**
 * Extracts r, s, v components from an ECDSA signature
 * @param signature - The hex signature (65 bytes)
 * @returns Object with r, s, v components
 */
function extractSignatureComponents(signature: Hex): { r: Hex; s: Hex; v: number } {
	if (!isHex(signature) || signature.length !== 132) { // 0x + 130 hex chars = 65 bytes
		throw new Error("Invalid ECDSA signature length");
	}
	
	const data = signature.slice(2);
	const r = `0x${data.slice(0, 64)}` as Hex;
	const s = `0x${data.slice(64, 128)}` as Hex;
	const v = parseInt(data.slice(128, 130), 16);
	
	return { r, s, v };
}

/**
 * Verifies Safe signatures using the Safe contract's checkNSignatures function
 * 
 * This function calls the Safe contract's checkNSignatures method to verify
 * that the provided signatures are valid for the given data hash. The function
 * will revert if the signatures are invalid or insufficient.
 * 
 * @param provider - EIP-1193 provider to use for the verification call
 * @param params - Verification parameters
 * @param params.safeAddress - The Safe contract address
 * @param params.dataHash - The hash of the data that was signed
 * @param params.data - The original data that was signed
 * @param params.signatures - Array of signatures to verify
 * @param params.requiredSignatures - Number of valid signatures required
 * @returns Promise that resolves to true if signatures are valid, false otherwise
 * 
 * @example
 * ```typescript
 * import { verifySafeSignatures } from "picosafe";
 * 
 * const isValid = await verifySafeSignatures(provider, {
 *   safeAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
 *   dataHash: "0x1234567890123456789012345678901234567890123456789012345678901234",
 *   data: "0x",
 *   signatures: [
 *     {
 *       signer: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
 *       data: "0x" + "a".repeat(64) + "1b"
 *     }
 *   ],
 *   requiredSignatures: 1n
 * });
 * console.log(isValid); // true or false
 * ```
 * 
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L274
 */
async function verifySafeSignatures(
	provider: EIP1193ProviderWithRequestFn,
	params: VerifySafeSignaturesParams,
): Promise<boolean> {
	const { safeAddress, dataHash, data, signatures, requiredSignatures } = params;
	
	// Validate inputs
	if (!isAddress(safeAddress)) {
		throw new Error("Invalid Safe address");
	}
	if (!isHex(dataHash) || dataHash.length !== 66) { // 0x + 64 hex chars = 32 bytes
		throw new Error("Invalid data hash");
	}
	if (!isHex(data)) {
		throw new Error("Invalid data");
	}
	
	// Encode signatures using existing function
	const encodedSignatures = encodeSafeSignatures(signatures);
	
	try {
		// Encode the function call data using viem
		const callData = encodeFunctionData({
			abi: PARSED_SAFE_ABI,
			functionName: "checkNSignatures",
			args: [dataHash, data, encodedSignatures, requiredSignatures],
		});

		// Call checkNSignatures - if it doesn't revert, signatures are valid
		await provider.request({
			method: "eth_call",
			params: [
				{
					to: safeAddress,
					data: callData,
				},
				"latest",
			],
		});
		return true;
	} catch (error) {
		// If the call reverts, signatures are invalid
		return false;
	}
}

/**
 * Verifies Safe signatures off-chain with minimal on-chain calls
 * 
 * This function performs signature verification primarily off-chain for efficiency,
 * only making on-chain calls when necessary (for contract signatures via EIP-1271
 * and checking approved hashes). It validates each signature individually and
 * provides detailed results.
 * 
 * @param provider - EIP-1193 provider to use for minimal on-chain calls
 * @param params - Verification parameters
 * @param params.safeAddress - The Safe contract address
 * @param params.chainId - The chain ID for domain separator calculation
 * @param params.dataHash - The hash of the data that was signed
 * @param params.data - The original data that was signed
 * @param params.signatures - Array of signatures to verify
 * @param params.owners - Array of Safe owner addresses
 * @param params.threshold - Number of valid signatures required
 * @returns Promise that resolves to detailed verification results
 * 
 * @example
 * ```typescript
 * import { verifySafeSignaturesOffchain } from "picosafe";
 * 
 * const result = await verifySafeSignaturesOffchain(provider, {
 *   safeAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
 *   chainId: 1n,
 *   dataHash: "0x1234567890123456789012345678901234567890123456789012345678901234",
 *   data: "0x",
 *   signatures: [
 *     {
 *       signer: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
 *       data: "0x" + "a".repeat(64) + "1b"
 *     }
 *   ],
 *   owners: ["0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5"],
 *   threshold: 1n
 * });
 * 
 * console.log(result.isValid); // true or false
 * console.log(result.validSignatures); // number of valid signatures
 * console.log(result.details); // detailed per-signature validation
 * ```
 */
async function verifySafeSignaturesOffchain(
	provider: EIP1193ProviderWithRequestFn,
	params: VerifySafeSignaturesOffchainParams,
): Promise<SignatureVerificationResult> {
	const { safeAddress, chainId, dataHash, data, signatures, owners, threshold } = params;
	
	// Validate inputs
	if (!isAddress(safeAddress)) {
		throw new Error("Invalid Safe address");
	}
	if (!isHex(dataHash) || dataHash.length !== 66) {
		throw new Error("Invalid data hash");
	}
	if (!isHex(data)) {
		throw new Error("Invalid data");
	}
	
	// Checksum all owner addresses for comparison
	const checksummedOwners = owners.map(owner => checksumAddress(owner));
	
	const details = await Promise.all(
		signatures.map(async (signature) => {
			const signerAddress = checksumAddress(signature.signer);
			const signatureType = parseSignatureType(signature);
			
			// Check if signer is a Safe owner
			if (!checksummedOwners.includes(signerAddress)) {
				return {
					signer: signerAddress,
					isValid: false,
					type: signatureType,
					error: "Signer is not a Safe owner",
				};
			}
			
			try {
				if (signatureType === "ecdsa") {
					// Verify ECDSA signature off-chain
					const { r, s, v } = extractSignatureComponents(signature.data);
					const recoveredAddress = await recoverAddress({
						hash: dataHash,
						signature: { r, s, v },
					});
					
					const isValid = checksumAddress(recoveredAddress) === signerAddress;
					return {
						signer: signerAddress,
						isValid,
						type: signatureType,
						error: isValid ? undefined : "ECDSA signature verification failed",
					};
				} else if (signatureType === "contract") {
					// Verify contract signature via EIP-1271
					try {
						const eip1271CallData = encodeFunctionData({
							abi: PARSED_SAFE_ABI,
							functionName: "isValidSignature",
							args: [dataHash, signature.data],
						});

						const result = await provider.request({
							method: "eth_call",
							params: [
								{
									to: signerAddress,
									data: eip1271CallData,
								},
								"latest",
							],
						});
						
						// EIP-1271 magic value is 0x1626ba7e
						const isValid = result === "0x1626ba7e00000000000000000000000000000000000000000000000000000000";
						return {
							signer: signerAddress,
							isValid,
							type: signatureType,
							error: isValid ? undefined : "Contract signature verification failed",
						};
					} catch (error) {
						return {
							signer: signerAddress,
							isValid: false,
							type: signatureType,
							error: `Contract signature call failed: ${error}`,
						};
					}
				} else if (signatureType === "approved") {
					// Check approved hash on Safe contract
					try {
						const approvedHashCallData = encodeFunctionData({
							abi: PARSED_SAFE_ABI,
							functionName: "approvedHashes",
							args: [signerAddress, dataHash],
						});

						const result = await provider.request({
							method: "eth_call",
							params: [
								{
									to: safeAddress,
									data: approvedHashCallData,
								},
								"latest",
							],
						});
						
						// approvedHashes returns uint256, non-zero means approved
						const isApproved = result !== "0x0000000000000000000000000000000000000000000000000000000000000000";
						return {
							signer: signerAddress,
							isValid: isApproved,
							type: signatureType,
							error: isApproved ? undefined : "Hash not approved by signer",
						};
					} catch (error) {
						return {
							signer: signerAddress,
							isValid: false,
							type: signatureType,
							error: `Approved hash check failed: ${error}`,
						};
					}
				} else {
					return {
						signer: signerAddress,
						isValid: false,
						type: signatureType,
						error: "Unknown signature type",
					};
				}
			} catch (error) {
				return {
					signer: signerAddress,
					isValid: false,
					type: signatureType,
					error: `Signature verification error: ${error}`,
				};
			}
		}),
	);
	
	const validSignatures = details.filter(detail => detail.isValid).length;
	const isValid = validSignatures >= Number(threshold);
	
	return {
		isValid,
		validSignatures,
		details,
	};
}

export { 
	encodeSafeSignatures, 
	verifySafeSignatures, 
	verifySafeSignaturesOffchain,
	parseSignatureType,
	extractSignatureComponents,
};
