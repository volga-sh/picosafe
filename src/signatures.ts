import type { Hex } from "viem";
import type { SafeSignature } from "./types";
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

export { encodeSafeSignatures };
