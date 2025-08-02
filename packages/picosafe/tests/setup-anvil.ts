/**
 * @fileoverview Vitest setup file for managing Anvil instances per worker.
 *
 * This setup file enables parallel test execution by using the anvil-manager
 * package to handle Anvil instance lifecycle management.
 */

import {
	createTestAnvilOptions,
	getGlobalAnvilProcess,
	getTestAnvilPort,
	setGlobalAnvilProcess,
	startAnvil,
} from "@volga/anvil-manager";
import { getSafeGenesisPath } from "@volga/safe-genesis";
import { afterAll } from "vitest";

/**
 * Set environment variables for test Anvil instance
 */
function setTestAnvilEnvironment(port: number): void {
	const rpcUrl = `http://127.0.0.1:${port}`;
	process.env.TEST_ANVIL_RPC_URL = rpcUrl;
	process.env.TEST_ANVIL_PORT = String(port);
}

// Parse worker ID for unique port allocation
const workerIdRaw = process.env.VITEST_WORKER_ID;
const workerId = workerIdRaw ? Number.parseInt(workerIdRaw, 10) : 0;
if (Number.isNaN(workerId) || workerId < 0) {
	throw new Error(
		`Invalid VITEST_WORKER_ID: "${workerIdRaw}". Expected a non-negative integer.`,
	);
}

// Pre-deployed Safe contracts via genesis dramatically speed up tests
const genesisPath = getSafeGenesisPath();

const isVerbose = process.env.ANVIL_VERBOSE === "true";

// Check if we already have an Anvil instance for this worker
const existingProcess = getGlobalAnvilProcess();
if (!existingProcess || existingProcess.killed) {
	if (isVerbose) {
		console.log(`[Worker ${workerId}] Starting Anvil...`);
	}

	// Create test-specific options
	const options = createTestAnvilOptions(workerId, genesisPath);

	// Start Anvil instance
	const anvilInstance = await startAnvil(options);

	// Store the process globally to prevent duplicate spawns
	setGlobalAnvilProcess(anvilInstance.process);

	// Environment variables allow test files to connect to their worker's unique Anvil instance
	setTestAnvilEnvironment(anvilInstance.port);

	if (isVerbose) {
		console.log(`[Worker ${workerId}] Anvil ready at ${anvilInstance.rpcUrl}`);
	}

	// Cleanup must happen at worker shutdown to prevent orphaned processes
	afterAll(async () => {
		if (isVerbose) {
			console.log(`[Worker ${workerId}] Stopping Anvil...`);
		}
		try {
			await anvilInstance.stop();
		} catch (error) {
			console.error(`[Worker ${workerId}] Error stopping Anvil:`, error);
			// Force kill if graceful stop fails
			if (anvilInstance.process && !anvilInstance.process.killed) {
				anvilInstance.process.kill("SIGKILL");
			}
		} finally {
			setGlobalAnvilProcess(undefined);
		}
		await anvilInstance.stop();
		setGlobalAnvilProcess(undefined);
	});
} else {
	if (isVerbose) {
		console.log(`[Worker ${workerId}] Reusing existing Anvil instance`);
	}

	// Set environment variables for reused instance
	// Use the same port calculation as in createTestAnvilOptions
	const port = getTestAnvilPort(workerId);
	setTestAnvilEnvironment(port);
}

if (isVerbose) {
	console.log(
		`[Worker ${workerId}] Test environment ready with RPC URL: ${process.env.TEST_ANVIL_RPC_URL}`,
	);
}
