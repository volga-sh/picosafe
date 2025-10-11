import { Address as OxAddress } from "ox";
import { getOwners } from "./account-state.js";
import type { Address } from "./ox-types";
import type { SecureSafeTransactionOptions } from "./transactions.js";
import { buildSafeTransaction } from "./transactions.js";
import type {
	EIP1193ProviderWithRequestFn,
	FullSafeTransaction,
} from "./types.js";
import { SENTINEL_NODE } from "./utilities/constants.js";
import { encodeWithSelector } from "./utilities/encoding.js";

/**
 * Builds an unsigned Safe transaction object to add a new owner to the Safe and optionally update the threshold.
 * This function builds a Safe transaction to add a new owner to the multi-sig wallet
 * and can simultaneously update the signature threshold required for transaction approval.
 *
 * @param provider - The EIP-1193 compatible provider for blockchain interactions
 * @param safeAddress - Address of the Safe contract
 * @param newOwner - The Ethereum address of the new owner to add
 * @param newThreshold - New signature threshold after adding the owner
 * @param transactionOptions - Optional transaction parameters (excluding UNSAFE_DELEGATE_CALL which is never allowed for owner management operations)
 * @returns Promise containing the prepared Safe transaction with raw transaction data and send method
 * @example
 * ```typescript
 * import { getAddOwnerTransaction, signSafeTransaction, executeSafeTransaction } from 'picosafe';
 * import { createWalletClient, http } from 'viem';
 * import { mainnet } from 'viem/chains';
 *
 * const walletClient = createWalletClient({
 *   chain: mainnet,
 *   transport: http(),
 * });
 *
 * // Prepare add owner transaction
 * const tx = await getAddOwnerTransaction(
 *   walletClient,
 *   '0x742d35Cc6634C0532925a3b844Bc9e7595f4d3e2',
 *   '0x1234567890123456789012345678901234567890',
 *   2,
 *   { nonce: 10n }
 * );
 *
 * // Sign with an owner account
 * const signature = await signSafeTransaction(
 *   walletClient,
 *   tx,
 *   walletClient.account.address
 * );
 *
 * // Execute transaction on-chain
 * const execution = await executeSafeTransaction(
 *   walletClient,
 *   tx,
 *   [signature]
 * );
 * const txHash = await execution.send();
 * console.log(`Owner added in transaction: ${txHash}`);
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/OwnerManager.sol#L58
 */
async function getAddOwnerTransaction(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	{
		newOwner,
		newThreshold,
	}: {
		newOwner: Address;
		newThreshold: bigint;
	},
	transactionOptions?: Readonly<SecureSafeTransactionOptions>,
): Promise<FullSafeTransaction> {
	const addOwnerWithThresholdSelector = "0x0d582f13";
	const data = encodeWithSelector(
		addOwnerWithThresholdSelector,
		newOwner,
		newThreshold,
	);

	return buildSafeTransaction(
		provider,
		safeAddress,
		[
			{
				to: safeAddress,
				data,
			},
		],
		transactionOptions,
	);
}

/**
 * Builds an unsigned Safe transaction to remove an existing owner and update the signature threshold.
 *
 * This function encodes a call to the Safe contract's `removeOwner` method,
 * removing `ownerToRemove` and setting the new threshold. If `prevOwner` is not provided,
 * it is inferred from the current owner list (or set to the sentinel node if removing the first owner).
 *
 * @param provider - The EIP-1193 compatible provider for blockchain interactions.
 * @param safeAddress - The address of the Safe contract.
 * @param removeOwnerParams - Parameters for owner removal:
 *   - ownerToRemove: The Ethereum address of the owner to remove. May be lower- or mixed-case; it will be normalised to an EIP-55 checksum internally.
 *   - newThreshold: The new signature threshold after removal.
 *   - prevOwner: (Optional) The address of the previous owner in the linked list. Provide it if already known; otherwise it is inferred automatically. Case-insensitive.
 * @param transactionOptions - Optional Safe transaction build options (excluding UNSAFE_DELEGATE_CALL).
 * @returns A Promise resolving to the prepared Safe transaction with raw data and send method.
 * @throws {Error} If the specified owner does not exist or the previous owner cannot be determined.
 * @example
 * ```typescript
 * import { getRemoveOwnerTransaction, signSafeTransaction, executeSafeTransaction } from 'picosafe';
 * import { createWalletClient, http } from 'viem';
 * import { mainnet } from 'viem/chains';
 *
 * const walletClient = createWalletClient({
 *   chain: mainnet,
 *   transport: http(),
 * });
 *
 * // Remove an owner and update threshold to 1
 * const tx = await getRemoveOwnerTransaction(
 *   walletClient,
 *   '0xSafeAddress',
 *   {
 *     ownerToRemove: '0xOwnerToRemove',
 *     newThreshold: 1,
 *   },
 *   { nonce: 10n }
 * );
 *
 * // Sign and execute
 * const signature = await signSafeTransaction(walletClient, tx, walletClient.account.address);
 * const execution = await executeSafeTransaction(walletClient, tx, [signature]);
 * const txHash = await execution.send();
 * console.log(`Owner removed in transaction: ${txHash}`);
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/OwnerManager.sol#L78
 */
