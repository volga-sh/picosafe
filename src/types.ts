import type {
	Address,
	BlockTag,
	EIP1193Provider,
	Hex,
	RpcBlockIdentifier,
	RpcBlockNumber,
} from "viem";

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
 */
type EIP1193ProviderWithRequestFn = Pick<EIP1193Provider, "request">;

/**
 * Block identifier types accepted by the SDK for specifying block context
 * Can be a block number, tag (e.g., "latest", "pending"), or full block identifier
 */
type PicoSafeRpcBlockIdentifier =
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
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/Executor.sol#L21
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
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L139
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
 * Safe account configuration
 * @property {Address} address - Safe account address
 * @property {Address[]} owners - Array of owner addresses
 */
type SafeConfig = {
	address: Address;
	owners: Address[];
};

/**
 * Unidentified Safe signature structure.
 * Used when the signature is decoded from the signature bytes and the signer recovery hasn't been
 * performed yet.
 *
 * @property {Hex} data - Signature data
 */
type UnidentifiedSafeSignature = {
	data: Hex;
};

/**
 * A signature from a EOA signer
 *
 * @property {Address} signer - Address of the signer
 * @property {Hex} data - Signature data
 * @property {boolean} dynamic - boolean to indicate that the signature data has to be treated as a dynamic part
 */
type SafeEOASignature = {
	signer: Address;
	data: Hex;
	dynamic?: false;
};

/**
 * A signature from a Smart Contract signer
 *
 * @property {Address} signer - Address of the signer
 * @property {Hex} data - Signature data
 * @property {boolean} dynamic - boolean to indicate that the signature data has to be treated as a dynamic part
 */
type SafeContractSignature = {
	signer: Address;
	data: Hex;
	dynamic: true;
};

/**
 * Safe-specific signature structure (same as Signature but used for clarity in Safe contexts)
 * @property {Address} signer - Address of the signer
 * @property {Hex} data - Signature data including the signature type suffix
 * @property {boolean} dynamic - Whether the signature includes dynamic part (e.g., EIP-1271)
 */
type SafeSignature = SafeEOASignature | SafeContractSignature;

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
 * | Value | Enum member      | Constant layout                                           | Typical source               |
 * | ----- | ---------------- | --------------------------------------------------------- | ---------------------------- |
 * | `0`   | `EIP712`         | `{ r (32) | s (32) | v (1) }`                             | `signTypedData` / EIP-712    |
 * | `1`   | `CONTRACT`       | `{ verifier (32) | dataOffset (32) | 0 }` + dynamic bytes  | EIP-1271 contract            |
 * | `2`   | `APPROVED_HASH`  | `{ validator (32) | ignored (32) | 1 }`                   | `approveHash` / tx sender    |
 * | `3`   | `ETH_SIGN`       | `{ r (32) | s (32) | ECDSA v+4 (1) }`                     | `eth_sign` / `personal_sign` |
 *
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L274
 */
enum SignatureType {
	EIP712 = 0,
	CONTRACT = 1,
	APPROVED_HASH = 2,
	ETH_SIGN = 3,
}

export { Operation, SignatureType };
export type {
	MetaTransaction,
	SafeTransactionData,
	SafeEOASignature,
	SafeContractSignature,
	UnidentifiedSafeSignature,
	SafeSignature,
	SafeMessage,
	SafeConfig,
	EIP1193ProviderWithRequestFn,
	PicoSafeRpcBlockIdentifier,
	FullSafeTransaction,
	Prettify,
};
