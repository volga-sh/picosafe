import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { AnvilOptions } from "./types.js";

/**
 * Calculate a unique port for a test worker to avoid conflicts in parallel test runs
 * @param workerId - The worker ID (typically from VITEST_WORKER_ID environment variable)
 * @param basePort - The base port to start from (can also be set via ANVIL_BASE_PORT env var)
 * @returns A unique port number for the worker
 * @example
 * ```typescript
 * import { getTestAnvilPort } from "@volga/anvil-manager";
 *
 * const workerId = parseInt(process.env.VITEST_WORKER_ID || "0");
 * const port = getTestAnvilPort(workerId);
 * console.log(`Worker ${workerId} will use port ${port}`);
 * ```
 */
export function getTestAnvilPort(workerId: number, basePort?: number): number {
	// Allow environment variable to override base port
	const effectiveBasePort =
		basePort ?? (Number(process.env.ANVIL_BASE_PORT) || 8545);
	if (workerId < 0 || !Number.isInteger(workerId)) {
		throw new Error(
			`Invalid workerId: ${workerId}. Expected a non-negative integer.`,
		);
	}

	const port = effectiveBasePort + workerId;

	// Validate resulting port is in valid range
	if (port < 1024 || port > 65535) {
		throw new Error(
			`Calculated port ${port} is out of valid range. ` +
				"Port must be between 1024 and 65535. " +
				`Consider using a different base port (current: ${effectiveBasePort}) or limiting worker count.`,
		);
	}

	return port;
}

/**
 * Create Anvil options pre-configured for test environments
 * @param workerId - The worker ID for port allocation
 * @param genesisPath - Optional path to genesis file with pre-deployed contracts
 * @returns AnvilOptions configured for testing
 * @example
 * ```typescript
 * import { createTestAnvilOptions, startAnvil } from "@volga/anvil-manager";
 *
 * const workerId = parseInt(process.env.VITEST_WORKER_ID || "0");
 * const options = createTestAnvilOptions(workerId, "./genesis.json");
 * const anvil = await startAnvil(options);
 * ```
 */
export function createTestAnvilOptions(
	workerId: number,
	genesisPath?: string,
): AnvilOptions {
	const port = getTestAnvilPort(workerId);

	return {
		port,
		accounts: 10,
		balance: "10000",
		genesisPath,
		verbose: process.env.ANVIL_VERBOSE === "true",
		autoMine: true,
	};
}

// Global storage for test Anvil instances to prevent duplicates
// See test-env.d.ts for the global type declaration

/**
 * Get the globally stored Anvil process for the current test worker
 * @returns The stored Anvil process or undefined
 */
export function getGlobalAnvilProcess() {
	return globalThis.__anvil_process__;
}

/**
 * Store an Anvil process globally for the current test worker
 * @param process - The Anvil process to store, or undefined to clear
 */
export function setGlobalAnvilProcess(
	process: ChildProcessWithoutNullStreams | undefined,
) {
	globalThis.__anvil_process__ = process;
}
