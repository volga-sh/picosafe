import type { Hex } from "../types";

/**
 * Normalizes a hexadecimal value to a fixed byte length.
 *
 * The returned string **is** prefixed with `0x`, is always lower-case, and
 * is left-padded with zeros until it reaches the requested byte length.
 *
 * @param value - Hex string (with or without `0x` prefix) or {@link Hex} to pad.
 * @param bytes - Target byte length. Defaults to 32 bytes (64 nibbles).
 * @returns The 0x-stripped, lower-cased, left-padded hex string.
 * @throws {Error} If the supplied value exceeds the requested byte length.
 *
 * @example
 * ```ts
 * import { padHex } from "picosafe";
 *
 * // Pad an address (20 bytes) to 32 bytes
 * const padded = padHex(
 *   "0x1234deadbeef1234deadbeef1234deadbeef1234",
 * );
 * // ➜ "0000000000000000000000001234deadbeef1234deadbeef1234deadbeef1234"
 * ```
 *
 * Edge cases:
 * - Accepts both `0x`-prefixed and non-prefixed strings.
 * - Input is case-insensitive; output is always lower-case.
 * - Passing an empty string returns a string of zeros with the requested length.
 */
function padStartHex(value: string | Hex, bytes = 32): Hex {
	const hex = value.startsWith("0x") ? value.slice(2) : value;
	if (hex.length > bytes * 2) {
		throw new Error(
			`Value 0x${hex} exceeds ${bytes}-byte length (${bytes * 2} nibbles)`,
		);
	}
	return `0x${hex.toLowerCase().padStart(bytes * 2, "0")}` as Hex;
}

/**
 * Concatenates a 4-byte function selector with its ABI-encoded arguments.
 *
 * Supported argument types:
 * • `address` / `bytes32` → `Hex` or hex `string` (20 or 32 bytes)
 * • `uint256` → `number` | `bigint`
 *
 * Each argument is encoded into a fixed 32-byte slot following Solidity ABI
 * encoding rules, then appended to the selector.
 *
 * @param selector - 4-byte selector (e.g. `"0x70a08231"`). Must be `0x`-prefixed
 *                   and contain exactly 8 hex characters.
 * @param {...(string|Hex|number|bigint)} args - One or more arguments to encode.
 * @returns Hex string (`0x`-prefixed) containing the selector followed by the
 *          encoded arguments.
 * @throws {Error} If `selector` is not exactly 4 bytes or if any argument exceeds
 *                 32 bytes when encoded.
 *
 * @example
 * ```ts
 * import { encodeWithSelector } from "picosafe";
 *
 * // Enable a Safe module: enableModule(address)
 * const data = encodeWithSelector(
 *   "0x610b5925", // selector for enableModule(address)
 *   "0x1234deadbeef1234deadbeef1234deadbeef1234", // module address
 * );
 * // data => "0x610b5925" + 32-byte-encoded module address
 * ```
 *
 * Edge cases:
 * - Mixing numeric and hex arguments is allowed.
 * - Arguments larger than 32 bytes throw an error.
 * - The selector **must** be lower-case and `0x`-prefixed.
 */
function encodeWithSelector(
	selector: Hex,
	...args: readonly (string | Hex | number | bigint)[]
): Hex {
	if (!selector.startsWith("0x") || selector.length !== 10) {
		throw new Error(
			"Selector must represent exactly 4 bytes (8 hex chars) prefixed with 0x",
		);
	}

	const encodedArgs = args
		.map((arg) => {
			if (typeof arg === "bigint" || typeof arg === "number") {
				const hex = BigInt(arg).toString(16);
				return padStartHex(hex).slice(2);
			}

			return padStartHex(arg).slice(2);
		})
		.join("");

	return `${selector}${encodedArgs}` as Hex;
}

/**
 * Concatenates multiple hex strings into a single hex string, preserving the `0x` prefix.
 *
 * @remarks
 * Each argument must be a valid hex string (with or without `0x` prefix). The result is a single
 * `0x`-prefixed hex string containing the concatenation of all input hex data (without duplicate prefixes).
 *
 * @param parts - One or more hex strings to concatenate. Each may be `0x`-prefixed or not.
 * @returns A single `0x`-prefixed hex string containing the concatenated input.
 * @example
 * ```typescript
 * import { concatHex } from "picosafe";
 *
 * const result = concatHex("0x1234", "abcd", "0x5678");
 * // result === "0x1234abcd5678"
 * ```
 */
function concatHex(...parts: readonly (Hex | string)[]): Hex {
	let out = "0x";
	for (let p of parts) {
		if (p.startsWith("0x")) p = p.slice(2);
		out += p;
	}
	return out as Hex;
}

export { concatHex, padStartHex, encodeWithSelector };
