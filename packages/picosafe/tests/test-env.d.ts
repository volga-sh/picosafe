/**
 * @fileoverview Type declarations for test environment globals
 */

import type { ChildProcess } from "node:child_process";

declare global {
	// Environment variables set by setup-anvil.ts
	namespace NodeJS {
		interface ProcessEnv {
			TEST_ANVIL_RPC_URL?: string;
			TEST_ANVIL_PORT?: string;
			VITEST_WORKER_ID?: string;
		}
	}

	// Global storage for Anvil process
	var __anvil_process__: ChildProcess | undefined;
}
