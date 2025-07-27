import { createServer } from "node:net";

/**
 * Find an available port starting from a preferred port
 * @param preferredPort - The preferred port to start searching from
 * @param maxAttempts - Maximum number of ports to try
 * @returns Promise resolving to an available port number
 */
export async function findAvailablePort(
	preferredPort = 8545,
	maxAttempts = 100,
): Promise<number> {
	// First try to get an OS-assigned port (port 0)
	// This is guaranteed to be available and avoids race conditions
	const osAssignedPort = await getOSAssignedPort();
	if (osAssignedPort !== null) {
		return osAssignedPort;
	}

	// Fallback to the original approach if OS assignment fails
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const port = preferredPort + attempt;

		// Skip privileged ports
		if (port < 1024) continue;
		// Skip invalid ports
		if (port > 65535) {
			throw new Error(
				`No available ports found in range ${preferredPort}-${preferredPort + maxAttempts}`,
			);
		}

		const isAvailable = await checkPortAvailable(port);
		if (isAvailable) {
			return port;
		}
	}

	throw new Error(
		`No available ports found after ${maxAttempts} attempts starting from port ${preferredPort}`,
	);
}

/**
 * Get an OS-assigned available port
 * @returns Promise resolving to an available port number, or null if failed
 * @warning RACE CONDITION: There is a time window between when this function returns
 * a port and when the consuming process (e.g., Anvil) actually binds to it. Another
 * process could potentially claim the port during this window. While extremely rare
 * in practice (especially for high-numbered OS-assigned ports), users should be aware
 * of this limitation. The risk is considered acceptable given the significant benefits
 * of automatic port discovery.
 */
async function getOSAssignedPort(): Promise<number | null> {
	return new Promise((resolve) => {
		const server = createServer();

		server.once("error", () => {
			resolve(null);
		});

		server.once("listening", () => {
			const address = server.address();
			server.close(() => {
				if (address && typeof address === "object") {
					resolve(address.port);
				} else {
					resolve(null);
				}
			});
		});

		// Port 0 lets the OS assign an available port
		server.listen(0, "127.0.0.1");
	});
}

/**
 * Check if a specific port is available
 * @param port - The port number to check
 * @returns Promise resolving to true if port is available, false otherwise
 */
export async function checkPortAvailable(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();

		server.once("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "EADDRINUSE") {
				resolve(false);
			} else {
				// Other errors we'll treat as unavailable
				resolve(false);
			}
		});

		server.once("listening", () => {
			server.close(() => {
				resolve(true);
			});
		});

		server.listen(port, "127.0.0.1");
	});
}
