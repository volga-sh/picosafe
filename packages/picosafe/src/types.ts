import type { Address, Hex } from "./ox-types";

type BlockTag = "latest" | "earliest" | "pending" | "safe" | "finalized";
type RpcBlockNumber = `0x${string}`;
type RpcBlockIdentifier =
	| { blockHash: `0x${string}`; blockNumber?: never }
	| { blockHash?: never; blockNumber: RpcBlockNumber };

/**
 * Utility type that flattens complex type intersections for better IDE display
 * @template T - The type to prettify
 */
type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

/**
 * Minimal EIP-1193 provider interface that only requires the request method
 * Used throughout the SDK for blockchain interactions
 * Compatible with both Ox and Viem providers
 *
 * Note: We use a bivariant hack with method callback to ensure compatibility
 * with various provider implementations (Viem, Ethers, Ox, etc.) that have
 * different type signatures for the request method. This allows the SDK
 * to work with any EIP-1193 compliant provider without requiring users to
 * install specific provider libraries.
 */
type EIP1193ProviderWithRequestFn = {
	request(args: { method: string; params?: unknown }): Promise<unknown>;
};

/**
 * Block identifier types accepted by the SDK for specifying block context
 * Can be a block number, tag (e.g., "latest", "pending"), or full block identifier
 */
type PicosafeRpcBlockIdentifier =
	| RpcBlockNumber
	| BlockTag
	| RpcBlockIdentifier;

/**
 * Safe transaction operation types
 * @enum {number}
 * @property {0} Call - Regular call operation (default) - executes code at the target address
 * @property {1} UNSAFE_DELEGATECALL - Delegate call operation - executes target code in the Safe's context.
 * WARNING: This is extremely dangerous as the called contract has full access to the Safe's storage
 * and can modify balances, owners, modules, and all internal state. Only use this if you fully
 * understand the implications and trust the target contract completely. Common use cases include
 * calling Safe modules specifically designed for delegatecall or upgrading Safe logic.
 */
enum Operation {
	Call = 0,
	UNSAFE_DELEGATECALL = 1,
}

/**
 * Basic transaction parameters for meta-transactions
 * @property {Address} to - Target address to send the transaction to
 * @property {bigint} value - Amount of ETH to send (in wei)
 * @property {Hex} data - Encoded transaction data (function selector + parameters)
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.5.0/contracts/base/Executor.sol
 */
type MetaTransaction = {
	to: Address;
	value: bigint;
	data: Hex;
};

/**
 * Complete Safe transaction data structure with all gas and fee parameters
 * @property {Operation} operation - Type of operation (Call or UNSAFE_DELEGATECALL)
 * @property {bigint} safeTxGas - Gas limit for the Safe transaction execution
 * @property {bigint} baseGas - Gas costs not related to the transaction execution (signature check, refund payment)
 * @property {bigint} gasPrice - Gas price in wei for gas payment (0 = no refund)
 * @property {Address} gasToken - Token address for gas payment (0x0 = ETH)
 * @property {Address} refundReceiver - Address to receive gas payment (0x0 = tx.origin)
 * @property {bigint} nonce - Safe account nonce to prevent replay attacks
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.5.0/contracts/Safe.sol
 */
type SafeTransactionData = MetaTransaction & {
	operation: Operation;
	safeTxGas: bigint;
	baseGas: bigint;
	gasPrice: bigint;
	gasToken: Address;
	refundReceiver: Address;
	nonce: bigint;
};

/**
 * A full Safe transaction with all required fields to calculate the hash
 *
 * @example
 * ```typescript
 * import { calculateSafeTransactionHash } from "picosafe";
 *
 * const safeTx: FullSafeTransaction = {
 *   safeAddress: "0x1234567890123456789012345678901234567890",
 *   chainId: 1n,
 *   operation: Operation.Call,
 *   safeTxGas: 100000n,
 *   baseGas: 100000n,
 *   gasPrice: 1000000000000000000n,
 *   gasToken: "0x0000000000000000000000000000000000000000",
 *   refundReceiver: "0x0000000000000000000000000000000000000000",
 *   nonce: 1n,
 *   to: "0x1234567890123456789012345678901234567890",
 *   value: 1000000000000000000n,
 *   data: "0x1234567890123456789012345678901234567890",
 * };
 *
 * const hash = calculateSafeTransactionHash(safeTx);
 * console.log(hash);
 * // 0x...
 * ```
 */
type FullSafeTransaction = Prettify<
	SafeTransactionData & {
		safeAddress: Address;
		chainId: bigint;
	}
>;

/**
 * Pre-approved hash signature structure
 *
 * Represents a signature that was pre-approved by calling the Safe's
 * `approveHash` function. This allows an owner to approve a transaction
 * hash in advance, which can then be used as a valid signature.
 *
 * @property {Address} signer - The owner address that approved the hash
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.5.0/contracts/Safe.sol
 */
