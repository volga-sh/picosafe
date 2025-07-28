import type { Address, Hex, Quantity } from "viem";
import type {
	EIP1193ProviderWithRequestFn,
	MaybeLazy,
	StateReadCall,
	WrappedStateRead,
	WrapResult,
} from "./types";
import { checksumAddress } from "./utilities/address";
import { SENTINEL_NODE } from "./utilities/constants";
import { encodeWithSelector, padStartHex } from "./utilities/encoding.js";
import { wrapStateRead } from "./utilities/wrapStateRead";

/**
 * Constant offsets for parsing storage results from getStorageAt calls.
 * The ABI encoding for getStorageAt returns:
 * - Bytes 0-63: Offset pointer to the data array (always 0x20)
 * - Bytes 64-127: Length of the data array
 * - Bytes 128+: Actual storage slot values (32 bytes each)
 */
const STORAGE_RESULT_OFFSET_START = 130; // Skip "0x" + offset (64) + length (64)
const STORAGE_RESULT_OFFSET_END = 194; // Read 64 chars (32 bytes)

/**
 * Parses an Ethereum address from a storage slot result.
 * Storage slots are 32 bytes, but addresses are only 20 bytes.
 * Addresses are right-aligned in their slots, so we take the last 40 hex chars.
 *
 * @param result - The raw hex result from a storage read
 * @returns The checksummed address extracted from the storage slot
 * @internal
 */
function parseAddressFromStorageResult(result: Hex): Address {
	// Skip offset (64) + length (64) = 128 chars, then read 64 chars for the slot
	// Take the last 40 chars (20 bytes) which contain the address
	const addressHex = result
		.slice(STORAGE_RESULT_OFFSET_START, STORAGE_RESULT_OFFSET_END)
		.slice(-40);
	return checksumAddress(`0x${addressHex}`);
}

/**
 * State Read Functions Design Note
 * ================================
 *
 * State read functions in this module follow a different pattern than transaction-generating functions.
 * While transaction functions return `{ rawTransaction, send() }`, state reads return either:
 * - A direct value (e.g., `bigint`, `Address[]`) for immediate execution
 * - A `WrappedStateRead` object with `{ rawCall, call() }` for lazy evaluation
 *
 * This deviation is intentional because:
 * 1. State reads are eth_call operations that don't modify blockchain state
 * 2. The lazy evaluation pattern enables efficient batching via multicall contracts
 * 3. Direct value returns provide better ergonomics for simple read operations
 * 4. The pattern aligns with common RPC provider interfaces for read operations
 *
 * The lazy evaluation mode is particularly valuable for reading multiple Safe parameters
 * in a single RPC request, reducing latency and improving performance.
 */

/**
 * Defines the well-known storage slot addresses used by Safe contracts.
 * These slots are used to store critical Safe configuration parameters like owners, threshold, nonce, and module/guard addresses.
 * The values are represented as 32-byte hexadecimal strings, padded with leading zeros to match the EVM storage slot size.
 * For mapping storage slots (e.g., `modulesMapping`, `ownersMapping`, `signedMessagesMapping`, `approvedHashesMapping`), the final storage slot is computed as `keccak256(abi.encodePacked(mapping_key, mapping_position))`, where `mapping_key` is the key used in the mapping and `mapping_position` is the base slot for that mapping.
 *
 * @property singleton - Storage slot for the Safe singleton (implementation) address (slot 0).
 * @property modulesMapping - Storage slot for the modules mapping (slot 1).
 * @property ownersMapping - Storage slot for the owners mapping (slot 2).
 * @property ownerCount - Storage slot for the owner count (slot 3).
 * @property threshold - Storage slot for the signature threshold (slot 4).
 * @property nonce - Storage slot for the transaction nonce (slot 5).
 * @property deprecatedDomainSeparator - Deprecated storage slot for the EIP-712 domain separator (slot 6).
 * @property signedMessagesMapping - Storage slot for the signed messages mapping (slot 7).
 * @property approvedHashesMapping - Storage slot for the approved hashes mapping (slot 8).
 * @property fallbackHandler - Storage slot for the custom fallback handler address (keccak256("fallback_manager.handler.address")).
 * @property guard - Storage slot for the custom guard address (keccak256("guard_manager.guard.address")).
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/libraries/SafeStorage.sol
 */
