import { spawn } from "node:child_process";
import type { AnvilInstance, AnvilOptions } from "./types.js";
import { waitForAnvil } from "./health.js";

const DEFAULT_PORT = 8545;
const DEFAULT_ACCOUNTS = 10;
const DEFAULT_BALANCE = "10000";
const GRACEFUL_SHUTDOWN_DELAY_MS = 500;

/**
 * Start a new Anvil instance with the specified options
 * @param options - Configuration options for the Anvil instance
 * @returns A promise that resolves to an AnvilInstance object
 * @throws {Error} If Anvil fails to start or become ready
 * @example
 * ```typescript
 * import { startAnvil } from "@volga/anvil-manager";
 * 
 * const anvil = await startAnvil({
 *   port: 8545,
 *   accounts: 10,
 *   balance: "10000"
 * });
 * 
 * console.log(`Anvil running at ${anvil.rpcUrl}`);
 * 
 * // Later, stop the instance
 * await anvil.stop();
 * ```
 */
export async function startAnvil(
	options: AnvilOptions = {},
): Promise<AnvilInstance> {
	const {
		port = DEFAULT_PORT,
		accounts = DEFAULT_ACCOUNTS,
		balance = DEFAULT_BALANCE,
		genesisPath,
		verbose = false,
		autoMine = true,
		blockTime,
		additionalArgs = [],
	} = options;

	const args: string[] = [
		"--port",
		String(port),
		"--accounts",
		String(accounts),
		"--balance",
		balance,
	];

	if (genesisPath) {
		args.push("--init", genesisPath);
	}

	if (!autoMine) {
		args.push("--no-mining");
	}

	if (blockTime !== undefined) {
		args.push("--block-time", String(blockTime));
	}

	args.push(...additionalArgs);

	const anvilProcess = spawn("anvil", args, {
		stdio: verbose ? "inherit" : "pipe",
		detached: false,
	});

	// Track if we're still in startup phase
	let isStarting = true;
	
	// Handle spawn errors and early exits
	const spawnErrorPromise = new Promise<never>((_, reject) => {
		anvilProcess.on("error", (error) => {
			reject(
				new Error(
					`Failed to start Anvil: ${error.message}. ` +
						`Please ensure 'anvil' is installed and available in your PATH.`,
				),
			);
		});
		
		// Also handle if the process exits immediately (e.g., due to bad arguments)
		const exitHandler = (code: number | null, signal: NodeJS.Signals | null) => {
			if (isStarting && code !== 0) {
				reject(
					new Error(
						`Anvil process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}. ` +
						`This could be due to invalid arguments or port conflicts.`,
					),
				);
			}
		};
		anvilProcess.once("exit", exitHandler);
	});

	// Create the instance object
	const rpcUrl = `http://127.0.0.1:${port}`;
	let stopped = false;

	const instance: AnvilInstance = {
		rpcUrl,
		port,
		process: anvilProcess as AnvilInstance["process"],
		async stop() {
			if (stopped) return;
			stopped = true;
			await stopAnvil(instance);
		},
		async waitForReady() {
			await waitForAnvil(rpcUrl);
		},
	};

	// Log output if not in verbose mode (verbose mode uses inherit)
	if (!verbose) {
		anvilProcess.stdout?.on("data", (data) => {
			if (process.env.ANVIL_DEBUG) {
				console.log(`[Anvil] ${data.toString().trim()}`);
			}
		});

		anvilProcess.stderr?.on("data", (data) => {
			console.error(`[Anvil Error] ${data.toString().trim()}`);
		});
	}

	// Wait for Anvil to be ready
	try {
		await Promise.race([instance.waitForReady(), spawnErrorPromise]);
		// Mark that we're no longer in startup phase
		isStarting = false;
	} catch (error) {
		// Clean up on failure
		anvilProcess.kill("SIGKILL");
		throw error;
	}

	return instance;
}

/**
 * Stop a running Anvil instance gracefully
 * @param instance - The AnvilInstance to stop
 * @returns A promise that resolves when the instance has stopped
 * @example
 * ```typescript
 * import { startAnvil, stopAnvil } from "@volga/anvil-manager";
 * 
 * const anvil = await startAnvil();
 * // Use the instance...
 * await stopAnvil(anvil);
 * ```
 */
export async function stopAnvil(instance: AnvilInstance): Promise<void> {
	const { process } = instance;

	if (process.killed || process.exitCode !== null) {
		return;
	}

	// Try graceful shutdown first
	process.kill("SIGTERM");

	// Wait for graceful shutdown
	await new Promise((resolve) =>
		setTimeout(resolve, GRACEFUL_SHUTDOWN_DELAY_MS),
	);

	// Force kill if still running
	if (process.exitCode === null && !process.killed) {
		process.kill("SIGKILL");
	}

	// Wait for process to actually exit
	if (process.exitCode === null) {
		await new Promise<void>((resolve) => {
			process.on("exit", () => resolve());
		});
	}
}