import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { spawn } from "node:child_process"
import { waitForAnvil } from "./health.js"
import { checkPortAvailable, findAvailablePort } from "./port-utils.js"
import type { AnvilInstance, AnvilOptions } from "./types.js"

const DEFAULT_PORT = 8545
const DEFAULT_ACCOUNTS = 10
const DEFAULT_BALANCE = "10000"
const DEFAULT_GRACEFUL_SHUTDOWN_MS = 500

/**
 * Start a new Anvil instance with the specified options
 * @param options - Configuration options for the Anvil instance
 * @returns A promise that resolves to an AnvilInstance object
 * @throws {Error} If Anvil fails to start or become ready
 * @note The additionalArgs parameter is validated using a whitelist approach to prevent shell injection attacks.
 * Only alphanumeric characters, hyphens, underscores, equals signs, colons, slashes, and dots are allowed.
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
export async function startAnvil(options: AnvilOptions = {}): Promise<AnvilInstance> {
  const {
    port: requestedPort,
    accounts = DEFAULT_ACCOUNTS,
    balance = DEFAULT_BALANCE,
    genesisPath,
    verbose = false,
    autoMine = true,
    blockTime,
    additionalArgs = [],
  } = options

  // Use requested port or find an available one
  let port: number
  if (requestedPort !== undefined) {
    // Validate port number if explicitly provided
    if (requestedPort < 1024 || requestedPort > 65535) {
      throw new Error(
        `Invalid port number: ${requestedPort}. Port must be between 1024 and 65535. ` +
          "Ports 1-1023 are privileged and require root access."
      )
    }

    // Check if the requested port is available
    const isAvailable = await checkPortAvailable(requestedPort)
    if (!isAvailable) {
      throw new Error(
        `Port ${requestedPort} is already in use. ` +
          "Please specify a different port or omit the port option to use automatic port discovery."
      )
    }

    port = requestedPort
  } else {
    // Find an available port automatically
    port = await findAvailablePort(DEFAULT_PORT)
  }

  const args: string[] = [
    "--port",
    String(port),
    "--accounts",
    String(accounts),
    "--balance",
    balance,
  ]

  if (genesisPath) {
    args.push("--init", genesisPath)
  }

  if (!autoMine) {
    args.push("--no-mining")
  }

  if (blockTime !== undefined) {
    args.push("--block-time", String(blockTime))
  }

  // Validate additionalArgs to prevent command injection
  // Using a whitelist approach for better security
  const safeArgPattern = /^[a-zA-Z0-9\-_=:/.]+$/
  const invalidArgs = additionalArgs.filter((arg) => !safeArgPattern.test(arg))

  if (invalidArgs.length > 0) {
    // Provide detailed information about what's not allowed
    const dangerousChars = [
      ";",
      "&&",
      "||",
      "|",
      ">",
      "<",
      "`",
      "$",
      "(",
      ")",
      "&",
      "\n",
      "\r",
      " ",
      "\t",
      "*",
      "?",
      "[",
      "]",
      "{",
      "}",
      "'",
      '"',
      "\\",
    ]
    throw new Error(
      "Invalid characters in additional arguments. " +
        "Arguments must only contain alphanumeric characters, hyphens, underscores, equals signs, colons, slashes, and dots. " +
        `Dangerous characters include: ${dangerousChars.join(", ")}. ` +
        `Found invalid arguments: ${invalidArgs.join(", ")}`
    )
  }

  args.push(...additionalArgs)

  const anvilProcess = spawn("anvil", args, {
    stdio: verbose ? "inherit" : "pipe",
    detached: false,
  })

  // Track if we're still in startup phase
  let isStarting = true

  // Handle spawn errors and early exits
  const spawnErrorPromise = new Promise<never>((_, reject) => {
    anvilProcess.on("error", (error) => {
      // Check if it's a "command not found" error
      if ("code" in error && error.code === "ENOENT") {
        reject(
          new Error(
            "Anvil is not installed or not found in PATH.\n" +
              "Please install Foundry by visiting https://getfoundry.sh/\n" +
              "Quick install: curl -L https://foundry.paradigm.xyz | bash"
          )
        )
      } else {
        reject(
          new Error(
            `Failed to start Anvil: ${error.message}. ` +
              `Please ensure 'anvil' is installed and available in your PATH.`
          )
        )
      }
    })

    // Also handle if the process exits immediately (e.g., due to bad arguments)
    anvilProcess.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      if (isStarting && code !== 0) {
        reject(
          new Error(
            `Anvil process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}. ` +
              "This could be due to invalid arguments or port conflicts."
          )
        )
      }
    })
  })

  // Create the instance object
  const rpcUrl = `http://127.0.0.1:${port}`
  let stopped = false

  const instance: AnvilInstance = {
    rpcUrl,
    port,
    process: anvilProcess as ChildProcessWithoutNullStreams,
    async stop(gracefulShutdownMs = DEFAULT_GRACEFUL_SHUTDOWN_MS) {
      if (stopped) return
      stopped = true
      await stopAnvil(instance, gracefulShutdownMs)
    },
    async waitForReady() {
      await waitForAnvil(rpcUrl)
    },
  }

  // Register cleanup handler for this specific process
  const cleanup = () => {
    if (!stopped && anvilProcess && !anvilProcess.killed) {
      anvilProcess.kill("SIGKILL")
    }
  }

  // Clean up if the parent process exits unexpectedly
  process.once("exit", cleanup)
  process.once("SIGINT", cleanup)
  process.once("SIGTERM", cleanup)

  // Remove cleanup handlers when process is properly stopped
  anvilProcess.once("exit", () => {
    process.removeListener("exit", cleanup)
    process.removeListener("SIGINT", cleanup)
    process.removeListener("SIGTERM", cleanup)
  })

  // Log output if not in verbose mode (verbose mode uses inherit)
  if (!verbose) {
    anvilProcess.stdout?.on("data", (data) => {
      if (process.env.ANVIL_DEBUG) {
        console.log(`[Anvil] ${data.toString().trim()}`)
      }
    })

    anvilProcess.stderr?.on("data", (data) => {
      console.error(`[Anvil Error] ${data.toString().trim()}`)
    })
  }

  // Wait for Anvil to be ready
  try {
    await Promise.race([instance.waitForReady(), spawnErrorPromise])
    // Mark that we're no longer in startup phase
    isStarting = false
  } catch (error) {
    // Clean up on failure
    anvilProcess.kill("SIGKILL")
    throw error
  }

  return instance
}

/**
 * Stop a running Anvil instance gracefully
 * @param instance - The AnvilInstance to stop
 * @param gracefulShutdownMs - Milliseconds to wait for graceful shutdown before force killing
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
export async function stopAnvil(
  instance: AnvilInstance,
  gracefulShutdownMs = DEFAULT_GRACEFUL_SHUTDOWN_MS
): Promise<void> {
  const { process } = instance

  if (process.killed || process.exitCode !== null) {
    return
  }

  // Try graceful shutdown first
  process.kill("SIGTERM")

  // Wait for either the process to exit or the timeout
  // This is more efficient than always waiting the full timeout
  const exitPromise = new Promise<void>((resolve) => {
    process.once("exit", () => resolve())
  })
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => resolve(), gracefulShutdownMs)
  })

  await Promise.race([exitPromise, timeoutPromise])

  // Force kill if still running after timeout
  if (process.exitCode === null && !process.killed) {
    process.kill("SIGKILL")
    // Wait for process to actually exit with a timeout
    await Promise.race([exitPromise, new Promise<void>((resolve) => setTimeout(resolve, 1000))])

    // If process is still not dead after SIGKILL + 1 second, log a warning
    if (process.exitCode === null && !process.killed) {
      console.error(
        `Warning: Anvil process (PID: ${process.pid}) did not terminate after SIGKILL. ` +
          "This process may need to be manually killed."
      )
    }
  }
}