const SAFE_STORAGE_SLOTS = {
	singleton: padStartHex("0"),
	modulesMapping: padStartHex("1"),
	ownersMapping: padStartHex("2"),
	ownerCount: padStartHex("3"),
	threshold: padStartHex("4"),
	nonce: padStartHex("5"),
	deprecatedDomainSeparator: padStartHex("6"),
	signedMessagesMapping: padStartHex("7"),
	approvedHashesMapping: padStartHex("8"),
	// keccak256("fallback_manager.handler.address")
	fallbackHandler:
		"0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5",
	// keccak256("guard_manager.guard.address")
	guard: "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8",
} as const;

/**
 * Reads raw storage slots from a Safe contract by performing an eth_call with the getStorageAt function selector.
 *
 * @remarks
 * Uses the `getStorageAt(uint256 slot, uint256 length)` function selector (`0x5624b25b`) to query one or more storage slots.
 * This design enables batching multiple storage reads into a single RPC request via a multicall contract.
 *
 * @param provider - An EIP-1193 compliant provider used to perform the eth_call
 * @param params - Parameters for the storage read
 *                 - `safeAddress`: The address of the Safe contract whose storage is being queried
 *                 - `slot`: The storage slot to read (as a Quantity)
 *                 - `length`: Optional number of 32-byte slots to read (defaults to 1)
 * @param options - Optional execution options
 *                  - `lazy`: If true, returns a wrapped call object instead of executing immediately
 *                  - `block`: Block number or tag to query at (defaults to "latest")
 *                  - `data`: Optional additional data to attach to the wrapped call
 * @returns An array of Hex strings representing the raw storage values for each slot, or a wrapped call object
 * @throws {Error} If the eth_call fails
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getStorageAt } from "picosafe/account-state";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 *
 * // Immediate execution (default)
 * const values = await getStorageAt(
 *   provider,
 *   {
 *     safeAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4278',
 *     slot: '0x5' // slot 5
 *   }
 * );
 * console.log(values); // e.g., ['0x000...abc']
 *
 * // Read two slots
 * const [slot0, slot1] = await getStorageAt(
 *   provider,
 *   {
 *     safeAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4278',
 *     slot: '0x0',
 *     length: 2n
 *   }
 * );
 *
 * // Lazy evaluation for batching
 * const storageCall = await getStorageAt(
 *   provider,
 *   {
 *     safeAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4278',
 *     slot: '0x5'
 *   },
 *   { lazy: true }
 * );
 * // Execute later or batch with multicall
 * const values = await storageCall.call();
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/common/StorageAccessible.sol#L17
 */
function getStorageAt<A = void, O extends MaybeLazy<A> | undefined = undefined>(
	provider: EIP1193ProviderWithRequestFn,
	params: {
		safeAddress: Address;
		slot: Quantity;
		length?: bigint;
	},
	options?: O,
): WrapResult<Hex[], A, O> {
	const { safeAddress, slot, length = 1n } = params;
	const { block = "latest" } = options || {};

	const getStorageAtSelector = "0x5624b25b";
	const callData: Hex = encodeWithSelector(getStorageAtSelector, slot, length);

	const call: StateReadCall = {
		to: safeAddress,
		data: callData,
		block,
	};

	const decoder = (result: Hex): Hex[] => {
		if (result === "0x") {
			throw new Error(
				`Failed to retrieve storage at slot ${slot} for Safe at ${safeAddress}`,
			);
		}

		const decodedResult: Hex[] = [];
		// We start at 64 byte (128 in hex, +2 for '0x' prefix) because the first 64 bytes are the offset + length of the result
		for (let i = 130; i < result.length; i += 64) {
			decodedResult.push(`0x${result.slice(i, i + 64)}`);
		}

		return decodedResult;
	};

	return wrapStateRead(provider, call, decoder, options) as WrapResult<
		Hex[],
		A,
		O
	>;
}

