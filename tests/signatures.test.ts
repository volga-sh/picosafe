import { describe, expect, it } from "vitest";
import { encodeSafeSignaturesBytes } from "../src/safe-signatures";
import type { PicosafeSignature } from "../src/types";

describe("encodeSafeSignaturesBytes", () => {
	it("should encode single ECDSA signature", () => {
		const signatures: PicosafeSignature[] = [
			{
				signer: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
				data: `0x${"a".repeat(128)}1b`, // 65 bytes: r(32) + s(32) + v(1)
			},
		];

		const encoded = encodeSafeSignaturesBytes(signatures);
		expect(encoded).toBe(`0x${"a".repeat(128)}1b`);
	});

	it("should sort signatures by signer address", () => {
		const signatures: PicosafeSignature[] = [
			{
				signer: "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
				data: `0x${"b".repeat(128)}1c`,
			},
			{
				signer: "0x0000000000000000000000000000000000000001",
				data: `0x${"a".repeat(128)}1b`,
			},
		];

		const encoded = encodeSafeSignaturesBytes(signatures);
		// Should be sorted with 0x000...001 first, then 0xFFF...FFF
		expect(encoded).toBe(`0x${"a".repeat(128)}1b${"b".repeat(128)}1c`);
	});

	it("should handle dynamic signatures", () => {
		const signatures: PicosafeSignature[] = [
			{
				signer: "0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5",
				data: `0x${"a".repeat(128)}1b`, // Standard ECDSA
			},
			{
				signer: "0x0000000000000000000000000000000000000001",
				data: `0x${"c".repeat(130)}`, // Dynamic signature
				dynamic: true,
			},
		];

		const encoded = encodeSafeSignaturesBytes(signatures);

		// Expected format:
		// 1. Static part for contract signature (sorted first): padded signer (32) + offset (32) + type (1)
		// 2. Static part for ECDSA signature: 65 bytes
		// 3. Dynamic part: length (32) + data

		const expectedStatic =
			"0x" +
			"0000000000000000000000000000000000000001".padStart(64, "0") + // signer
			(65 * 2).toString(16).padStart(64, "0") + // offset = 130 (after 2 signatures of 65 bytes each)
			"00" + // signature type
			"a".repeat(128) +
			"1b"; // ECDSA signature

		const expectedDynamic =
			(130 / 2)
				.toString(16)
				.padStart(64, "0") + // length = 65 bytes
			"c".repeat(130); // data

		expect(encoded).toBe(expectedStatic + expectedDynamic);
	});

	it("should handle empty array", () => {
		const signatures: PicosafeSignature[] = [];
		expect(() => encodeSafeSignaturesBytes(signatures)).toThrow(
			"Cannot encode empty signatures array",
		);
	});

	it("should handle multiple dynamic signatures", () => {
		const signatures: PicosafeSignature[] = [
			{
				signer: "0x0000000000000000000000000000000000000001",
				data: `0x${"a".repeat(200)}`, // 100 bytes
				dynamic: true,
			},
			{
				signer: "0x0000000000000000000000000000000000000002",
				data: `0x${"b".repeat(100)}`, // 50 bytes
				dynamic: true,
			},
		];

		const encoded = encodeSafeSignaturesBytes(signatures);

		// Both are dynamic, so static part has two 65-byte entries
		// First signature offset: 65 * 2 = 130
		// Second signature offset: 130 + 32 (length) + 100 (data) = 262

		const expectedStatic =
			"0x" +
			"0000000000000000000000000000000000000001".padStart(64, "0") +
			(130).toString(16).padStart(64, "0") +
			"00" +
			"0000000000000000000000000000000000000002".padStart(64, "0") +
			(262).toString(16).padStart(64, "0") +
			"00";

		const expectedDynamic =
			(100)
				.toString(16)
				.padStart(64, "0") + // first signature length
			"a".repeat(200) + // first signature data
			(50).toString(16).padStart(64, "0") + // second signature length
			"b".repeat(100); // second signature data

		expect(encoded).toBe(expectedStatic + expectedDynamic);
	});
});
