import type { Address, Hex, Quantity } from "viem";
import type {
	EIP1193ProviderWithRequestFn,
	PicosafeRpcBlockIdentifier,
} from "./types";
import { checksumAddress } from "./utilities/address";
import { SENTINEL_NODE } from "./utilities/constants";
import { encodeWithSelector, padStartHex } from "./utilities/encoding.js";

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
 * @param safeAddress - The address of the Safe contract whose storage is being queried
 * @param slot - The storage slot position (as a hex Quantity) to read from
 * @param length - The number of consecutive slots to read (defaults to 1)
 * @param block - Optional block number or tag to query at (defaults to "latest")
 * @returns An array of Hex strings representing the raw storage values for each slot
 * @throws {Error} If the eth_call fails
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getStorageAt } from "picosafe/account-state";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 *
 * const values = await getStorageAt(
 *   provider,
 *   '0x742d35Cc6634C0532925a3b844Bc9e7595f4278',
 *   '0x5' // slot 5
 * );
 * console.log(values); // e.g., ['0x000...abc']
 *
 * // Read two slots
 * const [slot0, slot1] = await getStorageAt(
 *   provider,
 *   '0x742d35Cc6634C0532925a3b844Bc9e7595f4278',
 *   '0x0',
 *   2
 * );
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/common/StorageAccessible.sol#L17
 */
async function getStorageAt(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	storage: Readonly<{ slot: Quantity; length?: bigint }>,
	block: PicosafeRpcBlockIdentifier = "latest",
): Promise<Hex[]> {
	const getStorageAtSelector = "0x5624b25b";
	const callData: Hex = encodeWithSelector(
		getStorageAtSelector,
		storage.slot,
		storage.length ?? 1n,
	);
	const result = await provider.request({
		method: "eth_call",
		params: [
			{
				to: safeAddress,
				data: callData,
			},
			block,
		],
	});
	if (result === "0x") {
		throw new Error(
			`Failed to retrieve storage at slot ${storage.slot} for Safe at ${safeAddress}`,
		);
	}

	const decodedResult: Hex[] = [];
	// We start at 64 byte (128 in hex, +2 for '0x' prefix) because the first 64 bytes are the offset + length of the result
	for (let i = 130; i < result.length; i += 64) {
		decodedResult.push(`0x${result.slice(i, i + 64)}`);
	}

	return decodedResult;
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
 * @param safeAddress - The address of the Safe contract whose nonce is being fetched
 * @param block - Optional block number or tag to query at (defaults to "latest")
 * @returns The current nonce value as a bigint
 * @throws {Error} If no storage value is returned (e.g., invalid Safe address)
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getNonce } from "picosafe/account-state";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 *
 * const nonce = await getNonce(
 *   provider,
 *   '0x742d35Cc6634C0532925a3b844Bc9e7595f4278'
 * );
 * console.log('Current nonce:', nonce); // e.g., 5n
 *
 * // Query nonce at specific block
 * const historicalNonce = await getNonce(
 *   provider,
 *   '0x742d35Cc6634C0532925a3b844Bc9e7595f4278',
 *   '0x112a880' // block number as hex
 * );
 * ```
 */
async function getNonce(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	block: PicosafeRpcBlockIdentifier = "latest",
): Promise<bigint> {
	const [nonce] = await getStorageAt(
		provider,
		safeAddress,
		{ slot: SAFE_STORAGE_SLOTS.nonce },
		block,
	);
	if (!nonce) {
		throw new Error(`Failed to retrieve nonce for Safe at ${safeAddress}`);
	}

	return BigInt(nonce);
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
 * @param safeAddress - The address of the Safe contract
 * @param block - Optional block number or tag to query at (defaults to "latest")
 * @returns The fallback handler address, or zero address if none configured
 * @throws {Error} If no storage value is returned (e.g., invalid Safe address)
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getFallbackHandler } from "picosafe/account-state";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 *
 * const handler = await getFallbackHandler(
 *   provider,
 *   '0x742d35Cc6634C0532925a3b844Bc9e7595f4278'
 * );
 * console.log('Fallback handler:', handler);
 * // e.g., '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99'
 * ```
 */
async function getFallbackHandler(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	block: PicosafeRpcBlockIdentifier = "latest",
): Promise<Address> {
	const [fallbackHandler] = await getStorageAt(
		provider,
		safeAddress,
		{ slot: SAFE_STORAGE_SLOTS.fallbackHandler },
		block,
	);
	if (!fallbackHandler) {
		throw new Error(
			`Failed to retrieve fallback handler for Safe at ${safeAddress}`,
		);
	}

	// Storage returns 32 bytes, extract the address (last 20 bytes)
	return `0x${fallbackHandler.slice(-40)}`;
}

