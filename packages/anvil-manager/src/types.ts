import type { ChildProcessWithoutNullStreams } from "node:child_process";

/**
 * Configuration options for starting an Anvil instance
 */
export type AnvilOptions = {
	/**
	 * Port number for the RPC server
	 * @default 8545
	 */
	port?: number;

	/**
	 * Number of accounts to generate
	 * @default 10
	 */
	accounts?: number;

	/**
	 * Initial balance for each account (in ether)
	 * @default "10000"
	 */
	balance?: string;

	/**
	 * Path to genesis JSON file for pre-deployed contracts
	 */
	genesisPath?: string;

	/**
	 * Enable verbose logging
	 * @default false
	 */
	verbose?: boolean;

	/**
	 * Enable auto-mining
	 * @default true
	 */
	autoMine?: boolean;

	/**
	 * Block time in seconds (undefined for instant mining)
	 */
	blockTime?: number;

	/**
	 * Additional CLI arguments to pass to anvil
	 */
	additionalArgs?: string[];
};

/**
 * Represents a running Anvil instance
 */
export type AnvilInstance = {
	/**
	 * RPC URL for connecting to the instance
	 */
	rpcUrl: string;

	/**
	 * Port number the instance is running on
	 */
	port: number;

	/**
	 * Underlying child process
	 */
	process: ChildProcessWithoutNullStreams;

	/**
	 * Stop the Anvil instance gracefully
	 */
	stop(): Promise<void>;

	/**
	 * Wait for the instance to be ready to accept connections
	 */
	waitForReady(): Promise<void>;
};

/**
 * Options for health checking
 */
export type HealthCheckOptions = {
	/**
	 * Maximum number of attempts
	 * @default 30
	 */
	maxAttempts?: number;

	/**
	 * Initial delay between attempts in milliseconds
	 * @default 200
	 */
	initialDelayMs?: number;

	/**
	 * Maximum backoff delay in milliseconds
	 * @default 3200
	 */
	maxBackoffDelayMs?: number;
};
