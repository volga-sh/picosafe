import type { Address, Hex } from "viem";
import { encodeFunctionData, recoverAddress } from "viem";
import { PARSED_SAFE_ABI } from "./abis.js";
import type {
	EIP1193ProviderWithRequestFn,
	SafeSignature,
	SignatureType,
	SignatureValidationDetail,
	SignatureVerificationResult,
	VerifySafeSignaturesOffchainParams,
	VerifySafeSignaturesParams,
} from "./types";
import { checksumAddress } from "./utilities/address.js";
import { concatHex, padStartHex } from "./utilities/encoding.js";

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
 * Determines the type of a Safe signature based on its format and properties.
 * 
 * @param signature - The Safe signature to analyze
 * @returns The signature type (ecdsa, contract, or approved)
 */
function parseSignatureType(signature: SafeSignature): SignatureType {
	const signatureData = signature.data.slice(2); // Remove 0x prefix
	
	// Check for approved hash signature (empty or specific format)
	if (signatureData.length === 0 || signature.data === "0x") {
		return "approved";
	}
	
	// Check for dynamic/contract signature flag
	if (signature.dynamic === true) {
		return "contract";
	}
	
	// Standard ECDSA signature is 65 bytes (130 hex characters)
	if (signatureData.length === 130) {
		return "ecdsa";
	}
	
	// Default to contract for non-standard lengths
	return "contract";
}

/**
 * Extracts r, s, v components from an ECDSA signature.
 * 
 * @param signatureData - The 65-byte ECDSA signature as hex string
 * @returns Object containing r, s, and v components
 */
function extractSignatureComponents(signatureData: Hex): { r: Hex; s: Hex; v: number } {
	const data = signatureData.slice(2); // Remove 0x prefix
	
	if (data.length !== 130) {
		throw new Error("Invalid ECDSA signature length");
	}
	
	const r = `0x${data.slice(0, 64)}` as Hex;
	const s = `0x${data.slice(64, 128)}` as Hex;
	const v = parseInt(data.slice(128, 130), 16);
	
	return { r, s, v };
}

/**
 * Verifies Safe signatures by making on-chain calls to the Safe contract.
 * This function uses the Safe's `isValidSignature` function to validate each signature.
 * 
 * @param provider - EIP-1193 compatible provider for blockchain interaction
 * @param params - Verification parameters including Safe address, data hash, and signatures
 * @param params.safeAddress - Address of the Safe contract to verify signatures against
 * @param params.dataHash - Hash of the data that was signed (typically from getTransactionHash)
 * @param params.data - Original transaction data (required for signature encoding)
 * @param params.signatures - Array of signatures to verify
 * @param params.requiredSignatures - Minimum number of valid signatures required (Safe threshold)
 * @returns Promise resolving to boolean indicating if verification passed
 * @throws {Error} If verification fails due to insufficient signatures or invalid format
 * 
 * @example
 * ```typescript
 * import { verifySafeSignatures, buildSafeTransaction, signSafeTransaction } from "picosafe";
 * 
 * const transaction = await buildSafeTransaction(provider, safeAddress, [{
 *   to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
 *   value: 1000000000000000000n,
 *   data: "0x"
 * }]);
 * 
 * const signature1 = await signSafeTransaction(provider, transaction, owner1);
 * const signature2 = await signSafeTransaction(provider, transaction, owner2);
 * 
 * const isValid = await verifySafeSignatures(provider, {
 *   safeAddress: transaction.safeAddress,
 *   dataHash: calculateSafeTransactionHash(transaction),
 *   data: transaction.data,
 *   signatures: [signature1, signature2],
 *   requiredSignatures: 2n
 * });
 * 
 * console.log("Signatures valid:", isValid);
 * ```
 * 
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L237
 */
async function verifySafeSignatures(
	provider: EIP1193ProviderWithRequestFn,
	params: VerifySafeSignaturesParams,
): Promise<boolean> {
	const { safeAddress, dataHash, signatures, requiredSignatures } = params;
	
	if (signatures.length === 0) {
		return requiredSignatures === 0n;
	}
	
	// Encode signatures in the Safe format for verification
	const encodedSignatures = encodeSafeSignatures(signatures);
	
	try {
		// Call isValidSignature on the Safe contract
		const result = await provider.request({
			method: "eth_call",
			params: [
				{
					to: safeAddress,
					data: encodeFunctionData({
						abi: PARSED_SAFE_ABI,
						functionName: "isValidSignature",
						args: [dataHash, encodedSignatures],
					}),
				},
				"latest",
			],
		});
		
		// EIP-1271 magic value: 0x1626ba7e
		const EIP1271_MAGIC_VALUE = "0x1626ba7e";
		
		// Check if the result matches the EIP-1271 magic value
		return result === EIP1271_MAGIC_VALUE || result === `${EIP1271_MAGIC_VALUE}${"0".repeat(56)}`;
	} catch (error) {
		// If the call fails, signatures are invalid
		return false;
	}
}