/**
 * Retrieves the number of owners configured on a Safe contract by reading its storage slot.
 *
 * @remarks
 * Reads directly from storage slot `SAFE_STORAGE_SLOTS.ownerCount` (slot 3) via `getStorageAt`.
 * This design enables batching multiple ownerCount reads into a single RPC request via a multicall contract.
 *
 * @param provider - An EIP-1193 compliant provider used to perform the eth_call
 * @param safeAddress - The address of the Safe contract whose owner count is being fetched
 * @param block - Optional block number or tag to query at (defaults to "latest")
 * @returns The current owner count value as a bigint
 * @throws {Error} If no storage value is returned (e.g., invalid Safe address)
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getOwnerCount } from "picosafe/account-state";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 *
 * const count = await getOwnerCount(provider, safeAddress);
 * console.log('Owner count:', count); // e.g., 2n
 * ```
 */
async function getOwnerCount(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	block: PicosafeRpcBlockIdentifier = "latest",
): Promise<bigint> {
	const [raw] = await getStorageAt(
		provider,
		safeAddress,
		{ slot: SAFE_STORAGE_SLOTS.ownerCount },
		block,
	);
	if (!raw) {
		throw new Error(
			`Failed to retrieve owner count for Safe at ${safeAddress}`,
		);
	}
	return BigInt(raw);
}

/**
 * Retrieves the threshold (minimum signatures required) for a Safe contract by reading its storage slot.
 *
 * @remarks
 * Reads directly from storage slot `SAFE_STORAGE_SLOTS.threshold` (slot 4) via `getStorageAt`.
 * This design enables batching multiple threshold reads into a single RPC request via a multicall contract.
 *
 * @param provider - An EIP-1193 compliant provider used to perform the eth_call
 * @param safeAddress - The address of the Safe contract whose threshold is being fetched
 * @param block - Optional block number or tag to query at (defaults to "latest")
 * @returns The current threshold value as a bigint
 * @throws {Error} If no storage value is returned (e.g., invalid Safe address)
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getThreshold } from "picosafe/account-state";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 *
 * const threshold = await getThreshold(provider, safeAddress);
 * console.log('Threshold:', threshold); // e.g., 1n
 * ```
 */
