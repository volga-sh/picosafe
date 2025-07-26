import { encodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { UNSAFE_getSetFallbackHandlerTransaction } from "../src/fallback-handler";
import { Operation } from "../src/types";
import { ZERO_ADDRESS } from "../src/utilities/constants";
import { createClients } from "./fixtures/setup";
import { randomAddress } from "./utils";

const FALLBACK_HANDLER_ABI = parseAbi([
	"function setFallbackHandler(address handler)",
]);

describe("UNSAFE_getSetFallbackHandlerTransaction", () => {
	const { publicClient } = createClients();

	it("should build correct Safe transaction for setting a fallback handler", async () => {
		const safeAddress = randomAddress();
		const handlerAddress = randomAddress();

		const tx = await UNSAFE_getSetFallbackHandlerTransaction(
			publicClient,
			safeAddress,
			handlerAddress,
			{ nonce: 0n },
		);

		expect(tx.safeAddress).toBe(safeAddress);
		expect(tx.to).toBe(safeAddress);
		expect(tx.value).toBe(0n);
		expect(tx.operation).toBe(Operation.Call);
		expect(tx.gasToken).toBe(ZERO_ADDRESS);
		expect(tx.refundReceiver).toBe(ZERO_ADDRESS);
		expect(tx.gasPrice).toBe(0n);
		expect(tx.baseGas).toBe(0n);
		expect(tx.safeTxGas).toBe(0n);

		const expectedData = encodeFunctionData({
			abi: FALLBACK_HANDLER_ABI,
			functionName: "setFallbackHandler",
			args: [handlerAddress],
		});

		expect(tx.data).toBe(expectedData);
	});

	it("should handle invalid Safe addresses for setFallbackHandler transactions", async () => {
		const invalidSafeAddress = "0x0000000000000000000000000000000000000000";
		const handlerAddress = randomAddress();

		await expect(
			UNSAFE_getSetFallbackHandlerTransaction(
				publicClient,
				invalidSafeAddress,
				handlerAddress,
			),
		).rejects.toThrow();
	});
});
