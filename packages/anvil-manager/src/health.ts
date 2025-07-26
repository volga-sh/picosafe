import { createPublicClient, http } from "viem";
import { anvil } from "viem/chains";
import type { HealthCheckOptions } from "./types.js";

const DEFAULT_MAX_ATTEMPTS = 30;
const DEFAULT_INITIAL_DELAY_MS = 200;
const DEFAULT_MAX_BACKOFF_DELAY_MS = 3200;

/**
 * Wait for an Anvil instance to be ready to accept connections
 * @param rpcUrl - The RPC URL to check
 * @param options - Health check configuration options
 * @throws {Error} If the instance doesn't become ready within the maximum attempts
 * @example
 * ```typescript
 * import { waitForAnvil } from "@volga/anvil-manager/health";
 * 
 * await waitForAnvil("http://localhost:8545");
 * console.log("Anvil is ready!");
 * ```
 */
export async function waitForAnvil(
	rpcUrl: string,
	options: HealthCheckOptions = {},
): Promise<void> {
	const {
		maxAttempts = DEFAULT_MAX_ATTEMPTS,
		initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
		maxBackoffDelayMs = DEFAULT_MAX_BACKOFF_DELAY_MS,
	} = options;

	// Create client once to reuse across retries
	const client = createPublicClient({
		chain: anvil,
		transport: http(rpcUrl),
	});

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			// Simple RPC call to check if Anvil is responsive
			await client.getBlockNumber();
			return;
		} catch (error) {
			if (attempt === maxAttempts - 1) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				const port = new URL(rpcUrl).port || "8545";
				throw new Error(
					`Failed to connect to Anvil at ${rpcUrl} after ${maxAttempts} attempts. ` +
						`This could be due to: Anvil still starting up, port ${port} already in use, ` +
						`Anvil process crashed, or network issues. Last error: ${errorMessage}`,
				);
			}

			// Exponential backoff with maximum delay
			const backoffDelay = Math.min(
				initialDelayMs * 2 ** attempt,
				maxBackoffDelayMs,
			);
			await new Promise((resolve) => setTimeout(resolve, backoffDelay));
		}
	}
}