/**
 * Retrieves the current transaction nonce for a Safe contract by reading its storage slot.
 * The nonce is incremented after each successful transaction execution to prevent replay attacks.
 *
 * @remarks
 * Reads directly from storage slot `SAFE_STORAGE_SLOTS.nonce` (slot 5) via `getStorageAt`.
 * This design enables batching multiple getStorageAt calls into a single RPC request via a multicall contract.
 *
 * @param provider - An EIP-1193 compliant provider used to perform the eth_call
 * @param params - Parameters for the nonce read
 *                 - `safeAddress`: The address of the Safe contract whose nonce is being fetched
 * @param options - Optional execution options
 *                  - `lazy`: If true, returns a wrapped call object instead of executing immediately
 *                  - `block`: Block number or tag to query at (defaults to "latest")
 *                  - `data`: Optional additional data to attach to the wrapped call
 * @returns The current nonce value as a bigint, or a wrapped call object {@link WrappedStateRead}
 * @throws {Error} If no storage value is returned (e.g., invalid Safe address)
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getNonce } from "picosafe/account-state";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 *
 * // Immediate execution (default)
 * const nonce = await getNonce(
 *   provider,
 *   { safeAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4278' }
 * );
 * console.log('Current nonce:', nonce); // e.g., 5n
 *
 * // Query nonce at specific block
 * const historicalNonce = await getNonce(
 *   provider,
 *   { safeAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4278' },
 *   { block: '0x112a880' } // block number as hex
 * );
 *
 * // Lazy evaluation for batching
 * const nonceCall = await getNonce(
 *   provider,
 *   { safeAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4278' },
 *   { lazy: true }
 * );
 * const nonce = await nonceCall.call();
 * ```
 */
function getNonce<A = void, O extends MaybeLazy<A> | undefined = undefined>(
	provider: EIP1193ProviderWithRequestFn,
	params: { safeAddress: Address },
	options?: O,
): WrapResult<bigint, A, O> {
	const { safeAddress } = params;
	const { block = "latest" } = options || {};

	const call: StateReadCall = {
		to: safeAddress,
		data: encodeWithSelector("0x5624b25b", SAFE_STORAGE_SLOTS.nonce, 1n),
		block,
	};

	const decoder = (result: Hex): bigint => {
		if (result === "0x") {
			throw new Error(`Failed to retrieve nonce for Safe at ${safeAddress}`);
		}

		// Decode the nonce from the result
		const nonceHex = result.slice(
			STORAGE_RESULT_OFFSET_START,
			STORAGE_RESULT_OFFSET_END,
		);
		if (!nonceHex) {
			throw new Error(`Failed to retrieve nonce for Safe at ${safeAddress}`);
		}
		return BigInt(`0x${nonceHex}`);
	};

	return wrapStateRead(provider, call, decoder, options) as WrapResult<
		bigint,
		A,
		O
	>;
}

/**
 * Retrieves the fallback handler address for a Safe contract by reading its storage slot.
 * The fallback handler is used to handle transactions and messages that don't match
 * any standard Safe function signature.
 *
 * @remarks
 * Reads directly from storage slot `SAFE_STORAGE_SLOTS.fallbackHandler` via `getStorageAt`.
 * This design enables batching multiple fallback handler reads into a single RPC request via a multicall contract.
 *
 * @param provider - An EIP-1193 compliant provider used to perform the eth_call
 * @param params - Parameters for the fallback handler read
 *                 - `safeAddress`: The address of the Safe contract
 * @param options - Optional execution options
 *                  - `lazy`: If true, returns a wrapped call object instead of executing immediately
 *                  - `block`: Block number or tag to query at (defaults to "latest")
 *                  - `data`: Optional additional data to attach to the wrapped call
 * @returns The fallback handler address, or zero address if none configured, or a wrapped call object
 * @throws {Error} If no storage value is returned (e.g., invalid Safe address)
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getFallbackHandler } from "picosafe/account-state";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 *
 * // Immediate execution (default)
 * const handler = await getFallbackHandler(
 *   provider,
 *   { safeAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4278' }
 * );
 * console.log('Fallback handler:', handler);
 * // e.g., '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99'
 *
 * // Lazy evaluation for batching
 * const handlerCall = await getFallbackHandler(
 *   provider,
 *   { safeAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4278' },
 *   { lazy: true }
 * );
 * const handler = await handlerCall.call();
 * ```
 */