type ApprovedHashSignature = {
	signer: Address;
};

/**
 * ECDSA signature structure
 *
 * Represents a standard ECDSA signature created by signing with a private key.
 * This includes both EIP-712 typed data signatures and eth_sign signatures.
 *
 * @property {Address} signer - The address that created this signature
 * @property {Hex} data - The 65-byte signature data in r + s + v format
 */
type ECDSASignature = {
	signer: Address;
	data: Hex;
};

/**
 * Static signature structure for standard ECDSA and pre-approved signatures
 *
 * Represents signatures that have a fixed 65-byte format and don't require
 * dynamic data resolution. This is a union type of:
 * - {@link ApprovedHashSignature} - Pre-approved hash signatures
 * - {@link ECDSASignature} - Standard ECDSA signatures (EIP-712 and eth_sign)
 *
 * Both types share a `signer` property but differ in whether they include
 * signature data. Pre-approved signatures only need the signer address,
 * while ECDSA signatures include the full 65-byte signature data.
 */
type StaticSignature = ApprovedHashSignature | ECDSASignature;

/**
 * Dynamic signature structure for EIP-1271 contract signatures
 *
 * Represents signatures from smart contract wallets that implement EIP-1271.
 * These signatures have variable length and require special encoding with
 * offset pointers when combined with other signatures.
 *
 * @property {Address} signer - The contract address that will validate the signature
 * @property {Hex} data - Variable-length signature data for the contract to validate
 * @property {true} dynamic - Flag indicating this is a dynamic/contract signature
 */
type DynamicSignature = {
	signer: Address;
	data: Hex;
	dynamic: true;
};

/**
 * Safe-specific signature structure
 * @property {Address} signer - Address of the signer. This address is purely a convenience field
 *                              and should not be used as a source of truth for the signer address.
 *                              It is needed in some cases where we need to sort signatures by signer address
 *                              (e.g., to encode signatures bytes for submitting a transaction to a Safe).
 *                              Validation methods MUST validate the signature against the signer address field.
 * @property {Hex} data - Signature data including the signature type suffix
 * @property {boolean} dynamic - Whether the signature includes dynamic part (e.g., EIP-1271)
 */
type PicosafeSignature = StaticSignature | DynamicSignature;

/**
 * Safe message structure for EIP-191/1271 message signing
 * @property {Hex} message - The message to be signed (as hex-encoded bytes)
 */
type SafeMessage = {
	message: Hex;
};

/**
 * Signature type suffix used by Safe contracts (last byte of every 65-byte signature).
 *
 * A Safe signature is always **65 bytes** long and is encoded as:
 * `{ 64-byte constant data }{ 1-byte signatureType }`.
 * The interpretation of the first 64 bytes depends on the value of `signatureType`:
 *
 * | Value | Enum member        | Constant layout                                           | Typical source               |
 * | ----- | ------------------ | --------------------------------------------------------- | ---------------------------- |
 * | `0`   | `CONTRACT`         | `{ verifier (32) | dataOffset (32) | 0 }` + dynamic bytes  | EIP-1271 contract            |
 * | `1`   | `APPROVED_HASH`    | `{ validator (32) | ignored (32) | 1 }`                   | `approveHash` / tx sender    |
 * | `27`  | `EIP712_RECID_1`   | `{ r (32) | s (32) | v (1) }`                             | `signTypedData` / EIP-712    |
 * | `28`  | `EIP712_RECID_2`   | `{ r (32) | s (32) | v (1) }`                             | `signTypedData` / EIP-712    |
 * | `31`  | `ETH_SIGN_RECID_1` | `{ r (32) | s (32) | ECDSA v+4 (1) }`                   | `eth_sign` / `personal_sign` |
 * | `32`  | `ETH_SIGN_RECID_2` | `{ r (32) | s (32) | ECDSA v+4 (1) }`                   | `eth_sign` / `personal_sign` |
 *
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.5.0/contracts/Safe.sol
 */
enum SignatureTypeVByte {
	CONTRACT = 0,
	APPROVED_HASH = 1,
	EIP712_RECID_1 = 27,
	EIP712_RECID_2 = EIP712_RECID_1 + 1,
	ETH_SIGN_RECID_1 = 31,
	ETH_SIGN_RECID_2 = ETH_SIGN_RECID_1 + 1,
}

