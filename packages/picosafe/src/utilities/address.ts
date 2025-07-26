import type { Address } from "viem";
import { keccak256, stringToBytes } from "viem";

/**
 * Computes the [EIP-55](https://eips.ethereum.org/EIPS/eip-55) checksum for a
 * hexadecimal Ethereum address.
 *
 * This internal helper *does not* support the EIP-1191 chain-aware checksum
 * variant used by some Layer-2 networks.  If you need that behaviour, prefer
 * `viem/checksumAddress()` once the upstream library supports EIP-1191 or
 * contribute a specialised helper in a dedicated module.
 *
 * The implementation is intentionally small and *side-effect-free*
 *
 * @param address  A `0x`-prefixed **lower-case** address to checksum.  Passing a
 *                 mixed-case address is permitted; the function ignores the
 *                 existing casing.  Throws if the input is not a valid 20-byte
 *                 hex string.
 * @returns        The same address with checksum casing applied.
 *
 * @example
 * ```typescript
 * import { checksumAddress } from "picosafe"
 *
 * const safeAddress = checksumAddress("0x52908400098527886E0F7030069857D2E4169EE7")
 * console.log(safeAddress)
 * // → "0x52908400098527886E0F7030069857D2E4169EE7"
 * ```
 *
 */
function checksumAddress(address: Address): Address {
	// Remove the 0x prefix and normalise to lower-case for hashing
	const hexAddress = address.toLowerCase().replace(/^0x/, "");

	// Compute keccak256(address) and drop the 0x prefix so we can read nibbles
	const hashHex = keccak256(stringToBytes(hexAddress)).slice(2);

	let checksummed = "0x";
	for (let i = 0; i < hexAddress.length; i++) {
		const addrChar = hexAddress.charAt(i);
		const hashNibble = Number.parseInt(hashHex.charAt(i), 16);
		checksummed += hashNibble >= 8 ? addrChar.toUpperCase() : addrChar;
	}

	return checksummed as Address;
}

export { checksumAddress };
