// Core functionality
export { startAnvil, stopAnvil } from "./core.js";
export { withAnvil } from "./with-anvil.js";
export { waitForAnvil } from "./health.js";

// Test utilities
export {
	getTestAnvilPort,
	createTestAnvilOptions,
	getGlobalAnvilProcess,
	setGlobalAnvilProcess,
} from "./test-utils.js";

// Types
export type {
	AnvilOptions,
	AnvilInstance,
	HealthCheckOptions,
} from "./types.js";