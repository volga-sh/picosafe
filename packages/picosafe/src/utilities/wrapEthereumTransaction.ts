import type {
	Address,
	Hex,
	RpcTransactionRequest,
	TransactionRequest,
} from "viem";
import { toHex } from "viem";
import type { EIP1193ProviderWithRequestFn } from "../types";
import { getAccounts } from "./eip1193-provider";

/**
 * Represents a wrapped Ethereum transaction with additional functionality
 */
type WrappedTransaction<A = void> = A extends void
	? {
			/** The raw transaction request object */
			rawTransaction: TransactionRequest;
			/** Function to send the transaction with optional overrides */
			send: (overrides?: Partial<TransactionRequest>) => Promise<Hex>;
		}
	: {
			/** The raw transaction request object */
			rawTransaction: TransactionRequest;
			/** Function to send the transaction with optional overrides */
			send: (overrides?: Partial<TransactionRequest>) => Promise<Hex>;
			/** Additional data attached to the wrapped transaction */
			data: A;
		};

/**
 * Wraps an Ethereum transaction request with a convenient send function and optional metadata
 *
 * This utility function creates a wrapper around a transaction request that includes:
 * - The raw transaction object for inspection
 * - A send function that executes the transaction with optional overrides
 * - Optional additional data that can be attached to the transaction wrapper
 *
 * The send function allows for last-minute transaction modifications through overrides,
 * enabling adjustments to gas prices, nonce, or other transaction parameters at send time.
 *
 * @param {EIP1193Provider} provider - EIP-1193 compatible provider for blockchain interaction
 * @param {TransactionRequest} transaction - The transaction request object containing to, data, value, etc.
 * @param {A} [data] - Optional additional data to attach to the wrapped transaction
 *
 * @returns {WrappedTransaction<A>} Object containing the raw transaction, send function, and optional additional data
 *
 * @throws {Error} If the provider rejects the transaction
 * @throws {Error} If the transaction parameters are invalid
 *
 * @example
 * // Basic usage with a simple transfer
 * const wrappedTx = wrapEthereumTransaction(provider, {
 *   to: '0x742d35Cc6634C0532925a3b844Bc9e7595f6E123',
 *   value: '0x1000000000000000', // 0.001 ETH
 *   data: '0x'
 * });
 *
 * // Send with default parameters
 * const txHash = await wrappedTx.send();
 * console.log('Transaction sent:', txHash);
 *
 * @example
 * // Using overrides to adjust gas price at send time
 * const wrappedTx = wrapEthereumTransaction(provider, {
 *   to: contractAddress,
 *   data: encodedFunctionData
 * });
 *
 * // Override gas parameters when sending
 * const txHash = await wrappedTx.send({
 *   maxFeePerGas: '0x77359400', // 2 gwei
 *   maxPriorityFeePerGas: '0x3b9aca00' // 1 gwei
 * });
 *
 * @example
 * // With additional data for tracking
 * const wrappedTx = wrapEthereumTransaction(
 *   provider,
 *   {
 *     to: safeAddress,
 *     data: transactionData
 *   },
 *   {
 *     operationType: 'addOwner',
 *     timestamp: Date.now()
 *   }
 * );
 *
 * // Access additional data
 * console.log('Operation:', wrappedTx.data.operationType);
 * const txHash = await wrappedTx.send();
 */
function wrapEthereumTransaction(
	provider: EIP1193ProviderWithRequestFn,
	transaction: {
		to: Address;
		value?: bigint;
		data?: Hex;
	} & Partial<Omit<TransactionRequest, "to" | "value" | "data">>,
): WrappedTransaction<void>;
function wrapEthereumTransaction<A>(
	provider: EIP1193ProviderWithRequestFn,
	transaction: {
		to: Address;
		value?: bigint;
		data?: Hex;
	} & Partial<Omit<TransactionRequest, "to" | "value" | "data">>,
	data: A,
): WrappedTransaction<A>;
function wrapEthereumTransaction<A = void>(
	provider: EIP1193ProviderWithRequestFn,
	transaction: {
		to: Address;
		value?: bigint;
		data?: Hex;
	} & Partial<Omit<TransactionRequest, "to" | "value" | "data">>,
	data?: A,
): WrappedTransaction<A> {
	async function send(overrides?: Partial<TransactionRequest>): Promise<Hex> {
		const txRequest = {
			...transaction,
			...overrides,
		};

		let from = txRequest.from;
		if (!from) {
			const accounts = await getAccounts(provider);
			if (accounts.length === 0) {
				throw new Error("No accounts available");
			}
			from = accounts[0];
		}

		const rpcTransaction: RpcTransactionRequest = {
			from,
			to: txRequest.to,
		};

		// Populate optional fields
		if (txRequest.data !== undefined) {
			rpcTransaction.data = txRequest.data;
		}
		if (txRequest.value !== undefined) {
			rpcTransaction.value = toHex(txRequest.value);
		}
		if (txRequest.gas !== undefined) {
			rpcTransaction.gas = toHex(txRequest.gas);
		}
		if (txRequest.gasPrice !== undefined) {
			rpcTransaction.gasPrice = toHex(txRequest.gasPrice);
		}
		if (txRequest.maxFeePerGas !== undefined) {
			rpcTransaction.maxFeePerGas = toHex(txRequest.maxFeePerGas);
		}
		if (txRequest.maxPriorityFeePerGas !== undefined) {
			rpcTransaction.maxPriorityFeePerGas = toHex(
				txRequest.maxPriorityFeePerGas,
			);
		}
		if (txRequest.nonce !== undefined) {
			rpcTransaction.nonce = toHex(txRequest.nonce);
		}
		if (rpcTransaction.gas === undefined) {
			const gasEstimate = await provider.request({
				method: "eth_estimateGas",
				params: [rpcTransaction],
			});

			// Add 20% buffer to gas estimate for safety
			// Sometimes the transaction may use more gas than estimated
			// e.g., in case of a gas refund, where the refund is applied after the transaction is executed
			const gasEstimateBigInt = BigInt(gasEstimate);
			const gasWithBuffer = (gasEstimateBigInt * 120n) / 100n;
			rpcTransaction.gas = toHex(gasWithBuffer);
		}

		if (
			rpcTransaction.gasPrice === undefined &&
			rpcTransaction.maxFeePerGas === undefined &&
			rpcTransaction.maxPriorityFeePerGas === undefined
		) {
			rpcTransaction.gasPrice = await provider.request({
				method: "eth_gasPrice",
			});
		}

		const txHash = await provider.request({
			method: "eth_sendTransaction",
			params: [rpcTransaction],
		});

		return txHash;
	}

	if (data === undefined) {
		return {
			rawTransaction: transaction,
			send,
		} as WrappedTransaction<A>;
	}

	return {
		rawTransaction: transaction,
		send,
		data,
	} as WrappedTransaction<A>;
}

export { wrapEthereumTransaction };
export type { WrappedTransaction };
