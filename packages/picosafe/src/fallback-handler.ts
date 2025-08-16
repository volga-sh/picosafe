import type { Address } from "./ox-types";
import type { SecureSafeTransactionOptions } from "./transactions";
import { buildSafeTransaction } from "./transactions";
import type { EIP1193ProviderWithRequestFn } from "./types";
import { encodeWithSelector } from "./utilities/encoding.js";

/**
 * Builds an unsigned Safe transaction object to set a fallback handler for the Safe account.
 *
 * ⚠️ **SECURITY WARNING**: This operation can compromise the entire security model of your Safe.
 *
 * Fallback handlers receive ALL calls that don't match Safe's built-in functions, including:
 * - EIP-1271 signature validation (isValidSignature)
 * - EIP-165 interface detection
 * - Token callbacks (onERC721Received, onERC1155Received, etc.)
 * - Any future standard your Safe might need to support
 *
 * A malicious fallback handler can:
 * - Fake signature validations, allowing unauthorized access
 * - Steal tokens sent via callbacks
 * - Execute arbitrary code with the Safe's permissions
 * - Interfere with standard protocol interactions
 *
 * Only use fallback handlers from trusted, audited sources. The default CompatibilityFallbackHandler
 * is recommended for most use cases.
 *
 * @param provider - The EIP-1193 compatible provider for blockchain interactions
 * @param safeAddress - Address of the Safe contract
 * @param handler - The Ethereum address of the fallback handler contract to set (use ZERO_ADDRESS to remove)
 * @param transactionOptions - Optional transaction parameters (excluding UNSAFE_DELEGATE_CALL which is never allowed for fallback handler operations)
 * @returns Promise containing the prepared Safe transaction with raw transaction data and send method
 * @example
 * ```typescript
 * import { UNSAFE_getSetFallbackHandlerTransaction } from 'picosafe';
 * import { createWalletClient, http } from 'viem';
 * import { mainnet } from 'viem/chains';
 *
 * const walletClient = createWalletClient({
 *   chain: mainnet,
 *   transport: http(),
 * });
 *
 * const fallbackHandlerContract = '0x1234567890123456789012345678901234567890';
 *
 * const tx = await UNSAFE_getSetFallbackHandlerTransaction(
 *   walletClient,
 *   '0x742d35Cc6634C0532925a3b844Bc9e7595f4d3e2',
 *   fallbackHandlerContract,
 *   {
 *     nonce: 10n, // Use specific nonce
 *     safeTxGas: 100000n, // Set gas limit
 *   }
 * );
 *
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/FallbackManager.sol#L50
 */
function UNSAFE_getSetFallbackHandlerTransaction(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	handler: Address,
	transactionOptions?: Readonly<SecureSafeTransactionOptions>,
) {
	const data = encodeWithSelector(
		"0xf08a0323", // setFallbackHandler selector
		handler,
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

export { UNSAFE_getSetFallbackHandlerTransaction };
