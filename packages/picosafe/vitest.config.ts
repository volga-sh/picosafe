/**
 * @fileoverview Vitest configuration for picosafe integration tests.
 *
 * Configuration choices explained:
 * - globals: true - Enables global test functions (describe, it, expect) without imports
 * - environment: "node" - Tests run in Node.js environment (not browser/jsdom)
 * - fileParallelism: false - Critical for blockchain tests to ensure predictable state
 *   between tests. Running tests in parallel against the same Anvil instance would
 *   cause race conditions and unpredictable failures.
 * - coverage.provider: "v8" - Uses V8's built-in coverage for accurate results
 * - coverage excludes - Omits non-source files from coverage reports
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		// Enable parallel test execution - each worker gets its own Anvil instance
		fileParallelism: true,
		// Run the Anvil setup before tests in each worker
		setupFiles: ["./tests/setup-anvil.ts"],
		// Keep setup file execution order predictable
		sequence: {
			setupFiles: "list",
		},
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: [
				"node_modules/**",
				"dist/**",
				"**/*.d.ts",
				"**/*.config.*",
				"**/.eslintrc.*",
				"coverage/**",
			],
		},
	},
});
