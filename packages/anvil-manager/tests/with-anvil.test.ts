import { describe, expect, it } from "vitest";
import { withAnvil } from "../src/with-anvil.js";
import { createPublicClient, createWalletClient, http } from "viem";
import { anvil } from "viem/chains";

describe("withAnvil", () => {
	it("should provide a working Anvil instance to the callback", async () => {
		const result = await withAnvil(async (instance) => {
			expect(instance.rpcUrl).toBeDefined();
			expect(instance.port).toBeDefined();

			const client = createPublicClient({
				chain: anvil,
				transport: http(instance.rpcUrl),
			});

			const blockNumber = await client.getBlockNumber();
			return blockNumber;
		});

		expect(result).toBeDefined();
		expect(typeof result).toBe("bigint");
	});

	it("should clean up even if the callback throws", async () => {
		const port = 8554;
		let instanceRpcUrl: string;

		await expect(
			withAnvil(async (instance) => {
				instanceRpcUrl = instance.rpcUrl;
				throw new Error("Test error");
			}, { port }),
		).rejects.toThrow("Test error");

		// Verify the instance was cleaned up by trying to connect
		const client = createPublicClient({
			chain: anvil,
			transport: http(instanceRpcUrl!),
		});

		await expect(client.getBlockNumber()).rejects.toThrow();
	});

	it("should pass through options correctly", async () => {
		await withAnvil(
			async (instance) => {
				expect(instance.port).toBe(8555);

				const client = createPublicClient({
					chain: anvil,
					transport: http(instance.rpcUrl),
				});

				const walletClient = createWalletClient({
					chain: anvil,
					transport: http(instance.rpcUrl),
				});
				const accounts = await walletClient.getAddresses();
				expect(accounts.length).toBe(3);
			},
			{
				port: 8555,
				accounts: 3,
			},
		);
	});

	it("should return the callback result", async () => {
		const result = await withAnvil(async (instance) => {
			const client = createPublicClient({
				chain: anvil,
				transport: http(instance.rpcUrl),
			});

			const walletClient = createWalletClient({
				chain: anvil,
				transport: http(instance.rpcUrl),
			});
			const accounts = await walletClient.getAddresses();
			return {
				accountCount: accounts.length,
				firstAccount: accounts[0],
			};
		});

		expect(result.accountCount).toBe(10); // default
		expect(result.firstAccount).toMatch(/^0x[a-fA-F0-9]{40}$/);
	});
});