async function getThreshold(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	block: PicosafeRpcBlockIdentifier = "latest",
): Promise<bigint> {
	const [raw] = await getStorageAt(
		provider,
		safeAddress,
		{ slot: SAFE_STORAGE_SLOTS.threshold },
		block,
	);
	if (!raw) {
		throw new Error(`Failed to retrieve threshold for Safe at ${safeAddress}`);
	}
	return BigInt(raw);
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
 * @param safeAddress - The address of the Safe contract whose guard is being fetched
 * @param block - Optional block number or tag to query at (defaults to "latest")
 * @returns The guard contract address, or zero address if none configured
 * @throws {Error} If no storage value is returned (e.g., invalid Safe address)
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getGuard } from "picosafe/account-state";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 *
 * const guard = await getGuard(provider, safeAddress);
 * console.log('Guard address:', guard);
 * ```
 */
async function getGuard(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	block: PicosafeRpcBlockIdentifier = "latest",
): Promise<Address> {
	const [raw] = await getStorageAt(
		provider,
		safeAddress,
		{ slot: SAFE_STORAGE_SLOTS.guard },
		block,
	);
	if (!raw) {
		throw new Error(`Failed to retrieve guard for Safe at ${safeAddress}`);
	}
	return `0x${raw.slice(-40)}`;
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
 * @param safeAddress - The address of the Safe contract whose singleton is being fetched
 * @param block - Optional block number or tag to query at (defaults to "latest")
 * @returns The singleton implementation contract address
 * @throws {Error} If no storage value is returned (e.g., invalid Safe address)
 * @example
 * ```typescript
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 * import { getSingleton } from "picosafe/account-state";
 *
 * const provider = createPublicClient({ chain: mainnet, transport: http() });
 *
 * const impl = await getSingleton(provider, safeAddress);
 * console.log('Implementation address:', impl);
 * ```
 */
async function getSingleton(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	block: PicosafeRpcBlockIdentifier = "latest",
): Promise<Address> {
	const [raw] = await getStorageAt(
		provider,
		safeAddress,
		{ slot: SAFE_STORAGE_SLOTS.singleton },
		block,
	);
	if (!raw) {
		throw new Error(`Failed to retrieve singleton for Safe at ${safeAddress}`);
	}
	return `0x${raw.slice(-40)}`;
}

/**
 * Gets all owners of a Safe.
 * This function retrieves the complete list of owner addresses that have control
 * over the Safe multi-sig wallet. The owners are returned in the order they are
 * stored in the Safe's internal linked list structure.
 *
 * @param provider - EIP-1193 compatible provider for blockchain interaction
 * @param safeAddress - Ethereum address of the Safe contract to query
 * @returns {Promise<Address[]>} Array of checksummed owner addresses in the order they are stored
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
 * // Get all owners of a Safe
 * const owners = await getOwners(
 *   provider,
 *   "0x742d35Cc6634C0532925a3b844Bc9e7595f4d3e2"
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
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/OwnerManager.sol#L148
 */
export async function getOwners(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	block: PicosafeRpcBlockIdentifier = "latest",
): Promise<Address[]> {
	// selector for `getOwners() returns(address[] memory)`
	const getOwnersSelector = "0xa0e67e2b";

	const raw = await provider.request({
		method: "eth_call",
		params: [
			{
				to: safeAddress,
				data: getOwnersSelector,
			},
			block,
		],
	});
	if (raw === "0x") {
		throw new Error(`Failed to retrieve owners for Safe at ${safeAddress}`);
	}

	// Inline decoding of the dynamic address array returned by Safe
	// The ABI encoding for dynamic arrays includes:
	// 1. Offset pointer (32 bytes) - points to where the array data starts
	// 2. Array length (32 bytes) - number of elements
	// 3. Array elements (32 bytes each) - the actual addresses

	// Skip the offset pointer (first 32 bytes = 64 hex chars after "0x")
	// Read the array length from the next 32 bytes
	const lengthHex = raw.slice(66, 130); // Skip "0x" + offset pointer, read length
	const length = Number.parseInt(lengthHex, 16);

	const owners: Address[] = [];
	// Start reading addresses after offset pointer + length field
	const dataOffset = 130; // "0x" + offset pointer (64) + length field (64)

	for (let i = 0; i < length; i++) {
		// Each address is stored in a 32-byte slot, right-padded with zeros
		const start = dataOffset + i * 64;
		const addressHex = raw.slice(start + 24, start + 64); // Last 20 bytes of the 32-byte slot
		owners.push(checksumAddress(`0x${addressHex}`));
	}

	return owners;
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
 * @param safeAddress - The address of the Safe contract whose modules are being fetched
 * @param options - Optional pagination parameters
 * @param options.start - The address to start the page from. Use the `next` value from a previous call to get the next page. Defaults to SENTINEL_NODE (0x1)
 * @param options.pageSize - The number of modules to retrieve per page. Defaults to 100
 * @param block - Optional block number or tag to query at (defaults to "latest")
 * @returns An object containing the list of checksummed module addresses for the current page and the address to start the next page from
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
 * // Get first page of modules
 * const firstPage = await getModulesPaginated(
 *   provider,
 *   safeAddress,
 *   { pageSize: 10 }
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
 *     safeAddress,
 *     { start: nextModule, pageSize: 100 }
 *   );
 *   allModules.push(...page.modules);
 *   nextModule = page.modules.length === 100 ? page.next : undefined;
 * }
 *
 * console.log(`Total modules: ${allModules.length}`);
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/ModuleManager.sol#L144
 */
async function getModulesPaginated(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	{
		start = SENTINEL_NODE,
		pageSize = 100,
	}: Readonly<{ start?: Address; pageSize?: number }> = {},
	block: PicosafeRpcBlockIdentifier = "latest",
): Promise<{ modules: Address[]; next: Address }> {
	const getModulesPaginatedSelector = "0xcc2f8452";
	const data = encodeWithSelector(getModulesPaginatedSelector, start, pageSize);

	const result = await provider.request({
		method: "eth_call",
		params: [
			{
				to: safeAddress,
				data,
			},
			block,
		],
	});

	if (result === "0x") {
		throw new Error(`Failed to retrieve modules for Safe at ${safeAddress}`);
	}

	// The ABI-encoded response contains a pointer to the start of the data, the 'next' address,
	// the array length, and then the array elements.
	// We parse this response manually to avoid adding a full ABI decoder dependency.

	// Remove 0x prefix for slicing
	const hex = result.slice(2);

	// Decode 'next' address (bytes32 padded)
	const next = `0x${hex.slice(64, 128).slice(-40)}` as Address;

	// Decode array length
	const arrayLength = Number.parseInt(hex.slice(128, 192), 16);

	// Decode module addresses
	const modules: Address[] = [];
	for (let i = 0; i < arrayLength; i++) {
		const offset = 192 + i * 64;
		// Extract address from padded bytes32 value
		const addressHex = hex.slice(offset + 24, offset + 64);
		modules.push(checksumAddress(`0x${addressHex}`));
	}

	return { modules, next };
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
	SAFE_STORAGE_SLOTS,
};
