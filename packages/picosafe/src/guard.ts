import type { Address } from "./ox-types";
import type { SecureSafeTransactionOptions } from "./transactions";
import { buildSafeTransaction } from "./transactions";
import type { EIP1193ProviderWithRequestFn } from "./types";
import { encodeWithSelector } from "./utilities/encoding.js";

/**
 * Builds an unsigned Safe transaction object to set a guard for the Safe account.
 *
 * ⚠️ **SECURITY WARNING**: This is an extremely dangerous operation that can permanently brick your Safe.
 *
 * Guards are smart contracts that can intercept and validate EVERY transaction before execution.
 * A malicious or buggy guard can:
 * - Block all transactions permanently, making funds unrecoverable
 * - Enforce arbitrary restrictions on Safe operations
 * - Prevent guard removal if poorly implemented
 *
 * Only use guards from trusted, audited sources. Consider implementing time-locks or
 * escape mechanisms in your guard contract to prevent permanent lockouts.
 *
 * @param provider - The EIP-1193 compatible provider for blockchain interactions
 * @param safeAddress - Address of the Safe contract
 * @param guard - The Ethereum address of the guard contract to set (use ZERO_ADDRESS to remove)
 * @param transactionOptions - Optional transaction parameters (excluding UNSAFE_DELEGATE_CALL which is never allowed for guard operations)
 * @returns Promise containing the prepared Safe transaction with raw transaction data and send method
 * @example
 * ```typescript
 * import { UNSAFE_getSetGuardTransaction } from 'picosafe';
 * import { createWalletClient, http } from 'viem';
 * import { mainnet } from 'viem/chains';
 *
 * const walletClient = createWalletClient({
 *   chain: mainnet,
 *   transport: http(),
 * });
 *
 * const guardContract = '0x1234567890123456789012345678901234567890';
 *
 * const tx = await UNSAFE_getSetGuardTransaction(
 *   walletClient,
 *   '0x742d35Cc6634C0532925a3b844Bc9e7595f4d3e2',
 *   guardContract,
 *   {
 *     nonce: 10n, // Use specific nonce
 *     safeTxGas: 100000n, // Set gas limit
 *   }
 * );
 *
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.5.0/contracts/base/GuardManager.sol
 */
function UNSAFE_getSetGuardTransaction(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	guard: Address,
	transactionOptions?: Readonly<SecureSafeTransactionOptions>,
) {
	const data = encodeWithSelector(
		"0xe19a9dd9", // setGuard selector
		guard,
	);

	return buildSafeTransaction(
		provider,
		safeAddress,
		[
			{
				to: safeAddress,
				value: 0n,
				data,
			},
		],
		transactionOptions,
	);
}

export { UNSAFE_getSetGuardTransaction };