/**
 * Verifies Safe signatures off-chain with minimal on-chain calls.
 * This function performs most validation locally and only makes on-chain calls
 * for contract signature validation via EIP-1271.
 * 
 * @param provider - EIP-1193 compatible provider for blockchain interaction
 * @param params - Verification parameters including Safe address, signatures, and owners
 * @param params.safeAddress - Address of the Safe contract
 * @param params.chainId - Chain ID for EIP-712 domain separator calculation
 * @param params.dataHash - Hash of the data that was signed
 * @param params.data - Original transaction data
 * @param params.signatures - Array of signatures to verify
 * @param params.owners - Array of current Safe owners for validation
 * @param params.threshold - Safe threshold (minimum required signatures)
 * @returns Promise resolving to detailed verification result
 * 
 * @example
 * ```typescript
 * import { 
 *   verifySafeSignaturesOffchain, 
 *   getOwners, 
 *   getThreshold,
 *   calculateSafeTransactionHash,
 *   buildSafeTransaction 
 * } from "picosafe";
 * 
 * const transaction = await buildSafeTransaction(provider, safeAddress, [{
 *   to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
 *   value: 1000000000000000000n,
 *   data: "0x"
 * }]);
 * 
 * const [owners, threshold] = await Promise.all([
 *   getOwners(provider, safeAddress),
 *   getThreshold(provider, safeAddress)
 * ]);
 * 
 * const result = await verifySafeSignaturesOffchain(provider, {
 *   safeAddress: transaction.safeAddress,
 *   chainId: transaction.chainId,
 *   dataHash: calculateSafeTransactionHash(transaction),
 *   data: transaction.data,
 *   signatures: [signature1, signature2],
 *   owners,
 *   threshold
 * });
 * 
 * console.log("Verification result:", result);
 * // {
 * //   isValid: true,
 * //   validSignatures: 2,
 * //   details: [
 * //     { signer: "0x...", isValid: true, type: "ecdsa" },
 * //     { signer: "0x...", isValid: true, type: "ecdsa" }
 * //   ]
 * // }
 * ```
 */
async function verifySafeSignaturesOffchain(
	provider: EIP1193ProviderWithRequestFn,
	params: VerifySafeSignaturesOffchainParams,
): Promise<SignatureVerificationResult> {
	const { safeAddress, dataHash, signatures, owners, threshold } = params;
	
	const details: SignatureValidationDetail[] = [];
	let validSignatures = 0;
	const checksummedOwners = owners.map(owner => checksumAddress(owner));
	
	// Sort signatures by signer address (required by Safe)
	const sortedSignatures = [...signatures].sort((a, b) =>
		a.signer.toLowerCase().localeCompare(b.signer.toLowerCase()),
	);
	
	// Validate each signature
	for (const signature of sortedSignatures) {
		const checksummedSigner = checksumAddress(signature.signer);
		const signatureType = parseSignatureType(signature);
		
		// Check if signer is a Safe owner
		if (!checksummedOwners.includes(checksummedSigner)) {
			details.push({
				signer: checksummedSigner,
				isValid: false,
				type: signatureType,
				error: "Signer is not a Safe owner",
			});
			continue;
		}
		
		let isSignatureValid = false;
		let error: string | undefined;
		
		try {
			switch (signatureType) {
				case "ecdsa": {
					// Verify ECDSA signature locally
					const recoveredAddress = await recoverAddress({
						hash: dataHash,
						signature: signature.data,
					});
					
					isSignatureValid = checksumAddress(recoveredAddress) === checksummedSigner;
					if (!isSignatureValid) {
						error = "ECDSA signature verification failed";
					}
					break;
				}
				
				case "contract": {
					// Verify contract signature via EIP-1271
					try {
						const result = await provider.request({
							method: "eth_call",
							params: [
								{
									to: checksummedSigner,
									data: encodeFunctionData({
										abi: PARSED_SAFE_ABI,
										functionName: "isValidSignature",
										args: [dataHash, signature.data],
									}),
								},
								"latest",
							],
						});
						
						const EIP1271_MAGIC_VALUE = "0x1626ba7e";
						isSignatureValid = result === EIP1271_MAGIC_VALUE || 
							result === `${EIP1271_MAGIC_VALUE}${"0".repeat(56)}`;
							
						if (!isSignatureValid) {
							error = "Contract signature validation failed";
						}
					} catch (contractError) {
						error = `Contract signature verification error: ${contractError}`;
					}
					break;
				}
				
				case "approved": {
					// Check approved hashes mapping
					try {
						const result = await provider.request({
							method: "eth_call",
							params: [
								{
									to: safeAddress,
									data: encodeFunctionData({
										abi: PARSED_SAFE_ABI,
										functionName: "approvedHashes",
										args: [checksummedSigner, dataHash],
									}),
								},
								"latest",
							],
						});
						
						// If approved hash exists, result should be > 0
						isSignatureValid = BigInt(result) > 0n;
						if (!isSignatureValid) {
							error = "Hash not approved by this signer";
						}
					} catch (approvedError) {
						error = `Approved hash check error: ${approvedError}`;
					}
					break;
				}
				
				default:
					error = "Unknown signature type";
			}
		} catch (verificationError) {
			error = `Signature verification error: ${verificationError}`;
		}
		
		details.push({
			signer: checksummedSigner,
			isValid: isSignatureValid,
			type: signatureType,
			error,
		});
		
		if (isSignatureValid) {
			validSignatures++;
		}
	}
	
	// Check if we have enough valid signatures to meet the threshold
	const isValid = BigInt(validSignatures) >= threshold;
	
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
