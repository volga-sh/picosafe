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