function getFallbackHandler<
	A = void,
	O extends MaybeLazy<A> | undefined = undefined,
>(
	provider: EIP1193ProviderWithRequestFn,
	params: { safeAddress: Address },
	options?: O,
): WrapResult<Address, A, O> {
	const { safeAddress } = params;
	const { block = "latest" } = options || {};

	const call: StateReadCall = {
		to: safeAddress,
		data: encodeWithSelector(
			"0x5624b25b",
			SAFE_STORAGE_SLOTS.fallbackHandler,
			1n,
		),
		block,
	};

	const decoder = (result: Hex): Address => {
		if (result === "0x") {
			throw new Error(
				`Failed to retrieve fallback handler for Safe at ${safeAddress}`,
			);
		}
		return parseAddressFromStorageResult(result);
	};

	return wrapStateRead(provider, call, decoder, options) as WrapResult<
		Address,
		A,
		O
	>;
}

/**
 * Retrieves the number of owners configured on a Safe contract by reading its storage slot.
 *
 * @remarks
 * Reads directly from storage slot `SAFE_STORAGE_SLOTS.ownerCount` (slot 3) via `getStorageAt`.
 * This design enables batching multiple ownerCount reads into a single RPC request via a multicall contract.
 *
 * @param provider - An EIP-1193 compliant provider used to perform the eth_call
 * @param params - Parameters for the owner count read
 *                 - `safeAddress`: The address of the Safe contract whose owner count is being fetched
 * @param options - Optional execution options
 *                  - `lazy`: If true, returns a wrapped call object instead of executing immediately
 *                  - `block`: Block number or tag to query at (defaults to "latest")
 *                  - `data`: Optional additional data to attach to the wrapped call
 * @returns The current owner count value as a bigint, or a wrapped call object
 * @throws {Error} If no storage value is returned (e.g., invalid Safe address)
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getOwnerCount } from "picosafe/account-state";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 *
 * // Immediate execution (default)
 * const count = await getOwnerCount(provider, { safeAddress });
 * console.log('Owner count:', count); // e.g., 2n
 *
 * // Lazy evaluation for batching
 * const countCall = await getOwnerCount(
 *   provider,
 *   { safeAddress },
 *   { lazy: true }
 * );
 * const count = await countCall.call();
 * ```
 */
function getOwnerCount<
	A = void,
	O extends MaybeLazy<A> | undefined = undefined,
>(
	provider: EIP1193ProviderWithRequestFn,
	params: { safeAddress: Address },
	options?: O,
): WrapResult<bigint, A, O> {
	const { safeAddress } = params;
	const { block = "latest" } = options || {};

	const call: StateReadCall = {
		to: safeAddress,
		data: encodeWithSelector("0x5624b25b", SAFE_STORAGE_SLOTS.ownerCount, 1n),
		block,
	};

	const decoder = (result: Hex): bigint => {
		if (result === "0x") {
			throw new Error(
				`Failed to retrieve owner count for Safe at ${safeAddress}`,
			);
		}
		// Decode the count from the result
		const countHex = result.slice(
			STORAGE_RESULT_OFFSET_START,
			STORAGE_RESULT_OFFSET_END,
		);
		return BigInt(`0x${countHex}`);
	};

	return wrapStateRead(provider, call, decoder, options) as WrapResult<
		bigint,
		A,
		O
	>;
}