/**
 * Union type for signature parameters accepted by Safe signature functions
 *
 * Many Safe SDK functions that work with signatures accept this flexible type,
 * allowing callers to provide signatures either as:
 * - An array of {@link PicosafeSignature} objects (easier to construct and manipulate)
 * - A hex-encoded string of concatenated signatures (as expected by Safe contracts)
 *
 * Functions accepting this type will automatically handle both formats appropriately.
 *
 * @example
 * ```typescript
 * import { executeSafeTransaction, encodeSafeSignaturesBytes } from "picosafe";
 *
 * // Pass as array of signature objects
 * await executeSafeTransaction(provider, safeAddress, safeTx, [
 *   { signer: owner1, data: sig1 },
 *   { signer: owner2, data: sig2 }
 * ]);
 *
 * // Or pass as encoded hex string
 * const encoded = encodeSafeSignaturesBytes(signatures);
 * await executeSafeTransaction(provider, safeAddress, safeTx, encoded);
 * ```
 */
type SafeSignaturesParam = readonly PicosafeSignature[] | Hex;

/**
 * Type predicate to check if a signature is an ApprovedHashSignature
 * @param signature - The signature to check
 * @returns True if the signature is an ApprovedHashSignature
 */
function isApprovedHashSignature(
	signature: PicosafeSignature,
): signature is ApprovedHashSignature {
	return !("data" in signature);
}

/**
 * Type predicate to check if a signature is a DynamicSignature
 * @param signature - The signature to check
 * @returns True if the signature is a DynamicSignature
 */
function isDynamicSignature(
	signature: PicosafeSignature,
): signature is DynamicSignature {
	return "data" in signature && "dynamic" in signature && signature.dynamic;
}

/**
 * Type predicate to check if a signature is an ECDSASignature
 * @param signature - The signature to check
 * @returns True if the signature is an ECDSASignature
 */
function isECDSASignature(
	signature: PicosafeSignature,
): signature is ECDSASignature {
	return "data" in signature && !("dynamic" in signature);
}

/**
 * Common validation context parameters for signature validation
 *
 * Provides a unified structure for passing validation data to signature
 * validation functions. Different signature types may require different
 * combinations of these parameters:
 *
 * - ECDSA signatures: Require only `dataHash`
 * - EIP-1271 signatures: Require either `data` or `dataHash`
 * - Approved hash signatures: Require both `dataHash` and `safeAddress`
 *
 * @property {Hex} dataHash - The hash of the data that was signed
 * @property {Hex} data - The original data that was signed (optional)
 * @property {Address} safeAddress - The Safe contract address (optional)
 */
type SignatureValidationContext = {
	dataHash: Hex;
	data?: Hex;
	safeAddress?: Address;
};

/**
 * Minimal description of an `eth_call` that is safe to batch or execute
 * immediately. The `block` field is optional and defaults to the node's
 * `latest` state.
 */
type StateReadCall = {
	/** Destination contract address */
	to: Address;
	/** Calldata (selector + encoded args) */
	data: Hex;
	/**
	 * Block context – either a tag ("latest", "pending", …) or an explicit block
	 * number/hash.
	 */
	block?: PicosafeRpcBlockIdentifier;
};

/**
 * Object returned when `wrapStateRead` is used in **lazy** mode. It contains
 * the raw call descriptor, a convenience `call()` method that performs the
 * RPC request, and – optionally – a user‑supplied metadata payload.
 */
type WrappedStateRead<T, A = void> = {
	rawCall: StateReadCall;
	call: () => Promise<T>;
	data?: A;
};

/**
 * A discriminated‑union that toggles lazy execution and optionally carries a
 * strongly‑typed metadata payload and block context.
 *
 * - `lazy?: false` (default)  ➜ immediate execution; block option available.
 * - `lazy: true`             ➜ returns a wrapper; `data` and `block` may be supplied.
 *
 * @template A  Caller‑supplied metadata shape.
 */
type MaybeLazy<A = void> =
	| { lazy?: false; data?: never; block?: PicosafeRpcBlockIdentifier }
	| { lazy: true; data?: A; block?: PicosafeRpcBlockIdentifier };

/**
 * Derives the return type of wrapStateRead from the caller‑supplied
 * `options` argument.
 */
type WrapResult<T, A, O> = O extends { lazy: true }
	? WrappedStateRead<T, A>
	: Promise<T>;

export { Operation, SignatureTypeVByte };
export { isApprovedHashSignature, isDynamicSignature, isECDSASignature };
export type {
	MetaTransaction,
	SafeTransactionData,
	ApprovedHashSignature,
	ECDSASignature,
	StaticSignature,
	DynamicSignature,
	PicosafeSignature,
	SafeMessage,
	EIP1193ProviderWithRequestFn,
	PicosafeRpcBlockIdentifier,
	FullSafeTransaction,
	Prettify,
	SafeSignaturesParam,
	SignatureValidationContext,
	StateReadCall,
	WrappedStateRead,
	MaybeLazy,
	WrapResult,
};
