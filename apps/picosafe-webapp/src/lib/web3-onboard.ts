import type { InitOptions } from "@web3-onboard/core";
import injectedModule from "@web3-onboard/injected-wallets";

/**
 * Configuration for @web3-onboard wallet connection
 *
 * Supports all networks without requiring upfront network specification
 * Uses injected wallet providers (MetaMask, Coinbase Wallet, etc.)
 */

const injected = injectedModule();

export const web3OnboardConfig: InitOptions = {
	wallets: [injected],
	chains: [
		{
			id: "0x1", // Ethereum mainnet
			token: "ETH",
			label: "Ethereum Mainnet",
			rpcUrl: "https://ethereum.publicnode.com",
		},
	],
	appMetadata: {
		name: "picosafe",
		icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
		description: "Minimalistic but advanced Safe Smart Account SDK",
		recommendedInjectedWallets: [
			{ name: "MetaMask", url: "https://metamask.io" },
			{ name: "Coinbase", url: "https://wallet.coinbase.com/" },
		],
	},
	accountCenter: {
		desktop: {
			enabled: true,
			position: "topRight",
		},
		mobile: {
			enabled: true,
			position: "topRight",
		},
	},
};
