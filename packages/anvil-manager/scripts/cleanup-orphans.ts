#!/usr/bin/env node

/**
 * Script to clean up orphaned Anvil processes
 * Usage: npx tsx scripts/cleanup-orphans.ts [--dry-run]
 */

import { execSync } from "node:child_process";
import { platform } from "node:os";

const isDryRun = process.argv.includes("--dry-run");

interface AnvilProcess {
	pid: string;
	command: string;
}

function findAnvilProcesses(): AnvilProcess[] {
	// Check platform support
	if (platform() === "win32") {
		console.error("Error: This script only supports Linux and macOS.");
		console.error("Windows support is not available at this time.");
		process.exit(1);
	}

	try {
		// Use ps to find all anvil processes (Linux/macOS)
		const output = execSync("ps aux | grep '[a]nvil' || true", {
			encoding: "utf-8",
		});

		const lines = output.trim().split("\n").filter(Boolean);
		const processes: AnvilProcess[] = [];

		for (const line of lines) {
			const parts = line.split(/\s+/);
			if (parts.length >= 11) {
				const pid = parts[1];
				const command = parts.slice(10).join(" ");

				// Filter to actual anvil processes (not grep, editors, etc)
				if (
					command.includes("anvil") &&
					!command.includes("grep") &&
					!command.includes("cleanup-orphans")
				) {
					processes.push({ pid, command });
				}
			}
		}

		return processes;
	} catch (error) {
		console.error(
			"Error finding processes:",
			error instanceof Error ? error.message : String(error),
		);
		return [];
	}
}

function killProcess(pid: string): boolean {
	try {
		if (isDryRun) {
			console.log(`[DRY RUN] Would kill process ${pid}`);
			return true;
		}

		execSync(`kill -9 ${pid}`, { stdio: "ignore" });
		return true;
	} catch {
		// Process might have already exited
		return false;
	}
}

function main(): void {
	console.log("Searching for orphaned Anvil processes...\n");

	const processes = findAnvilProcesses();

	if (processes.length === 0) {
		console.log("No Anvil processes found.");
		return;
	}

	console.log(`Found ${processes.length} Anvil process(es):\n`);

	for (const proc of processes) {
		console.log(`PID: ${proc.pid}`);
		console.log(`Command: ${proc.command}`);
		console.log("---");
	}

	if (isDryRun) {
		console.log("\nDry run mode - no processes will be killed.");
		console.log("Run without --dry-run to actually kill the processes.");
		return;
	}

	console.log("\nKilling processes...");

	let killed = 0;
	for (const proc of processes) {
		if (killProcess(proc.pid)) {
			console.log(`✓ Killed process ${proc.pid}`);
			killed++;
		} else {
			console.log(
				`✗ Failed to kill process ${proc.pid} (may have already exited)`,
			);
		}
	}

	console.log(`\nCleanup complete. Killed ${killed} process(es).`);
}

main();
