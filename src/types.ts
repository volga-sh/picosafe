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
 * Safe-specific signature structure (same as Signature but used for clarity in Safe contexts)
 * @property {Address} signer - Address of the signer
 * @property {Hex} data - Signature data including the signature type suffix
 * @property {boolean} dynamic - Whether the signature includes dynamic part (e.g., EIP-1271)
 */
type SafeSignature = {
	signer: Address;
	data: Hex;
	dynamic?: boolean;
};

/**
 * Safe message structure for EIP-191/1271 message signing
 * @property {Hex} message - The message to be signed (as hex-encoded bytes)
 */
type SafeMessage = {
	message: Hex;
};

/**
 * Signature type classification for Safe signature verification
 * @enum {string}
 * @property {string} ecdsa - Standard ECDSA signature from externally owned account
 * @property {string} contract - EIP-1271 signature from smart contract wallet
 * @property {string} approved - Pre-approved transaction hash (no signature data)
 */
type SignatureType = "ecdsa" | "contract" | "approved";

/**
 * Parameters for on-chain Safe signature verification
 * @property {Address} safeAddress - Address of the Safe contract to verify signatures against
 * @property {Hex} dataHash - Hash of the data that was signed (typically from getTransactionHash)
 * @property {Hex} data - Original transaction data (required for signature encoding)
 * @property {readonly SafeSignature[]} signatures - Array of signatures to verify
 * @property {bigint} requiredSignatures - Minimum number of valid signatures required (Safe threshold)
 */
type VerifySafeSignaturesParams = {
	safeAddress: Address;
	dataHash: Hex;
	data: Hex;
	signatures: readonly SafeSignature[];
	requiredSignatures: bigint;
};

/**
 * Parameters for off-chain Safe signature verification with minimal on-chain calls
 * @property {Address} safeAddress - Address of the Safe contract
 * @property {bigint} chainId - Chain ID for EIP-712 domain separator calculation
 * @property {Hex} dataHash - Hash of the data that was signed
 * @property {Hex} data - Original transaction data
 * @property {readonly SafeSignature[]} signatures - Array of signatures to verify
 * @property {readonly Address[]} owners - Array of current Safe owners for validation
 * @property {bigint} threshold - Safe threshold (minimum required signatures)
 */
type VerifySafeSignaturesOffchainParams = {
	safeAddress: Address;
	chainId: bigint;
	dataHash: Hex;
	data: Hex;
	signatures: readonly SafeSignature[];
	owners: readonly Address[];
	threshold: bigint;
};

/**
 * Detailed information about individual signature validation
 * @property {Address} signer - Address of the signature creator
 * @property {boolean} isValid - Whether this signature is cryptographically valid
 * @property {SignatureType} type - Type of signature (ecdsa/contract/approved)
 * @property {string} error - Error message if validation failed (optional)
 */
type SignatureValidationDetail = {
	signer: Address;
	isValid: boolean;
	type: SignatureType;
	error?: string;
};

/**
 * Comprehensive result of off-chain signature verification
 * @property {boolean} isValid - Whether all signatures meet the threshold requirement
 * @property {number} validSignatures - Count of valid signatures found
 * @property {Array<SignatureValidationDetail>} details - Detailed results for each signature
 */
type SignatureVerificationResult = {
	isValid: boolean;
	validSignatures: number;
	details: Array<SignatureValidationDetail>;
};

export { Operation };
export type {
	MetaTransaction,
	SafeTransactionData,
	SafeSignature,
	SafeMessage,
	SafeConfig,
	EIP1193ProviderWithRequestFn,
	PicoSafeRpcBlockIdentifier,
	FullSafeTransaction,
	Prettify,
	SignatureType,
	VerifySafeSignaturesParams,
	VerifySafeSignaturesOffchainParams,
	SignatureValidationDetail,
	SignatureVerificationResult,
};
