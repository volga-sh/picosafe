import { Address as AddressUtils } from "ox";
import type { Address } from "../types";

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
	return AddressUtils.checksum(address);
}

export { checksumAddress };
