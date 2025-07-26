import type { AnvilInstance, AnvilOptions } from "./types.js";
import { startAnvil } from "./core.js";

/**
 * Execute a function with a temporary Anvil instance that is automatically cleaned up
 * @param fn - The function to execute with the Anvil instance
 * @param options - Configuration options for the Anvil instance
 * @returns The result of the provided function
 * @throws {Error} If Anvil fails to start or the provided function throws
 * @example
 * ```typescript
 * import { withAnvil } from "@volga/anvil-manager";
 * import { createPublicClient, http } from "viem";
 * import { anvil } from "viem/chains";
 * 
 * const result = await withAnvil(async (instance) => {
 *   const client = createPublicClient({
 *     chain: anvil,
 *     transport: http(instance.rpcUrl),
 *   });
 *   
 *   const blockNumber = await client.getBlockNumber();
 *   console.log(`Current block: ${blockNumber}`);
 *   
 *   return blockNumber;
 * });
 * ```
 */
export async function withAnvil<T>(
	fn: (instance: AnvilInstance) => Promise<T>,
	options?: AnvilOptions,
): Promise<T> {
	const instance = await startAnvil(options);

	try {
		return await fn(instance);
	} finally {
		// Always clean up, even if the function throws
		await instance.stop();
	}
}