/**
 * Retrieves the threshold (minimum signatures required) for a Safe contract by reading its storage slot.
 *
 * @remarks
 * Reads directly from storage slot `SAFE_STORAGE_SLOTS.threshold` (slot 4) via `getStorageAt`.
 * This design enables batching multiple threshold reads into a single RPC request via a multicall contract.
 *
 * @param provider - An EIP-1193 compliant provider used to perform the eth_call
 * @param params - Parameters for the threshold read
 *                 - `safeAddress`: The address of the Safe contract whose threshold is being fetched
 * @param options - Optional execution options
 *                  - `lazy`: If true, returns a wrapped call object instead of executing immediately
 *                  - `block`: Block number or tag to query at (defaults to "latest")
 *                  - `data`: Optional additional data to attach to the wrapped call
 * @returns The current threshold value as a bigint, or a wrapped call object
 * @throws {Error} If no storage value is returned (e.g., invalid Safe address)
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getThreshold } from "picosafe/account-state";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 *
 * // Immediate execution (default)
 * const threshold = await getThreshold(provider, { safeAddress });
 * console.log('Threshold:', threshold); // e.g., 1n
 *
 * // Lazy evaluation for batching
 * const thresholdCall = await getThreshold(
 *   provider,
 *   { safeAddress },
 *   { lazy: true }
 * );
 * const threshold = await thresholdCall.call();
 * ```
 */
function getThreshold<A = void, O extends MaybeLazy<A> | undefined = undefined>(
	provider: EIP1193ProviderWithRequestFn,
	params: { safeAddress: Address },
	options?: O,
): WrapResult<bigint, A, O> {
	const { safeAddress } = params;
	const { block = "latest" } = options || {};

	const call: StateReadCall = {
		to: safeAddress,
		data: encodeWithSelector("0x5624b25b", SAFE_STORAGE_SLOTS.threshold, 1n),
		block,
	};

	const decoder = (result: Hex): bigint => {
		if (result === "0x") {
			throw new Error(
				`Failed to retrieve threshold for Safe at ${safeAddress}`,
			);
		}
		// Decode the threshold from the result
		const thresholdHex = result.slice(
			STORAGE_RESULT_OFFSET_START,
			STORAGE_RESULT_OFFSET_END,
		);
		return BigInt(`0x${thresholdHex}`);
	};

	return wrapStateRead(provider, call, decoder, options) as WrapResult<
		bigint,
		A,
		O
	>;
}

/**
 * Retrieves the guard address for a Safe contract by reading its storage slot.
 * The guard can enforce custom transaction-validation logic.
 *
 * @remarks
 * Reads directly from storage slot `SAFE_STORAGE_SLOTS.guard` via `getStorageAt`.
 * This design enables batching multiple guard reads into a single RPC request via a multicall contract.
 *
 * @param provider - An EIP-1193 compliant provider used to perform the eth_call
 * @param params - Parameters for the guard read
 *                 - `safeAddress`: The address of the Safe contract whose guard is being fetched
 * @param options - Optional execution options
 *                  - `lazy`: If true, returns a wrapped call object instead of executing immediately
 *                  - `block`: Block number or tag to query at (defaults to "latest")
 *                  - `data`: Optional additional data to attach to the wrapped call
 * @returns The guard contract address, or zero address if none configured, or a wrapped call object
 * @throws {Error} If no storage value is returned (e.g., invalid Safe address)
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getGuard } from "picosafe/account-state";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 *
 * // Immediate execution (default)
 * const guard = await getGuard(provider, { safeAddress });
 * console.log('Guard address:', guard);
 *
 * // Lazy evaluation for batching
 * const guardCall = await getGuard(
 *   provider,
 *   { safeAddress },
 *   { lazy: true }
 * );
 * const guard = await guardCall.call();
 * ```
 */