async function getRemoveOwnerTransaction(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	removeOwnerParams: Readonly<{
		ownerToRemove: Address;
		newThreshold: bigint;
		prevOwner?: Address;
	}>,
	transactionOptions?: Readonly<SecureSafeTransactionOptions>,
): Promise<FullSafeTransaction> {
	const normalizedTargetOwner = OxAddress.checksum(
		removeOwnerParams.ownerToRemove,
	);
	let { prevOwner } = removeOwnerParams;
	if (!prevOwner) {
		const currentOwners = await getOwners(provider, { safeAddress });
		const ownerIndex = currentOwners.indexOf(normalizedTargetOwner);
		if (ownerIndex === -1) {
			throw new Error(
				`Owner ${removeOwnerParams.ownerToRemove} not found in Safe ${safeAddress}`,
			);
		}

		if (ownerIndex === 0) {
			prevOwner = SENTINEL_NODE;
		} else {
			const prevCandidate = currentOwners[ownerIndex - 1];
			if (!prevCandidate) {
				throw new Error(
					`Failed to find previous owner for index ${ownerIndex}`,
				);
			}
			prevOwner = prevCandidate;
		}
	}

	const removeOwnerSelector = "0xf8dc5dd9";
	const data = encodeWithSelector(
		removeOwnerSelector,
		prevOwner,
		normalizedTargetOwner,
		removeOwnerParams.newThreshold,
	);

	return buildSafeTransaction(
		provider,
		safeAddress,
		[
			{
				to: safeAddress,
				data,
			},
		],
		transactionOptions,
	);
}

/**
 * Builds an unsigned Safe transaction to swap an existing owner with a new owner atomically.
 *
 * This function encodes a call to the Safe contract's `swapOwner` method,
 * replacing `oldOwner` with `newOwner` in a single transaction. If `prevOwner` is not provided,
 * it is inferred from the current owner list (or set to the sentinel node if swapping the first owner).
 *
 * @param provider - The EIP-1193 compatible provider for blockchain interactions.
 * @param safeAddress - The address of the Safe contract.
 * @param swapOwnerParams - Parameters for owner swap:
 *   - oldOwner: The Ethereum address of the owner to replace. May be lower- or mixed-case; it will be normalised to an EIP-55 checksum internally.
 *   - newOwner: The Ethereum address of the new owner. May be lower- or mixed-case; it will be normalised to an EIP-55 checksum internally.
 *   - prevOwner: (Optional) The address of the previous owner in the linked list. Provide it if already known; otherwise it is inferred automatically. Case-insensitive.
 * @param transactionOptions - Optional Safe transaction build options (excluding UNSAFE_DELEGATE_CALL).
 * @returns A Promise resolving to the prepared Safe transaction with raw data and send method.
 * @throws {Error} If the specified old owner does not exist or the previous owner cannot be determined.
 * @example
 * ```typescript
 * import { getSwapOwnerTransaction, signSafeTransaction, executeSafeTransaction } from 'picosafe';
 * import { createWalletClient, http } from 'viem';
 * import { mainnet } from 'viem/chains';
 *
 * const walletClient = createWalletClient({
 *   chain: mainnet,
 *   transport: http(),
 * });
 *
 * // Swap an owner with a new owner
 * const tx = await getSwapOwnerTransaction(
 *   walletClient,
 *   '0xSafeAddress',
 *   {
 *     oldOwner: '0xOldOwner',
 *     newOwner: '0xNewOwner',
 *   },
 *   { nonce: 10n }
 * );
 *
 * // Sign and execute
 * const signature = await signSafeTransaction(walletClient, tx, walletClient.account.address);
 * const execution = await executeSafeTransaction(walletClient, tx, [signature]);
 * const txHash = await execution.send();
 * console.log(`Owner swapped in transaction: ${txHash}`);
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/OwnerManager.sol#L99
 */
