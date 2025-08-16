import { Address as AddressUtils } from "ox";
import type { Address } from "../ox-types";
import type { EIP1193ProviderWithRequestFn } from "../types";

/**
 * Retrieves the current chain ID from the connected provider.
 *
 * Sends an eth_chainId RPC request to the provider and converts the hexadecimal
 * response to a bigint for easier manipulation and comparison.
 *
 * @param provider - EIP-1193 compatible provider (e.g., MetaMask, WalletConnect)
 * @returns {Promise<bigint>} The chain ID as a bigint (e.g., 1n for Ethereum mainnet, 137n for Polygon)
 * @throws {Error} If the provider request fails or returns an invalid response
 * @example
 * // Get chain ID from MetaMask
 * const chainId = await getChainId(window.ethereum);
 * console.log(chainId); // 1n for mainnet
 *
 * @example
 * // Use with chain ID validation
 * const chainId = await getChainId(provider);
 * if (chainId !== 1n) {
 *   throw new Error('Please switch to Ethereum mainnet');
 * }
 */
async function getChainId(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
): Promise<bigint> {
	const chainIdHex = (await provider.request({
		method: "eth_chainId",
	})) as string;

	return BigInt(chainIdHex);
}

/**
 * Retrieves the list of accounts currently available to the provider.
 *
 * Sends an eth_accounts RPC request to get the list of addresses that the
 * provider has access to. For browser wallets, this typically returns the
 * currently connected accounts. Returns an empty array if no accounts are
 * connected.
 *
 * @param provider - EIP-1193 compatible provider (e.g., MetaMask, WalletConnect)
 * @returns {Promise<Address[]>} Array of checksummed Ethereum addresses available to the provider
 * @throws {Error} If the provider request fails
 * @example
 * ```typescript
 * import { getAccounts } from 'picosafe/utilities/eip1193-provider';
 *
 * // Get connected accounts from MetaMask
 * const accounts = await getAccounts(window.ethereum);
 * console.log('Connected accounts:', accounts);
 * // ['0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5']
 * ```
 */
async function getAccounts(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
): Promise<Address[]> {
	const accounts = (await provider.request({
		method: "eth_accounts",
	})) as Address[];

	return accounts.map((account) => AddressUtils.checksum(account));
}

export { getChainId, getAccounts };
