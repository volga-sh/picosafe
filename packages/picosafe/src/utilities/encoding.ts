import { Hex as HexUtils } from "ox";
import type { Hex } from "../types";

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
				const hex = HexUtils.fromNumber(BigInt(arg));
				return HexUtils.padLeft(hex, 32).slice(2).toLowerCase();
			}

			return HexUtils.padLeft(arg as Hex, 32)
				.slice(2)
				.toLowerCase();
		})
		.join("");

	return `${selector}${encodedArgs}` as Hex;
}

export { encodeWithSelector };