async function getSwapOwnerTransaction(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	swapOwnerParams: Readonly<{
		oldOwner: Address;
		newOwner: Address;
		prevOwner?: Address;
	}>,
	transactionOptions?: Readonly<SecureSafeTransactionOptions>,
): Promise<FullSafeTransaction> {
	const normalizedOldOwner = OxAddress.checksum(swapOwnerParams.oldOwner);
	const normalizedNewOwner = OxAddress.checksum(swapOwnerParams.newOwner);
	let { prevOwner } = swapOwnerParams;

	if (!prevOwner) {
		const currentOwners = await getOwners(provider, { safeAddress });
		const ownerIndex = currentOwners.indexOf(normalizedOldOwner);
		if (ownerIndex === -1) {
			throw new Error(
				`Owner ${swapOwnerParams.oldOwner} not found in Safe ${safeAddress}`,
			);
		}

		if (ownerIndex === 0) {
			prevOwner = SENTINEL_NODE;
		} else {
			const prevCandidate = currentOwners[ownerIndex - 1];
			if (!prevCandidate) {
				throw new Error(
					`Failed to find previous owner for index ${ownerIndex}`,
				);
			}
			prevOwner = prevCandidate;
		}
	}

	const swapOwnerSelector = "0xe318b52b";
	const data = encodeWithSelector(
		swapOwnerSelector,
		prevOwner,
		normalizedOldOwner,
		normalizedNewOwner,
	);

	return buildSafeTransaction(
		provider,
		safeAddress,
		[
			{
				to: safeAddress,
				data,
			},
		],
		transactionOptions,
	);
}

/**
 * Builds an unsigned Safe transaction object to change the threshold required for Safe transactions.
 * This function builds a Safe transaction to update the minimum number of owner signatures
 * required to execute transactions on the Safe.
 *
 * @param provider - The EIP-1193 compatible provider for blockchain interactions
 * @param safeAddress - Address of the Safe contract
 * @param newThreshold - New signature threshold
 * @param transactionOptions - Optional transaction parameters (excluding UNSAFE_DELEGATE_CALL which is never allowed for threshold change operations)
 * @returns Promise containing the prepared Safe transaction with raw transaction data and send method
 * @example
 * ```typescript
 * import { getChangeThresholdTransaction, signSafeTransaction, executeSafeTransaction } from 'picosafe';
 * import { createWalletClient, http } from 'viem';
 * import { mainnet } from 'viem/chains';
 *
 * const walletClient = createWalletClient({
 *   chain: mainnet,
 *   transport: http(),
 * });
 *
 * // Prepare change threshold transaction (2-of-3 to 3-of-3)
 * const tx = await getChangeThresholdTransaction(
 *   walletClient,
 *   '0x742d35Cc6634C0532925a3b844Bc9e7595f4d3e2',
 *   3,
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
 * console.log(`Threshold changed in transaction: ${txHash}`);
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/OwnerManager.sol#L119
 */
async function getChangeThresholdTransaction(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	newThreshold: bigint,
	transactionOptions?: Readonly<SecureSafeTransactionOptions>,
): Promise<FullSafeTransaction> {
	const changeThresholdSelector = "0x694e80c3";
	const data = encodeWithSelector(changeThresholdSelector, newThreshold);

	return buildSafeTransaction(
		provider,
		safeAddress,
		[
			{
				to: safeAddress,
				data,
			},
		],
		transactionOptions,
	);
}

export {
	getAddOwnerTransaction,
	getRemoveOwnerTransaction,
	getSwapOwnerTransaction,
	getChangeThresholdTransaction,
};
