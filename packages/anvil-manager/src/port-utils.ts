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
