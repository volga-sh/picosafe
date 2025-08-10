import { AbiParameters, Hash, TypedData } from "ox";
import type { Address, Hex } from "./types";
import type { FullSafeTransaction, SafeMessage } from "./types.js";

/**
 * Calculates the EIP-712 domain separator for a Safe.
 *
 * The domain separator is a unique identifier for the Safe contract on a specific
 * chain, preventing signature replay attacks across different contracts or chains.
 * This follows the EIP-712 standard for structured data hashing and matches the
 * value returned by the Safe contract's `domainSeparator()` method.
 *
 * @param safeAddress - The address of the Safe contract to calculate the domain separator for
 * @param chainId - The EIP-155 chain ID where the Safe is deployed
 * @returns The 32-byte domain separator hash as a hex string
 *
 * @example
 * ```typescript
 * import { calculateSafeDomainSeparator } from "picosafe";
 *
 * // Calculate domain separator for a Safe on mainnet
 * const domainSeparator = calculateSafeDomainSeparator(
 *   "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
 *   1n // Ethereum mainnet
 * );
 * console.log(domainSeparator);
 * // 0x...
 * ```
 *
 * @example
 * ```typescript
 * import { calculateSafeDomainSeparator } from "picosafe";
 *
 * // Use with different chains
 * const polygonSeparator = calculateSafeDomainSeparator(
 *   "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
 *   137n // Polygon mainnet
 * );
 *
 * const arbitrumSeparator = calculateSafeDomainSeparator(
 *   "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
 *   42161n // Arbitrum One
 * );
 *
 * // Different chains produce different separators for the same Safe
 * console.log(polygonSeparator !== arbitrumSeparator); // true
 * ```
 */
function calculateSafeDomainSeparator(
	safeAddress: Address,
	chainId: bigint,
): Hex {
	// keccak256(
	// 	toHex("EIP712Domain(uint256 chainId,address verifyingContract)"),
	// );
	const domainSeparatorTypehash =
		"0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218";

	return Hash.keccak256(
		AbiParameters.encode(
			AbiParameters.from(["bytes32", "uint256", "address"]),
			[domainSeparatorTypehash, chainId, safeAddress],
		),
	);
}

/**
 * Builds the EIP-712 domain object used by all Safe-related typed-data signatures.
 *
 * The domain is only a function of the Safe address (verifying contract)
 * and the current chainId, therefore the same domain value can be reused for
 * every transaction / message hash that belongs to the same Safe on the same
 * network. This domain is used with viem's `hashTypedData` function.
 *
 * @param safeAddress - Address of the Safe contract that will act as the verifyingContract
 * @param chainId - The EIP-155 chain ID the Safe is deployed on
 * @returns The minimal EIP-712 domain object with chainId and verifyingContract properties
 *
 * @example
 * ```typescript
 * import { getSafeEip712Domain } from "picosafe";
 * import { hashTypedData } from "viem";
 *
 * // Build the domain for a mainnet Safe
 * const domain = getSafeEip712Domain(
 *   "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
 *   1n,
 * );
 * console.log(domain);
 * // { chainId: 1n, verifyingContract: '0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5' }
 *
 * // Use with viem's hashTypedData
 * const hash = hashTypedData({
 *   domain,
 *   types: { SafeTx: [...] }, // your EIP-712 types
 *   primaryType: "SafeTx",
 *   message: { to: "0x...", value: 0n, data: "0x..." } // your message
 * });
 * ```
 */
function getSafeEip712Domain<TChainId extends bigint | string>(
	safeAddress: Address,
	chainId: TChainId,
) {
	return {
		chainId,
		verifyingContract: safeAddress,
	} as const;
}

/**
 * The canonical EIP-712 types for a Safe transaction (SafeTx).
 *
 * These types define the structure of a Safe transaction for EIP-712 signing.
 * They are used when building the typed-data payload for:
 *  - calculateSafeTransactionHash
 *  - eth_signTypedData_v4 in signTransaction
 *  - Safe contract's getTransactionHash method
 */
const SAFE_TX_EIP712_TYPES = {
	SafeTx: [
		{ name: "to", type: "address" },
		{ name: "value", type: "uint256" },
		{ name: "data", type: "bytes" },
		{ name: "operation", type: "uint8" },
		{ name: "safeTxGas", type: "uint256" },
		{ name: "baseGas", type: "uint256" },
		{ name: "gasPrice", type: "uint256" },
		{ name: "gasToken", type: "address" },
		{ name: "refundReceiver", type: "address" },
		{ name: "nonce", type: "uint256" },
	],
} as const;

