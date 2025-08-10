import type {
	EIP1193ProviderWithRequestFn,
	Hex,
	MaybeLazy,
	StateReadCall,
	WrappedStateRead,
	WrapResult,
} from "../types";

/**
 * Wraps an `eth_call` so it can either execute immediately (default) or be
 * deferred for later/batched execution.
 *
 * This utility function creates a wrapper around an eth_call request that can either:
 * - Execute immediately and return the decoded result (default behavior)
 * - Return a wrapped object with the raw call data and a convenience function for deferred execution
 *
 * The lazy evaluation mode enables batching multiple state reads into a single multicall,
 * reducing the number of RPC requests and improving performance.
 *
 * @param {EIP1193ProviderWithRequestFn} provider - EIP-1193 compatible provider for blockchain interaction
 * @param {StateReadCall} call - The RPC call parameters (to, data, block) {@link StateReadCall}
 * @param {(result: Hex) => T} decoder - Function to decode the raw hex result into the desired type
 * @param {MaybeLazy<A>} options - Options for lazy evaluation, block context, and additional metadata {@link MaybeLazy}
 *
 * @returns {Promise<T> | WrappedStateRead<T, A>} The decoded result or a wrapped call object based on options {@link WrappedStateRead}
 *
 * @example
 * // Immediate execution (default)
 * const nonce = await wrapStateRead(
 *   provider,
 *   { to: safeAddress, data: getNonceCalldata },
 *   decodeNonce
 * );
 * console.log(nonce); // 5n
 *
 * @example
 * // Immediate execution with specific block
 * const nonce = await wrapStateRead(
 *   provider,
 *   { to: safeAddress, data: getNonceCalldata },
 *   decodeNonce,
 *   { block: 12345n }
 * );
 *
 * @example
 * // Lazy evaluation
 * const nonceCall = wrapStateRead(
 *   provider,
 *   { to: safeAddress, data: getNonceCalldata },
 *   decodeNonce,
 *   { lazy: true }
 * );
 * // Use later or batch with multicall
 * const nonce = await nonceCall.call();
 *
 * @example
 * // Lazy evaluation with metadata and block context
 * const nonceCall = wrapStateRead(
 *   provider,
 *   { to: safeAddress, data: getNonceCalldata },
 *   decodeNonce,
 *   { lazy: true, data: { purpose: 'validation' }, block: 'pending' }
 * );
 * console.log(nonceCall.data.purpose); // 'validation'
 */
export function wrapStateRead<
	T,
	A = void,
	O extends MaybeLazy<A> | undefined = undefined,
>(
	provider: EIP1193ProviderWithRequestFn,
	call: StateReadCall,
	decoder: (result: Hex) => T,
	options?: O,
): WrapResult<T, A, O> {
	const { lazy = false, data, block } = (options ?? {}) as MaybeLazy<A>;

	/** Performs the underlying `eth_call` and decodes the result. */
	const exec = async (): Promise<T> => {
		const result = (await provider.request({
			method: "eth_call",
			params: [
				{ to: call.to, data: call.data },
				block ?? call.block ?? "latest",
			],
		})) as Hex;

		return decoder(result);
	};

	// ────────────────────────────────────────────────────────────────────────────
	// Immediate mode
	// ────────────────────────────────────────────────────────────────────────────
	if (!lazy) {
		return exec() as WrapResult<T, A, O>;
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Lazy mode – build the wrapper, attaching metadata only when present.
	// ────────────────────────────────────────────────────────────────────────────
	const rawCall: StateReadCall = {
		to: call.to,
		data: call.data,
		block: block ?? call.block,
	};

	if (data === undefined) {
		return {
			rawCall,
			call: exec,
		} as WrapResult<T, A, O>;
	}

	return {
		rawCall,
		call: exec,
		data,
	} as WrapResult<T, A, O>;
}
