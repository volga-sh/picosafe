import { useQuery } from "@tanstack/react-query";
import { getNonce, getOwners, getThreshold, getVersion } from "@volga/picosafe";
import type { EIP1193Provider, Address as ViemAddress } from "viem";

type Address = ViemAddress;

/**
 * Safe configuration data
 */
export type SafeConfiguration = {
	/** List of owner addresses (checksummed) */
	owners: Address[];
	/** Number of signatures required to execute transactions */
	threshold: bigint;
	/** Current Safe nonce */
	nonce: bigint;
	/** Safe contract version */
	version: string;
};

/**
 * Hook to fetch Safe configuration using picosafe SDK
 *
 * Uses TanStack Query for caching and automatic refetching
 *
 * @param provider - EIP-1193 provider from wallet connection
 * @param safeAddress - The Safe contract address to query
 * @param chainId - The chain ID where the Safe is deployed
 * @returns TanStack Query result with Safe configuration
 * @example
 * ```tsx
 * const provider = useEIP1193Provider()
 * const { data, isLoading, error } = useSafeConfiguration(
 *   provider,
 *   "0x742d35Cc6634C0532925a3b844Bc9e7595f4278",
 *   1
 * )
 *
 * if (isLoading) return <div>Loading...</div>
 * if (error) return <div>Error: {error.message}</div>
 *
 * return (
 *   <div>
 *     <p>Owners: {data.owners.length}</p>
 *     <p>Threshold: {data.threshold.toString()}</p>
 *   </div>
 * )
 * ```
 */
export function useSafeConfiguration(
	provider: EIP1193Provider | undefined,
	safeAddress: Address | undefined,
	chainId: number | undefined,
) {
	return useQuery({
		queryKey: ["safe-configuration", safeAddress, chainId],
		queryFn: async (): Promise<SafeConfiguration> => {
			if (!provider || !safeAddress) {
				throw new Error("Provider and Safe address are required");
			}

			// Fetch all Safe configuration data in parallel
			const [owners, threshold, nonce, version] = await Promise.all([
				getOwners(provider, { safeAddress }),
				getThreshold(provider, { safeAddress }),
				getNonce(provider, { safeAddress }),
				getVersion(provider, { safeAddress }),
			]);

			return {
				owners,
				threshold,
				nonce,
				version,
			};
		},
		enabled: !!provider && !!safeAddress && !!chainId,
		staleTime: 10000, // Consider data fresh for 10 seconds
		refetchOnWindowFocus: false,
	});
}