/**
 * The canonical EIP-712 types for a Safe message (SafeMessage).
 *
 * A Safe message is any arbitrary byte-payload that a Safe contract is asked
 * to sign and later prove via EIP-1271. These types are used for:
 *  - calculateSafeMessageHash
 *  - Safe contract's getMessageHash method
 *  - EIP-1271 signature validation
 */
const SAFE_MESSAGE_EIP712_TYPES = {
	SafeMessage: [{ name: "message", type: "bytes" }],
} as const;

/**
 * Calculates the EIP-712 struct hash for a Safe transaction (SafeTx).
 *
 * The resulting value is what every owner must sign (either via
 * eth_signTypedData_v4 or personal_sign) in order to authorize the
 * execution of the transaction on-chain. This hash matches the value
 * returned by the Safe contract's getTransactionHash method.
 *
 * @param safeTx - Fully-formed Safe transaction object containing all required fields including safeAddress and chainId
 * @returns The 32-byte EIP-712 hash of the SafeTx payload as a hex string
 *
 * @example
 * ```typescript
 * import { calculateSafeTransactionHash } from "picosafe";
 * import type { FullSafeTransaction } from "picosafe/types";
 *
 * const safeTx: FullSafeTransaction = {
 *   safeAddress: "0x1234567890123456789012345678901234567890",
 *   chainId: 1n, // Mainnet
 *   to: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
 *   value: 0n,
 *   data: "0x",
 *   operation: 0, // Call
 *   safeTxGas: 0n,
 *   baseGas: 0n,
 *   gasPrice: 0n,
 *   gasToken: "0x0000000000000000000000000000000000000000",
 *   refundReceiver: "0x0000000000000000000000000000000000000000",
 *   nonce: 0n
 * };
 *
 * const hash = calculateSafeTransactionHash(safeTx);
 *
 * // Owners can now sign this hash
 * const signature = await walletClient.signMessage({ message: hash });
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L427
 */
function calculateSafeTransactionHash(
	safeTx: Readonly<FullSafeTransaction>,
): Hex {
	return TypedData.getSignPayload({
		domain: getSafeEip712Domain(safeTx.safeAddress, safeTx.chainId),
		types: SAFE_TX_EIP712_TYPES,
		primaryType: "SafeTx",
		message: {
			to: safeTx.to,
			value: safeTx.value,
			data: safeTx.data,
			operation: safeTx.operation,
			safeTxGas: safeTx.safeTxGas,
			baseGas: safeTx.baseGas,
			gasPrice: safeTx.gasPrice,
			gasToken: safeTx.gasToken,
			refundReceiver: safeTx.refundReceiver,
			nonce: safeTx.nonce,
		},
	});
}

/**
 * Encodes a Safe transaction into EIP-712 typed data format for signing.
 *
 * This function returns the raw encoded data (pre-image) that would be hashed
 * to produce the transaction hash. It's useful for advanced signature scenarios
 * where you need the structured data before hashing, such as when working with
 * legacy ERC-1271 contract signatures that expect the full typed data.
 *
 * @param safeTx - Fully-formed Safe transaction object containing all required fields including safeAddress and chainId
 * @returns The EIP-712 encoded data as a hex string (concatenation of 0x1901, domain separator, and struct hash)
 *
 * @example
 * ```typescript
 * import { encodeEIP712SafeTransactionData } from "picosafe";
 * import { keccak256 } from "viem";
 * import type { FullSafeTransaction } from "picosafe/types";
 *
 * const safeTx: FullSafeTransaction = {
 *   safeAddress: "0x1234567890123456789012345678901234567890",
 *   chainId: 1n, // Mainnet
 *   to: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
 *   value: 0n,
 *   data: "0x",
 *   operation: 0, // Call
 *   safeTxGas: 0n,
 *   baseGas: 0n,
 *   gasPrice: 0n,
 *   gasToken: "0x0000000000000000000000000000000000000000",
 *   refundReceiver: "0x0000000000000000000000000000000000000000",
 *   nonce: 0n
 * };
 *
 * // Get the encoded data
 * const encodedData = encodeEIP712SafeTransactionData(safeTx);
 *
 * // Hash it to get the transaction hash (same as calculateSafeTransactionHash)
 * const hash = keccak256(encodedData);
 * ```
 */
