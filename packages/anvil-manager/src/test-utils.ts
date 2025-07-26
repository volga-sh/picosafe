import type { AnvilOptions } from "./types.js";

/**
 * Calculate a unique port for a test worker to avoid conflicts in parallel test runs
 * @param workerId - The worker ID (typically from VITEST_WORKER_ID environment variable)
 * @param basePort - The base port to start from
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
export function getTestAnvilPort(workerId: number, basePort = 8545): number {
	if (workerId < 0 || !Number.isInteger(workerId)) {
		throw new Error(
			`Invalid workerId: ${workerId}. Expected a non-negative integer.`,
		);
	}
	return basePort + workerId;
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
declare global {
	// biome-ignore lint/style/noVar: Need var for global declaration
	var __anvil_process__: ReturnType<typeof import("node:child_process").spawn> | undefined;
}

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
	process: ReturnType<typeof import("node:child_process").spawn> | undefined,
) {
	globalThis.__anvil_process__ = process;
}