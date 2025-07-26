import crypto from "node:crypto";
import type { Address, Hex } from "viem";
import { checksumAddress } from "../src/utilities/address";

/**
 * Generates a cryptographically secure random byte array of the specified size.
 *
 * @param size - The number of random bytes to generate
 * @returns A Uint8Array containing random bytes
 *
 * @example
 * const bytes = randomBytes(16); // Uint8Array(16) [...]
 */
function randomBytes(size: number): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(size));
}

/**
 * Converts a Uint8Array to a hexadecimal string with 0x prefix.
 *
 * @param arr - The Uint8Array to convert
 * @returns Hex string representation of the input array
 *
 * @example
 * const hex = uint8ArrayToHex(new Uint8Array([1, 2, 3])); // "0x010203"
 */
function uint8ArrayToHex(arr: Uint8Array): Hex {
	return `0x${Array.from(arr)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")}`;
}

/**
 * Generates a cryptographically secure random hex string of the specified byte length.
 *
 * @param size - The number of random bytes to generate (each byte = 2 hex chars)
 * @returns Hex string of the generated random bytes
 *
 * @example
 * const hex = randomBytesHex(8); // e.g., "0x1a2b3c4d5e6f7a8b"
 */
function randomBytesHex(size: number): Hex {
	const bytes = randomBytes(size);

	return uint8ArrayToHex(bytes);
}

/**
 * Generates a random Ethereum address from a cryptographically secure random byte array.
 *
 * @returns A random Ethereum address
 *
 * @example
 * const address = randomAddress();
 */
function randomAddress(): Address {
	return checksumAddress(randomBytesHex(20));
}

/**
 * Picks a random element from an array.
 *
 * @param array - The array to pick from
 * @returns A random element from the array
 */
function pickRandom<T>(array: T[]): T {
	return array[Math.floor(Math.random() * array.length)] as T;
}

export { randomBytes, randomBytesHex, pickRandom, randomAddress };
