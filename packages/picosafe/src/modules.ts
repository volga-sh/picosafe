import { Hash, Hex as HexUtils, Address as OxAddress } from "ox";
import { getModulesPaginated, SAFE_STORAGE_SLOTS } from "./account-state.js";
import type { Address, Hex } from "./ox-types";
import type { SecureSafeTransactionOptions } from "./transactions.js";
import { buildSafeTransaction } from "./transactions.js";
import type {
	EIP1193ProviderWithRequestFn,
	FullSafeTransaction,
} from "./types.js";
import { SENTINEL_NODE } from "./utilities/constants.js";
import { encodeWithSelector } from "./utilities/encoding.js";

/**
 * Builds an unsigned Safe transaction object to enable a module for the Safe account.
 *
 * ⚠️ **SECURITY WARNING**: Modules have UNLIMITED power over your Safe.
 *
 * Once enabled, a module can:
 * - Execute ANY transaction without owner signatures
 * - Transfer ALL assets (ETH, tokens, NFTs) without restrictions
 * - Call ANY contract on behalf of the Safe
 * - Enable other modules or change Safe settings
 * - Cannot be disabled if the module doesn't cooperate
 *
 * Modules bypass ALL Safe security features - no signatures, no threshold, no guards.
 * Only enable modules you fully trust and have audited. Consider modules as having
 * root access to your Safe.
 *
 * Common legitimate uses:
 * - Spending limits with restrictions
 * - Automated DeFi strategies
 * - Social recovery mechanisms
 * - Session keys with limited scope
 *
 * @param provider - The EIP-1193 compatible provider for blockchain interactions
 * @param safeAddress - Address of the Safe contract
 * @param moduleAddress - The Ethereum address of the module contract to enable
 * @param transactionOptions - Optional transaction parameters (excluding UNSAFE_DELEGATE_CALL which is never allowed for module operations)
 * @returns Promise containing the prepared Safe transaction with raw transaction data and send method
 * @example
 * ```typescript
 * import { UNSAFE_getEnableModuleTransaction, signSafeTransaction, executeSafeTransaction } from 'picosafe';
 * import { createWalletClient, http } from 'viem';
 * import { mainnet } from 'viem/chains';
 *
 * const walletClient = createWalletClient({
 *   chain: mainnet,
 *   transport: http(),
 * });
 *
 * // Prepare enable module transaction
 * const tx = await UNSAFE_getEnableModuleTransaction(
 *   walletClient,
 *   '0x742d35Cc6634C0532925a3b844Bc9e7595f4d3e2',
 *   spendingLimitModule,
 *   { nonce: 10n }
 * );
 *
 * // Sign the transaction with an owner account
 * const signature = await signSafeTransaction(
 *   walletClient,
 *   tx,
 *   walletClient.account.address
 * );
 *
 * // Execute the transaction on-chain
 * const execution = await executeSafeTransaction(
 *   walletClient,
 *   tx,
 *   [signature]
 * );
 * const txHash = await execution.send();
 * console.log(`Module enabled in transaction: ${txHash}`);
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/ModuleManager.sol#L47
 */
async function UNSAFE_getEnableModuleTransaction(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	moduleAddress: Address,
	transactionOptions?: Readonly<SecureSafeTransactionOptions>,
): Promise<FullSafeTransaction> {
	const enableModuleData = encodeWithSelector("0x610b5925", moduleAddress);

	return buildSafeTransaction(
		provider,
		safeAddress,
		[
			{
				to: safeAddress,
				value: 0n,
				data: enableModuleData,
			},
		],
		transactionOptions,
	);
}

