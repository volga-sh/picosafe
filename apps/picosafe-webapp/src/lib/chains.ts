/**
 * Chain configuration for supported networks
 *
 * Currently supports Ethereum mainnet only
 */

export type Chain = {
	name: string;
	chain: string;
	chainId: number;
	shortName: string;
	nativeCurrency: {
		name: string;
		symbol: string;
		decimals: number;
	};
	rpc: Array<{ url: string }>;
	explorers: Array<{
		name: string;
		url: string;
		standard: string;
	}>;
	infoURL: string;
};

/**
 * Ethereum mainnet configuration
 */
export const ETHEREUM_MAINNET: Chain = {
	name: "Ethereum Mainnet",
	chain: "ETH",
	chainId: 1,
	shortName: "eth",
	nativeCurrency: {
		name: "Ether",
		symbol: "ETH",
		decimals: 18,
	},
	rpc: [
		{ url: "https://ethereum.publicnode.com" },
		{ url: "https://rpc.ankr.com/eth" },
		{ url: "https://eth.llamarpc.com" },
	],
	explorers: [
		{
			name: "Etherscan",
			url: "https://etherscan.io",
			standard: "EIP3091",
		},
	],
	infoURL: "https://ethereum.org",
};

/**
 * List of all supported chains
 * Currently Ethereum mainnet only
 */
export const SUPPORTED_CHAINS: Chain[] = [ETHEREUM_MAINNET];

/**
 * Get chain configuration by chain ID
 *
 * @param chainId - The chain ID to look up
 * @returns Chain configuration or undefined if not found
 */
export function getChainById(chainId: number): Chain | undefined {
	return SUPPORTED_CHAINS.find((chain) => chain.chainId === chainId);
}

/**
 * Get the first available RPC URL for a chain
 *
 * @param chainId - The chain ID
 * @returns RPC URL or undefined if chain not found
 */
export function getRpcUrlByChainId(chainId: number): string | undefined {
	const chain = getChainById(chainId);
	return chain?.rpc[0]?.url;
}
