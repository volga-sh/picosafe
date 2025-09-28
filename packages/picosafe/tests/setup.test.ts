import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { V150_ADDRESSES } from "../src/safe-contracts";
import { createClients, snapshot } from "./fixtures/setup";

describe("Test Environment Setup", () => {
	const clients = createClients();
	const { testClient, publicClient } = clients;

	let resetSnapshot: () => Promise<void>;

	beforeEach(async () => {
		resetSnapshot = await snapshot(testClient);
	});

	afterEach(async () => {
		await resetSnapshot();
	});

	it("should connect to Anvil test network", async () => {
		const chainId = await publicClient.getChainId();
		expect(chainId).toBe(31337);
	});

	it("should have test accounts funded", async () => {
		const balance = await publicClient.getBalance({
			address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
		});
		expect(balance).toBeGreaterThan(0n);
	});

	it("should be able to mine blocks", async () => {
		const blockNumber = await publicClient.getBlockNumber();
		await testClient.mine({ blocks: 1 });
		const newBlockNumber = await publicClient.getBlockNumber();
		expect(newBlockNumber).toBe(blockNumber + 1n);
	});

	it("should be able to take and revert snapshots", async () => {
		const blockNumber = await publicClient.getBlockNumber();

		const snapshotId = await testClient.snapshot();

		await testClient.mine({ blocks: 5 });
		const afterMining = await publicClient.getBlockNumber();
		expect(afterMining).toBe(blockNumber + 5n);

		await testClient.revert({ id: snapshotId });
		const afterRevert = await publicClient.getBlockNumber();
		expect(afterRevert).toBe(blockNumber);
	});

	it("should verify that the Safe contracts are available", async () => {
		for (const contract of Object.values(V150_ADDRESSES)) {
			const code = await publicClient.getCode({
				address: contract,
			});

			expect(code).not.toBe("0x");
		}
	});
});