function getGuard<A = void, O extends MaybeLazy<A> | undefined = undefined>(
	provider: EIP1193ProviderWithRequestFn,
	params: { safeAddress: Address },
	options?: O,
): WrapResult<Address, A, O> {
	const { safeAddress } = params;
	const { block = "latest" } = options || {};

	const call: StateReadCall = {
		to: safeAddress,
		data: encodeWithSelector("0x5624b25b", SAFE_STORAGE_SLOTS.guard, 1n),
		block,
	};

	const decoder = (result: Hex): Address => {
		if (result === "0x") {
			throw new Error(`Failed to retrieve guard for Safe at ${safeAddress}`);
		}
		return parseAddressFromStorageResult(result);
	};

	return wrapStateRead(provider, call, decoder, options) as WrapResult<
		Address,
		A,
		O
	>;
}

/**
 * Retrieves the singleton address for a Safe contract by reading its storage slot.
 * The singleton is the implementation contract address behind the proxy.
 *
 * @remarks
 * Reads directly from storage slot `SAFE_STORAGE_SLOTS.singleton` (slot 0) via `getStorageAt`.
 * This design enables batching multiple singleton reads into a single RPC request via a multicall contract.
 *
 * @param provider - An EIP-1193 compliant provider used to perform the eth_call
 * @param params - Parameters for the singleton read
 *                 - `safeAddress`: The address of the Safe contract whose singleton is being fetched
 * @param options - Optional execution options
 *                  - `lazy`: If true, returns a wrapped call object instead of executing immediately
 *                  - `block`: Block number or tag to query at (defaults to "latest")
 *                  - `data`: Optional additional data to attach to the wrapped call
 * @returns The singleton implementation contract address, or a wrapped call object
 * @throws {Error} If no storage value is returned (e.g., invalid Safe address)
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getSingleton } from "picosafe/account-state";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 *
 * // Immediate execution (default)
 * const impl = await getSingleton(provider, { safeAddress });
 * console.log('Implementation address:', impl);
 *
 * // Lazy evaluation for batching
 * const singletonCall = await getSingleton(
 *   provider,
 *   { safeAddress },
 *   { lazy: true }
 * );
 * const impl = await singletonCall.call();
 * ```
 */
function getSingleton<A = void, O extends MaybeLazy<A> | undefined = undefined>(
	provider: EIP1193ProviderWithRequestFn,
	params: { safeAddress: Address },
	options?: O,
): WrapResult<Address, A, O> {
	const { safeAddress } = params;
	const { block = "latest" } = options || {};

	const call: StateReadCall = {
		to: safeAddress,
		data: encodeWithSelector("0x5624b25b", SAFE_STORAGE_SLOTS.singleton, 1n),
		block,
	};

	const decoder = (result: Hex): Address => {
		if (result === "0x") {
			throw new Error(
				`Failed to retrieve singleton for Safe at ${safeAddress}`,
			);
		}
		return parseAddressFromStorageResult(result);
	};

	return wrapStateRead(provider, call, decoder, options) as WrapResult<
		Address,
		A,
		O
	>;
}

/**
 * Gets all owners of a Safe.
 * This function retrieves the complete list of owner addresses that have control
 * over the Safe multi-sig wallet. The owners are returned in the order they are
 * stored in the Safe's internal linked list structure.
 *
 * @param provider - EIP-1193 compatible provider for blockchain interaction
 * @param params - Parameters for the owners read
 *                 - `safeAddress`: Ethereum address of the Safe contract to query
 * @param options - Optional execution options
 *                  - `lazy`: If true, returns a wrapped call object instead of executing immediately
 *                  - `block`: Block number or tag to query at (defaults to "latest")
 *                  - `data`: Optional additional data to attach to the wrapped call
 * @returns {Promise<Address[]>} Array of checksummed owner addresses in the order they are stored, or a wrapped call object
 * @throws {Error} When address validation fails
 * @throws {Error} When the RPC call fails
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getOwners } from "picosafe/account-state";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 *
 * // Get all owners of a Safe - immediate execution (default)
 * const owners = await getOwners(
 *   provider,
 *   { safeAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f4d3e2" }
 * );
 * console.log(`Safe has ${owners.length} owners:`);
 * owners.forEach((owner, index) => {
 *   console.log(`  ${index + 1}. ${owner}`);
 * });
 * // Output:
 * // Safe has 3 owners:
 * //   1. 0xabc0000000000000000000000000000000000001
 * //   2. 0xdef0000000000000000000000000000000000002
 * //   3. 0x1230000000000000000000000000000000000003
 *
 * // Lazy evaluation for batching
 * const ownersCall = await getOwners(
 *   provider,
 *   { safeAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f4d3e2" },
 *   { lazy: true }
 * );
 * const owners = await ownersCall.call();
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/OwnerManager.sol#L148
 */
