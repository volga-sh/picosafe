/**
 * The null address (20 zero bytes).
 * Commonly used as a default value for address parameters in Safe operations,
 * such as gasToken, refundReceiver, or to indicate ETH transfers.
 * @example
 * ```typescript
 * import { ZERO_ADDRESS } from 'picosafe/utilities/constants';
 *
 * // Use as default for optional address parameters
 * const safeTx = {
 *   gasToken: ZERO_ADDRESS, // Pay gas in ETH
 *   refundReceiver: ZERO_ADDRESS, // No refund receiver
 *   // ...
 * };
 * ```
 */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Empty bytes data (`0x`).
 * Used as default value for data fields when no calldata is required,
 * such as simple ETH transfers or when no delegate call is needed during Safe setup.
 * @example
 * ```typescript
 * import { EMPTY_BYTES } from 'picosafe/utilities/constants';
 *
 * // ETH transfer with no data
 * const transfer = {
 *   to: recipient,
 *   value: parseEther('1'),
 *   data: EMPTY_BYTES
 * };
 * ```
 */
const EMPTY_BYTES = "0x";

/**
 * Sentinel node address used in Safe's linked list data structures.
 * This special address (`0x1`) marks the beginning and end of linked lists
 * for owners and modules. Used in pagination to indicate list boundaries
 * and as the `prevOwner`/`prevModule` parameter when modifying the first element.
 * @example
 * ```typescript
 * import { SENTINEL_NODE } from 'picosafe/utilities/constants';
 *
 * // When removing the first owner in the list
 * const tx = await getRemoveOwnerTransaction(provider, safeAddress, {
 *   prevOwner: SENTINEL_NODE, // First owner uses sentinel as previous
 *   ownerToRemove: firstOwner,
 *   newThreshold: 1n
 * });
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/libraries/SafeStorage.sol#L6
 */
const SENTINEL_NODE = "0x0000000000000000000000000000000000000001";

/**
 * Standard ECDSA signature length in bytes.
 * ECDSA signatures consist of r (32 bytes) + s (32 bytes) + v (1 byte) = 65 bytes total.
 * This constant is used for signature validation and encoding/decoding operations.
 * @example
 * ```typescript
 * import { ECDSA_SIGNATURE_LENGTH_BYTES } from 'picosafe/utilities/constants';
 *
 * // Validate signature length
 * if (signatureData.length !== ECDSA_SIGNATURE_LENGTH_BYTES * 2) {
 *   throw new Error(`Invalid signature length: expected ${ECDSA_SIGNATURE_LENGTH_BYTES} bytes`);
 * }
 * ```
 */
const ECDSA_SIGNATURE_LENGTH_BYTES = 65;

/**
 * Standard ECDSA signature length in hex characters.
 * Since each byte is represented by 2 hex characters, this equals 130 hex chars.
 * Used for validating hex-encoded signature strings.
 * @example
 * ```typescript
 * import { ECDSA_SIGNATURE_LENGTH_HEX } from 'picosafe/utilities/constants';
 *
 * // Check if hex string has correct length (excluding 0x prefix)
 * if (signature.slice(2).length !== ECDSA_SIGNATURE_LENGTH_HEX) {
 *   throw new Error('Invalid signature length');
 * }
 * ```
 */
const ECDSA_SIGNATURE_LENGTH_HEX = ECDSA_SIGNATURE_LENGTH_BYTES * 2;

/**
 * Standard ABI word size in bytes.
 * In Ethereum ABI encoding, all data is encoded in 32-byte chunks.
 * This is the fundamental unit for ABI encoding and decoding operations.
 * @example
 * ```typescript
 * import { ABI_WORD_SIZE_BYTES } from 'picosafe/utilities/constants';
 *
 * // Pad data to ABI word size
 * const padded = padLeft(data, ABI_WORD_SIZE_BYTES);
 * ```
 */
const ABI_WORD_SIZE_BYTES = 32;

/**
 * Standard ABI word size in hex characters.
 * Since each byte is represented by 2 hex characters, this equals 64 hex chars.
 * Used for hex string operations involving ABI-encoded data.
 * @example
 * ```typescript
 * import { ABI_WORD_SIZE_HEX } from 'picosafe/utilities/constants';
 *
 * // Check hex string length for ABI word
 * if (hexData.length !== ABI_WORD_SIZE_HEX + 2) { // +2 for '0x'
 *   throw new Error('Invalid ABI word length');
 * }
 * ```
 */
const ABI_WORD_SIZE_HEX = ABI_WORD_SIZE_BYTES * 2;

/**
 * Standard ABI offset for dynamic types in bytes.
 * In Ethereum ABI encoding, dynamic types (like bytes, string) use a 32-byte
 * offset pointing to the actual data location. This offset is typically 0x60 (96)
 * for the first dynamic parameter.
 * @example
 * ```typescript
 * import { ABI_DYNAMIC_OFFSET } from 'picosafe/utilities/constants';
 *
 * // Check if offset matches dynamic type marker
 * if (offset === ABI_DYNAMIC_OFFSET) {
 *   // Handle dynamic type
 * }
 * ```
 */
const ABI_DYNAMIC_OFFSET = 0x60n;

export {
	ZERO_ADDRESS,
	EMPTY_BYTES,
	SENTINEL_NODE,
	ECDSA_SIGNATURE_LENGTH_BYTES,
	ECDSA_SIGNATURE_LENGTH_HEX,
	ABI_WORD_SIZE_BYTES,
	ABI_WORD_SIZE_HEX,
	ABI_DYNAMIC_OFFSET,
};
