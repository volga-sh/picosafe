import type { HealthCheckOptions } from "./types.js";

/**
 * JSON-RPC response structure
 */
type JsonRpcResponse = {
	jsonrpc: string;
	id: number;
	result?: unknown;
	error?: {
		code: number;
		message: string;
	};
};

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
 * import { waitForAnvil } from "@volga/anvil-manager";
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

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			// Make a raw JSON-RPC call to check if Anvil is responsive
			const response = await fetch(rpcUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					method: "eth_blockNumber",
					params: [],
					id: 1,
				}),
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const data = (await response.json()) as JsonRpcResponse;

			// Check for JSON-RPC error in response
			if (data.error) {
				throw new Error(`RPC Error ${data.error.code}: ${data.error.message}`);
			}

			// If we get a valid response with a result, Anvil is ready
			if (data.result !== undefined) {
				return;
			}

			throw new Error("Invalid RPC response: missing result");
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