function getOwners<A = void, O extends MaybeLazy<A> | undefined = undefined>(
	provider: EIP1193ProviderWithRequestFn,
	params: { safeAddress: Address },
	options?: O,
): WrapResult<Address[], A, O> {
	const { safeAddress } = params;
	const { block = "latest" } = options || {};

	// selector for `getOwners() returns(address[] memory)`
	const getOwnersSelector = "0xa0e67e2b";

	const call: StateReadCall = {
		to: safeAddress,
		data: getOwnersSelector,
		block,
	};

	const decoder = (raw: Hex): Address[] => {
		if (raw === "0x") {
			throw new Error(`Failed to retrieve owners for Safe at ${safeAddress}`);
		}

		// Inline decoding of the dynamic address array returned by Safe
		// The ABI encoding for dynamic arrays includes:
		// 1. Offset pointer (32 bytes) - points to where the array data starts
		// 2. Array length (32 bytes) - number of elements
		// 3. Array elements (32 bytes each) - the actual addresses

		// Define offsets for parsing array results
		const ARRAY_LENGTH_OFFSET_START = 66; // Skip "0x" + offset pointer
		const ARRAY_LENGTH_OFFSET_END = 130; // Read length field
		const ARRAY_DATA_OFFSET_START = 130; // Start of array elements

		// Skip the offset pointer (first 32 bytes = 64 hex chars after "0x")
		// Read the array length from the next 32 bytes
		const lengthHex = raw.slice(
			ARRAY_LENGTH_OFFSET_START,
			ARRAY_LENGTH_OFFSET_END,
		);
		const length = Number.parseInt(lengthHex, 16);

		const owners: Address[] = [];
		// Start reading addresses after offset pointer + length field
		const dataOffset = ARRAY_DATA_OFFSET_START;

		for (let i = 0; i < length; i++) {
			// Each address is stored in a 32-byte slot, right-padded with zeros
			const start = dataOffset + i * 64;
			const addressHex = raw.slice(start + 24, start + 64); // Last 20 bytes of the 32-byte slot
			owners.push(checksumAddress(`0x${addressHex}`));
		}

		return owners;
	};

	return wrapStateRead(provider, call, decoder, options) as WrapResult<
		Address[],
		A,
		O
	>;
}

/**
 * Retrieves a paginated list of enabled modules for a Safe account.
 * Modules are contracts that can execute transactions directly through the Safe without signatures.
 *
 * @remarks
 * This function calls the `getModulesPaginated` method on the Safe contract, which returns a page of module addresses
 * and a pointer to the next page. This is useful for iterating through all modules of a Safe, especially when the
 * number of modules is large. The modules are stored in a linked list structure within the Safe contract.
 *
 * @param provider - An EIP-1193 compliant provider used to perform the eth_call
 * @param params - Parameters for the modules read
 *                 - `safeAddress`: The address of the Safe contract whose modules are being fetched
 *                 - `start`: The address to start the page from. Use the `next` value from a previous call to get the next page. Defaults to SENTINEL_NODE (0x1)
 *                 - `pageSize`: The number of modules to retrieve per page. Defaults to 100
 * @param options - Optional execution options
 *                  - `lazy`: If true, returns a wrapped call object instead of executing immediately
 *                  - `block`: Block number or tag to query at (defaults to "latest")
 *                  - `data`: Optional additional data to attach to the wrapped call
 * @returns An object containing the list of checksummed module addresses for the current page and the address to start the next page from, or a wrapped call object
 * @throws {Error} If the eth_call fails or returns invalid data
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getModulesPaginated, SENTINEL_NODE } from "picosafe/account-state";
 * import type { Address } from "viem";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 * const safeAddress: Address = "0xA063Cda916194a4b344255447895429f531407e4";
 *
 * // Get first page of modules - immediate execution (default)
 * const firstPage = await getModulesPaginated(
 *   provider,
 *   { safeAddress, pageSize: 10 }
 * );
 * console.log('First page modules:', firstPage.modules);
 * console.log('Next page starts at:', firstPage.next);
 *
 * // Get all modules using pagination
 * const allModules: Address[] = [];
 * let nextModule: Address | undefined = SENTINEL_NODE;
 *
 * while (nextModule && nextModule !== SENTINEL_NODE) {
 *   const page = await getModulesPaginated(
 *     provider,
 *     { safeAddress, start: nextModule, pageSize: 100 }
 *   );
 *   allModules.push(...page.modules);
 *   nextModule = page.modules.length === 100 ? page.next : undefined;
 * }
 *
 * console.log(`Total modules: ${allModules.length}`);
 *
 * // Lazy evaluation for batching
 * const modulesCall = await getModulesPaginated(
 *   provider,
 *   { safeAddress },
 *   { lazy: true }
 * );
 * const modules = await modulesCall.call();
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/ModuleManager.sol#L144
 */
