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

export {
	ZERO_ADDRESS,
	EMPTY_BYTES,
	SENTINEL_NODE,
	ECDSA_SIGNATURE_LENGTH_BYTES,
	ECDSA_SIGNATURE_LENGTH_HEX,
};
