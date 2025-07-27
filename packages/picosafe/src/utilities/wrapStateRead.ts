import type { Hex } from "viem";
import type {
	EIP1193ProviderWithRequestFn,
	StateReadCall,
	StateReadOptions,
	WrappedStateRead,
} from "../types";

/**
 * Wraps a state read call with optional lazy evaluation
 *
 * This utility function creates a wrapper around an eth_call request that can either:
 * - Execute immediately and return the decoded result (default behavior)
 * - Return a wrapped object with the raw call data and a convenience function for deferred execution
 *
 * The lazy evaluation mode enables batching multiple state reads into a single multicall,
 * reducing the number of RPC requests and improving performance.
 *
 * @param {EIP1193ProviderWithRequestFn} provider - EIP-1193 compatible provider for blockchain interaction
 * @param {StateReadCall} call - The RPC call parameters (to, data, block)
 * @param {(result: Hex) => T} decoder - Function to decode the raw hex result into the desired type
 * @param {StateReadOptions} options - Options for lazy evaluation and additional metadata
 *
 * @returns {Promise<T> | WrappedStateRead<T>} The decoded result or a wrapped call object based on options
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
 * // With additional metadata
 * const nonceCall = wrapStateRead(
 *   provider,
 *   { to: safeAddress, data: getNonceCalldata },
 *   decodeNonce,
 *   { lazy: true, data: { purpose: 'validation' } }
 * );
 * console.log(nonceCall.data.purpose); // 'validation'
 */
function wrapStateRead<T>(
	provider: EIP1193ProviderWithRequestFn,
	call: StateReadCall,
	decoder: (result: Hex) => T,
	options?: { lazy?: false },
): Promise<T>;
function wrapStateRead<T>(
	provider: EIP1193ProviderWithRequestFn,
	call: StateReadCall,
	decoder: (result: Hex) => T,
	options: { lazy: true },
): WrappedStateRead<T, void>;
function wrapStateRead<T, A>(
	provider: EIP1193ProviderWithRequestFn,
	call: StateReadCall,
	decoder: (result: Hex) => T,
	options: { lazy: true; data: A },
): WrappedStateRead<T, A>;
function wrapStateRead<T, A>(
	provider: EIP1193ProviderWithRequestFn,
	call: StateReadCall,
	decoder: (result: Hex) => T,
	options: StateReadOptions<A>,
): A extends void
	? StateReadOptions<A>["lazy"] extends true
		? WrappedStateRead<T, void>
		: Promise<T>
	: StateReadOptions<A>["lazy"] extends true
		? WrappedStateRead<T, A>
		: Promise<T>;
function wrapStateRead<T, A = void>(
	provider: EIP1193ProviderWithRequestFn,
	call: StateReadCall,
	decoder: (result: Hex) => T,
	options?: StateReadOptions<A>,
): Promise<T> | WrappedStateRead<T, A> {
	const { lazy = false, data } = options || {};

	async function executeCall(): Promise<T> {
		const result = await provider.request({
			method: "eth_call",
			params: [
				{
					to: call.to,
					data: call.data,
				},
				call.block || "latest",
			],
		});

		return decoder(result);
	}

	if (!lazy) {
		return executeCall();
	}

	const rawCall: StateReadCall = {
		to: call.to,
		data: call.data,
		block: call.block,
	};

	if (data === undefined) {
		return {
			rawCall,
			call: executeCall,
		} as WrappedStateRead<T, A>;
	}

	return {
		rawCall,
		call: executeCall,
		data,
	} as WrappedStateRead<T, A>;
}

/**
 * Helper function that properly handles StateReadOptions and calls wrapStateRead with the right overload
 * This avoids code duplication in each state read function
 */
function wrapStateReadWithOptions<T>(
	provider: EIP1193ProviderWithRequestFn,
	call: StateReadCall,
	decoder: (result: Hex) => T,
	options?: StateReadOptions<void>,
): Promise<T>;
function wrapStateReadWithOptions<T>(
	provider: EIP1193ProviderWithRequestFn,
	call: StateReadCall,
	decoder: (result: Hex) => T,
	options: StateReadOptions<void> & { lazy: true },
): WrappedStateRead<T, void>;
function wrapStateReadWithOptions<T, A>(
	provider: EIP1193ProviderWithRequestFn,
	call: StateReadCall,
	decoder: (result: Hex) => T,
	options: StateReadOptions<A> & { lazy: true; data: A },
): WrappedStateRead<T, A>;
function wrapStateReadWithOptions<T, A = void>(
	provider: EIP1193ProviderWithRequestFn,
	call: StateReadCall,
	decoder: (result: Hex) => T,
	options?: StateReadOptions<A>,
): Promise<T> | WrappedStateRead<T, A> {
	if (!options || !options.lazy) {
		return wrapStateRead(provider, call, decoder);
	}

	if ("data" in options && options.data !== undefined) {
		return wrapStateRead(provider, call, decoder, {
			lazy: true,
			data: options.data,
		}) as WrappedStateRead<T, A>;
	}

	return wrapStateRead(provider, call, decoder, {
		lazy: true,
	}) as WrappedStateRead<T, A>;
}

export { wrapStateRead, wrapStateReadWithOptions };
