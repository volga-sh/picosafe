import { useConnectWallet } from "@web3-onboard/react";
import type { EIP1193Provider } from "viem";

/**
 * Hook to get the EIP-1193 provider from the connected wallet
 *
 * This provider can be used directly with the picosafe SDK, which accepts
 * any EIP-1193 compatible provider.
 *
 * @returns The EIP-1193 provider or undefined if no wallet is connected
 * @example
 * ```tsx
 * const provider = useEIP1193Provider()
 * if (provider) {
 *   const result = await deploySafeAccount(provider, {...})
 * }
 * ```
 */
export function useEIP1193Provider(): EIP1193Provider | undefined {
	const [{ wallet }] = useConnectWallet();

	if (!wallet) return undefined;

	// The wallet.provider from web3-onboard is already EIP-1193 compatible
	return wallet.provider as EIP1193Provider;
}
