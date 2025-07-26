import { describe, expect, it } from "vitest";
import {
	getTestAnvilPort,
	createTestAnvilOptions,
	getGlobalAnvilProcess,
	setGlobalAnvilProcess,
} from "../src/test-utils.js";
import { spawn } from "node:child_process";

describe("Test Utilities", () => {
	describe("getTestAnvilPort", () => {
		it("should calculate unique ports based on worker ID", () => {
			expect(getTestAnvilPort(0)).toBe(8545);
			expect(getTestAnvilPort(1)).toBe(8546);
			expect(getTestAnvilPort(5)).toBe(8550);
		});

		it("should respect custom base port", () => {
			expect(getTestAnvilPort(0, 9000)).toBe(9000);
			expect(getTestAnvilPort(3, 9000)).toBe(9003);
		});

		it("should throw for invalid worker IDs", () => {
			expect(() => getTestAnvilPort(-1)).toThrow("Invalid workerId");
			expect(() => getTestAnvilPort(1.5)).toThrow("Invalid workerId");
			expect(() => getTestAnvilPort(NaN)).toThrow("Invalid workerId");
		});
	});

	describe("createTestAnvilOptions", () => {
		it("should create options with correct port", () => {
			const options = createTestAnvilOptions(2);
			expect(options.port).toBe(8547);
			expect(options.accounts).toBe(10);
			expect(options.balance).toBe("10000");
			expect(options.autoMine).toBe(true);
		});

		it("should include genesis path if provided", () => {
			const options = createTestAnvilOptions(0, "/path/to/genesis.json");
			expect(options.genesisPath).toBe("/path/to/genesis.json");
		});

		it("should respect ANVIL_VERBOSE environment variable", () => {
			const originalEnv = process.env.ANVIL_VERBOSE;
			
			process.env.ANVIL_VERBOSE = "true";
			const verboseOptions = createTestAnvilOptions(0);
			expect(verboseOptions.verbose).toBe(true);

			process.env.ANVIL_VERBOSE = "false";
			const quietOptions = createTestAnvilOptions(0);
			expect(quietOptions.verbose).toBe(false);

			// Restore original value
			if (originalEnv === undefined) {
				delete process.env.ANVIL_VERBOSE;
			} else {
				process.env.ANVIL_VERBOSE = originalEnv;
			}
		});
	});

	describe("Global Process Management", () => {
		it("should store and retrieve global process", () => {
			// Clear any existing process
			setGlobalAnvilProcess(undefined);
			expect(getGlobalAnvilProcess()).toBeUndefined();

			// Create a dummy process
			const dummyProcess = spawn("echo", ["test"], { stdio: "ignore" });
			
			setGlobalAnvilProcess(dummyProcess);
			expect(getGlobalAnvilProcess()).toBe(dummyProcess);

			// Clean up
			setGlobalAnvilProcess(undefined);
			dummyProcess.kill();
		});
	});
});