/**
 * Builds an unsigned Safe transaction object to disable a previously enabled module for the Safe account, revoking its authorization to execute transactions.
 * This operation requires finding the correct previous module in the linked list structure used by Safe contracts.
 *
 * @param provider - The EIP-1193 compatible provider for blockchain interactions
 * @param safeAddress - Address of the Safe contract
 * @param moduleAddress - The Ethereum address of the module contract to disable. Can be lower- or mixed-case; it will be normalised to an EIP-55 checksum internally
 * @param transactionOptions - Optional transaction parameters (excluding UNSAFE_DELEGATE_CALL which is never allowed for module operations)
 * @returns Promise containing the prepared Safe transaction with raw transaction data and send method
 * @throws {Error} When the module is not currently enabled for this Safe
 * @example
 * ```typescript
 * import { getDisableModuleTransaction, signSafeTransaction, executeSafeTransaction } from 'picosafe';
 * import { createWalletClient, http } from 'viem';
 * import { mainnet } from 'viem/chains';
 *
 * const walletClient = createWalletClient({
 *   chain: mainnet,
 *   transport: http(),
 * });
 *
 * // Prepare disable module transaction
 * const tx = await getDisableModuleTransaction(
 *   walletClient,
 *   '0x742d35Cc6634C0532925a3b844Bc9e7595f4d3e2',
 *   spendingLimitModule,
 *   { nonce: 10n }
 * );
 *
 * // Sign the transaction with an owner account
 * const signature = await signSafeTransaction(
 *   walletClient,
 *   tx,
 *   walletClient.account.address
 * );
 *
 * // Execute the transaction on-chain
 * const execution = await executeSafeTransaction(
 *   walletClient,
 *   tx,
 *   [signature]
 * );
 * const txHash = await execution.send();
 * console.log(`Module disabled in transaction: ${txHash}`);
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/ModuleManager.sol#L63
 */
async function getDisableModuleTransaction(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	moduleAddress: Address,
	transactionOptions?: Readonly<SecureSafeTransactionOptions>,
): Promise<FullSafeTransaction> {
	// Get all modules to find the previous module
	const modules = await getModulesPaginated(provider, { safeAddress });
	// Normalise to checksum so look-ups are case-insensitive
	const normalizedModuleAddress = OxAddress.checksum(moduleAddress);
	const moduleIndex = modules.modules.indexOf(normalizedModuleAddress);

	if (moduleIndex === -1) {
		throw new Error(`Module ${moduleAddress} not found in Safe ${safeAddress}`);
	}

	// Find previous module (or sentinel if it's the first)
	let prevModule: Address;
	if (moduleIndex === 0) {
		prevModule = SENTINEL_NODE;
	} else {
		const prevModuleCandidate = modules.modules[moduleIndex - 1];
		if (!prevModuleCandidate) {
			throw new Error(
				`Failed to find previous module for index ${moduleIndex}`,
			);
		}
		prevModule = prevModuleCandidate;
	}

	const disableModuleData = encodeWithSelector(
		"0xe009cfde",
		prevModule,
		normalizedModuleAddress,
	);

	return buildSafeTransaction(
		provider,
		safeAddress,
		[
			{
				to: safeAddress,
				value: 0n,
				data: disableModuleData,
			},
		],
		transactionOptions,
	);
}

/**
 * Computes the storage slot for a mapping(address => address) entry used by the
 * Safe contracts for module linked-list management. The mapping itself is
 * located at storage slot `1` (see {@link SAFE_STORAGE_SLOTS.modulesMapping}).
 *
 * Solidity stores a mapping value at `keccak256(key . slot)` where both
 * components are tightly packed and 32-byte padded. This helper produces that
 * location so we can use Anvil's `setStorageAt` to simulate enabled modules
 * without executing on-chain Safe transactions (which would otherwise require
 * signatures & execution).
 *
 * @param moduleAddress - Address that acts as the mapping key (either `SENTINEL_NODE` or a module address)
 * @returns 32-byte hex string representing the calculated storage slot
 * @example
 * ```typescript
 * import { computeModulesMappingSlot } from "picosafe";
 *
 * const moduleAddress = "0x0000000000000000000000000000000000000001";
 * const slot = computeModulesMappingSlot(moduleAddress);
 * console.log(slot); // 0xcc69885fda6bcc1a4ace058b4a62bf5e179ea78fd58a1ccd71c22cc9b688792f
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/libraries/SafeStorage.sol#L13
 */
function computeModulesMappingSlot(moduleAddress: Address): Hex {
	// Pad address and slot to 32 bytes each then hash the concatenation
	// This follows Solidity's storage slot calculation for mappings: keccak256(key + slot)
	return Hash.keccak256(
		HexUtils.concat(
			HexUtils.padLeft(moduleAddress, 32),
			HexUtils.padLeft(SAFE_STORAGE_SLOTS.modulesMapping, 32),
		),
	);
}

export {
	UNSAFE_getEnableModuleTransaction,
	getDisableModuleTransaction,
	computeModulesMappingSlot,
};
