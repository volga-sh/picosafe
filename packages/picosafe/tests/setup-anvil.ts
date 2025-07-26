/**
 * @fileoverview Vitest setup file for managing Anvil instances per worker.
 *
 * This setup file enables parallel test execution by:
 * - Starting a separate Anvil instance for each Vitest worker on a unique port
 * - Exposing the RPC URL via environment variable for test access
 * - Ensuring proper cleanup when tests complete
 * - Preventing duplicate Anvil spawns within the same worker
 *
 * Each worker gets assigned a monotonically increasing ID (0, 1, 2, ...) which
 * is used to calculate unique ports, avoiding conflicts between parallel runs.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http } from "viem";
import { anvil } from "viem/chains";
import { afterAll } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse worker ID with validation to ensure we get a valid number for port calculation
const workerIdRaw = process.env.VITEST_WORKER_ID;
const workerId = workerIdRaw ? Number.parseInt(workerIdRaw, 10) : 0;
if (Number.isNaN(workerId) || workerId < 0) {
	throw new Error(
		`Invalid VITEST_WORKER_ID: "${workerIdRaw}". Expected a non-negative integer.`,
	);
}

// Brief delay allows Anvil to shut down gracefully before SIGKILL
const GRACEFUL_SHUTDOWN_DELAY_MS = 500;

// Initial delay for health check allows Anvil to start up
const INITIAL_HEALTH_CHECK_DELAY_MS = 200;

// Maximum attempts for health check prevents infinite waiting
const MAX_HEALTH_CHECK_ATTEMPTS = 30;

// Maximum backoff delay prevents excessive waiting between retries
const MAX_BACKOFF_DELAY_MS = 3200;

// Port allocation prevents conflicts when running tests in parallel.
// Each worker needs its own Anvil instance on a unique port.
const port = 8545 + workerId;
const rpcUrl = `http://127.0.0.1:${port}`;

// Pre-deployed Safe contracts via genesis dramatically speed up tests
// by avoiding repeated deployments in each test suite.
const genesisPath = join(__dirname, "scripts", "genesis.json");

if (!existsSync(genesisPath)) {
	throw new Error(
		`Genesis file not found at ${genesisPath}. This file is required for pre-deployed Safe contracts.`,
	);
}

/**
 * Health check for Anvil instance using JSON-RPC call
 * @param url The RPC URL to check
 * @param maxAttempts Maximum number of attempts
 * @param delayMs Delay between attempts in milliseconds
 */
async function waitForAnvil(
	url: string,
	maxAttempts = MAX_HEALTH_CHECK_ATTEMPTS,
	delayMs = INITIAL_HEALTH_CHECK_DELAY_MS,
): Promise<void> {
	const client = createPublicClient({
		chain: anvil,
		transport: http(url),
	});

	for (let i = 0; i < maxAttempts; i++) {
		try {
			await client.getBlockNumber();
			return;
		} catch (error) {
			if (i === maxAttempts - 1) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				throw new Error(
					`Failed to connect to Anvil at ${url} after ${maxAttempts} attempts. ` +
						`This could be due to: Anvil still starting up, port ${port} already in use, ` +
						`Anvil process crashed, or network issues. Last error: ${errorMessage}`,
				);
			}
			// Exponential backoff with a max delay
			const backoffDelay = Math.min(delayMs * 2 ** i, MAX_BACKOFF_DELAY_MS);
			await new Promise((resolve) => setTimeout(resolve, backoffDelay));
		}
	}
}

const isVerbose = process.env.ANVIL_VERBOSE === "true";

/**
 * Retrieves the global Anvil process instance for the current worker.
 *
 * This function implements a global state management pattern to ensure only one
 * Anvil instance runs per worker, even if Vitest re-imports the setup file multiple
 * times. The process is stored on globalThis to persist across module reloads within
 * the same Node.js process.
 *
 * @returns The Anvil child process instance if one exists, undefined otherwise
 */
function getAnvilProcess() {
	return globalThis.__anvil_process__;
}

/**
 * Stores the Anvil process instance in global state for the current worker.
 *
 * This function complements getAnvilProcess() to provide controlled access to the
 * shared Anvil instance. By storing the process on globalThis, we prevent duplicate
 * Anvil spawns when Vitest's module isolation causes this setup file to be re-evaluated
 * within the same worker process.
 *
 * @param process The Anvil child process to store, or undefined to clear the stored process
 */
function setAnvilProcess(process: ReturnType<typeof spawn> | undefined) {
	globalThis.__anvil_process__ = process;
}

const existingProcess = getAnvilProcess();
if (!existingProcess || existingProcess.killed) {
	if (isVerbose) {
		console.log(`[Worker ${workerId}] Starting Anvil on port ${port}...`);
	}

	const anvilProcess = spawn(
		"anvil",
		[
			"--init",
			genesisPath,
			"--accounts",
			"10",
			"--balance",
			"10000",
			"--port",
			String(port),
		],
		{
			stdio: "pipe",
			detached: false,
		},
	);

	setAnvilProcess(anvilProcess);

	// Only exit on spawn failure to prevent test suite crashes from
	// transient Anvil issues during test execution.
	anvilProcess.on("error", (error) => {
		console.error(
			`[Worker ${workerId}] Failed to start Anvil on port ${port}: ${error.message}. ` +
				`Please check if the port is already in use or if the 'anvil' binary is installed and accessible.`,
		);
		process.exit(1);
	});

	anvilProcess.on("exit", (code, signal) => {
		if (isVerbose && code !== 0 && code !== null) {
			console.error(
				`[Worker ${workerId}] Anvil exited with code ${code}, signal ${signal}`,
			);
		}
	});

	if (isVerbose) {
		anvilProcess.stdout?.on("data", (data) => {
			console.log(`[Anvil ${workerId}] ${data.toString().trim()}`);
		});

		anvilProcess.stderr?.on("data", (data) => {
			console.error(`[Anvil ${workerId} ERROR] ${data.toString().trim()}`);
		});
	}

	await waitForAnvil(rpcUrl);
	if (isVerbose) {
		console.log(`[Worker ${workerId}] Anvil ready at ${rpcUrl}`);
	}

	// Cleanup must happen at worker shutdown to prevent orphaned processes.
	// Vitest's afterAll hook ensures this runs after all tests in the worker complete.
	afterAll(async () => {
		const process = getAnvilProcess();
		if (process && !process.killed) {
			if (isVerbose) {
				console.log(`[Worker ${workerId}] Stopping Anvil...`);
			}
			process.kill("SIGTERM");
			await new Promise((resolve) =>
				setTimeout(resolve, GRACEFUL_SHUTDOWN_DELAY_MS),
			);
			// process.killed only indicates a signal was sent, not that the process exited.
			// exitCode === null means the process is still running, ensuring we don't SIGKILL
			// a process that already gracefully shut down but hasn't updated its killed status yet.
			if (process.exitCode === null) {
				process.kill("SIGKILL");
			}
			setAnvilProcess(undefined);
		}
	});
} else {
	if (isVerbose) {
		console.log(
			`[Worker ${workerId}] Reusing existing Anvil instance on port ${port}`,
		);
	}
}

// Environment variables allow test files to connect to their worker's
// unique Anvil instance without hardcoding ports.
process.env.TEST_ANVIL_RPC_URL = rpcUrl;
process.env.TEST_ANVIL_PORT = String(port);

if (isVerbose) {
	console.log(
		`[Worker ${workerId}] Test environment ready with RPC URL: ${rpcUrl}`,
	);
}