function getModulesPaginated<
	A = void,
	O extends MaybeLazy<A> | undefined = undefined,
>(
	provider: EIP1193ProviderWithRequestFn,
	params: {
		safeAddress: Address;
		start?: Address;
		pageSize?: number;
	},
	options?: O,
): WrapResult<{ modules: Address[]; next: Address }, A, O> {
	const { safeAddress, start = SENTINEL_NODE, pageSize = 100 } = params;
	const { block = "latest" } = options || {};

	const getModulesPaginatedSelector = "0xcc2f8452";
	const callData = encodeWithSelector(
		getModulesPaginatedSelector,
		start,
		pageSize,
	);

	const call: StateReadCall = {
		to: safeAddress,
		data: callData,
		block,
	};

	const decoder = (result: Hex): { modules: Address[]; next: Address } => {
		if (result === "0x") {
			throw new Error(`Failed to retrieve modules for Safe at ${safeAddress}`);
		}

		// The ABI-encoded response contains a pointer to the start of the data, the 'next' address,
		// the array length, and then the array elements.
		// We parse this response manually to avoid adding a full ABI decoder dependency.

		// Define offsets for parsing module pagination results
		const MODULE_NEXT_OFFSET_START = 64;
		const MODULE_NEXT_OFFSET_END = 128;
		const MODULE_LENGTH_OFFSET_START = 128;
		const MODULE_LENGTH_OFFSET_END = 192;
		const MODULE_DATA_OFFSET_START = 192;

		// Remove 0x prefix for slicing
		const hex = result.slice(2);

		// Decode 'next' address (bytes32 padded)
		const next =
			`0x${hex.slice(MODULE_NEXT_OFFSET_START, MODULE_NEXT_OFFSET_END).slice(-40)}` as Address;

		// Decode array length
		const arrayLength = Number.parseInt(
			hex.slice(MODULE_LENGTH_OFFSET_START, MODULE_LENGTH_OFFSET_END),
			16,
		);

		// Decode module addresses
		const modules: Address[] = [];
		for (let i = 0; i < arrayLength; i++) {
			const offset = MODULE_DATA_OFFSET_START + i * 64;
			// Extract address from padded bytes32 value
			const addressHex = hex.slice(offset + 24, offset + 64);
			modules.push(checksumAddress(`0x${addressHex}`));
		}

		return { modules, next };
	};

	return wrapStateRead(provider, call, decoder, options) as WrapResult<
		{ modules: Address[]; next: Address },
		A,
		O
	>;
}

export {
	getStorageAt,
	getNonce,
	getFallbackHandler,
	getOwnerCount,
	getThreshold,
	getModulesPaginated,
	getGuard,
	getSingleton,
	getOwners,
	SAFE_STORAGE_SLOTS,
};