function encodeEIP712SafeTransactionData(
	safeTx: Readonly<FullSafeTransaction>,
): Hex {
	return TypedData.encode({
		domain: getSafeEip712Domain(safeTx.safeAddress, safeTx.chainId),
		types: SAFE_TX_EIP712_TYPES,
		primaryType: "SafeTx",
		message: {
			to: safeTx.to,
			value: safeTx.value,
			data: safeTx.data,
			operation: safeTx.operation,
			safeTxGas: safeTx.safeTxGas,
			baseGas: safeTx.baseGas,
			gasPrice: safeTx.gasPrice,
			gasToken: safeTx.gasToken,
			refundReceiver: safeTx.refundReceiver,
			nonce: safeTx.nonce,
		},
	});
}

/**
 * Calculates the EIP-712 struct hash for an arbitrary Safe message (SafeMessage).
 *
 * The hash can be validated by the Safe contract via EIP-1271 and therefore is
 * safe for off-chain use-cases (login, permit-like flows, etc.). This hash
 * matches the value returned by the Safe contract's getMessageHash method.
 *
 * @param safeAddress - Address of the Safe that is signing the message
 * @param chainId - EIP-155 chain ID of the network where the Safe is deployed
 * @param message - The message payload containing the bytes data to sign
 * @returns The 32-byte EIP-712 hash of the message payload as a hex string
 *
 * @example
 * ```typescript
 * import { calculateSafeMessageHash } from "picosafe";
 * import { toHex } from "viem";
 *
 * // Hash a text message
 * const textMessage = "Hello, Safe!";
 * const msgHash = calculateSafeMessageHash(
 *   "0x1234567890123456789012345678901234567890", // Safe address
 *   1n, // Mainnet
 *   { message: toHex(textMessage) }
 * );
 *
 * // Hash binary data
 * const binaryData = "0x1234567890abcdef";
 * const binaryHash = calculateSafeMessageHash(
 *   "0x1234567890123456789012345678901234567890",
 *   1n,
 *   { message: binaryData }
 * );
 *
 * // The hash can be used for EIP-1271 signature validation
 * const isValid = await isValidSignature(provider, safeAddress, msgHash, signatures);
 * ```
 */
function calculateSafeMessageHash(
	safeAddress: Address,
	chainId: bigint,
	message: Readonly<SafeMessage>,
): Hex {
	return TypedData.getSignPayload({
		domain: getSafeEip712Domain(safeAddress, chainId),
		types: SAFE_MESSAGE_EIP712_TYPES,
		primaryType: "SafeMessage",
		message,
	});
}

/**
 * Encodes a Safe message into EIP-712 typed data format for signing.
 *
 * This function returns the raw encoded data (pre-image) that would be hashed
 * to produce the message hash. It's useful for advanced signature scenarios
 * where you need the structured data before hashing, such as when working with
 * legacy ERC-1271 contract signatures that expect the full typed data.
 *
 * @param safeAddress - Address of the Safe that is signing the message
 * @param chainId - EIP-155 chain ID of the network where the Safe is deployed
 * @param message - The message payload containing the bytes data to sign
 * @returns The EIP-712 encoded data as a hex string (concatenation of 0x1901, domain separator, and struct hash)
 *
 * @example
 * ```typescript
 * import { encodeEIP712SafeMessageData } from "picosafe";
 * import { keccak256, toHex } from "viem";
 *
 * // Encode a text message
 * const textMessage = "Hello, Safe!";
 * const encodedData = encodeEIP712SafeMessageData(
 *   "0x1234567890123456789012345678901234567890", // Safe address
 *   1n, // Mainnet
 *   { message: toHex(textMessage) }
 * );
 *
 * // Hash it to get the message hash (same as calculateSafeMessageHash)
 * const hash = keccak256(encodedData);
 *
 * // Use with binary data
 * const binaryData = "0x1234567890abcdef";
 * const binaryEncoded = encodeEIP712SafeMessageData(
 *   "0x1234567890123456789012345678901234567890",
 *   1n,
 *   { message: binaryData }
 * );
 * ```
 */
function encodeEIP712SafeMessageData(
	safeAddress: Address,
	chainId: bigint,
	message: Readonly<SafeMessage>,
): Hex {
	return TypedData.encode({
		domain: getSafeEip712Domain(safeAddress, chainId),
		types: SAFE_MESSAGE_EIP712_TYPES,
		primaryType: "SafeMessage",
		message,
	});
}

export {
	SAFE_MESSAGE_EIP712_TYPES,
	SAFE_TX_EIP712_TYPES,
	getSafeEip712Domain,
	calculateSafeTransactionHash,
	calculateSafeMessageHash,
	calculateSafeDomainSeparator,
	encodeEIP712SafeTransactionData,
	encodeEIP712SafeMessageData,
};
