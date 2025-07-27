import { createPublicClient, createWalletClient, http } from "viem";
import { anvil } from "viem/chains";
import { describe, expect, it } from "vitest";
import { startAnvil } from "../src/core.js";

describe("Core Anvil Management", () => {
	it("should start and stop an Anvil instance", async () => {
		// Let AnvilManager find an available port automatically
		const instance = await startAnvil();

		expect(instance.port).toBeGreaterThanOrEqual(8545);
		expect(instance.rpcUrl).toBe(`http://127.0.0.1:${instance.port}`);
		expect(instance.process.pid).toBeDefined();

		// Verify it's actually running
		const client = createPublicClient({
			chain: anvil,
			transport: http(instance.rpcUrl),
		});
		const blockNumber = await client.getBlockNumber();
		expect(blockNumber).toBeDefined();

		// Stop the instance
		await instance.stop();

		// Wait a bit for the process to fully terminate
		await new Promise((resolve) => setTimeout(resolve, 1000));

		// Verify it's stopped by trying to connect with a new client
		const newClient = createPublicClient({
			chain: anvil,
			transport: http(instance.rpcUrl),
		});
		await expect(newClient.getBlockNumber()).rejects.toThrow();
	});

	it("should handle multiple instances on different ports", async () => {
		// Let AnvilManager find available ports automatically
		const instance1 = await startAnvil();
		const instance2 = await startAnvil();

		expect(instance1.port).not.toBe(instance2.port);

		// Both should be accessible
		const client1 = createPublicClient({
			chain: anvil,
			transport: http(instance1.rpcUrl),
		});
		const client2 = createPublicClient({
			chain: anvil,
			transport: http(instance2.rpcUrl),
		});

		const [block1, block2] = await Promise.all([
			client1.getBlockNumber(),
			client2.getBlockNumber(),
		]);

		expect(block1).toBeDefined();
		expect(block2).toBeDefined();

		// Clean up
		await Promise.all([instance1.stop(), instance2.stop()]);
	});

	it("should handle port conflicts gracefully", async () => {
		// Use a random port in a high range to avoid conflicts
		const port = 30000 + Math.floor(Math.random() * 1000);
		const instance1 = await startAnvil({ port });

		// Attempt to start another instance on the same port
		await expect(startAnvil({ port })).rejects.toThrow(
			`Port ${port} is already in use`,
		);

		// Verify the first instance is still working
		const client = createPublicClient({
			chain: anvil,
			transport: http(instance1.rpcUrl),
		});
		const blockNumber = await client.getBlockNumber();
		expect(blockNumber).toBeDefined();

		await instance1.stop();

		// Now we should be able to start on the same port
		const instance2 = await startAnvil({ port });
		expect(instance2.port).toBe(port);
		await instance2.stop();
	});

	it("should respect custom options", async () => {
		const instance = await startAnvil({
			accounts: 5,
			balance: "1000",
		});

		const client = createPublicClient({
			chain: anvil,
			transport: http(instance.rpcUrl),
		});

		// Get test accounts
		const walletClient = createWalletClient({
			chain: anvil,
			transport: http(instance.rpcUrl),
		});
		const accounts = await walletClient.getAddresses();
		expect(accounts.length).toBe(5);

		// Check balance
		const balance = await client.getBalance({ address: accounts[0] });
		expect(balance).toBe(1000n * 10n ** 18n); // 1000 ETH in wei

		await instance.stop();
	});

	it("should handle stop being called multiple times", async () => {
		const instance = await startAnvil();

		await instance.stop();
		// Should not throw on second stop
		await expect(instance.stop()).resolves.not.toThrow();
	});

	it("should clean up process on error during startup", async () => {
		// This test attempts to start Anvil with an invalid argument
		// to ensure cleanup happens on failure
		await expect(
			startAnvil({
				additionalArgs: ["--invalid-flag-that-does-not-exist"],
			}),
		).rejects.toThrow(/Anvil process exited with code/);

		// Wait a bit to ensure any spawned process has time to exit
		await new Promise((resolve) => setTimeout(resolve, 500));

		// Verify no orphaned process by trying to start a new instance
		const instance = await startAnvil();
		expect(instance.port).toBeGreaterThanOrEqual(8545);
		await instance.stop();
	}, 10000); // Increase timeout for this test

	it("should reject privileged ports below 1024", async () => {
		await expect(startAnvil({ port: 80 })).rejects.toThrow(
			/Invalid port number: 80\. Port must be between 1024 and 65535/,
		);
		await expect(startAnvil({ port: 443 })).rejects.toThrow(
			/Invalid port number: 443\. Port must be between 1024 and 65535/,
		);
		await expect(startAnvil({ port: 1023 })).rejects.toThrow(
			/Invalid port number: 1023\. Port must be between 1024 and 65535/,
		);
	});

	it("should reject ports above 65535", async () => {
		await expect(startAnvil({ port: 65536 })).rejects.toThrow(
			/Invalid port number: 65536\. Port must be between 1024 and 65535/,
		);
		await expect(startAnvil({ port: 70000 })).rejects.toThrow(
			/Invalid port number: 70000\. Port must be between 1024 and 65535/,
		);
	});

	it("should accept valid ports between 1024 and 65535", async () => {
		const instance = await startAnvil({ port: 1024 });
		expect(instance.port).toBe(1024);
		await instance.stop();

		const instance2 = await startAnvil({ port: 65535 });
		expect(instance2.port).toBe(65535);
		await instance2.stop();
	});
});
