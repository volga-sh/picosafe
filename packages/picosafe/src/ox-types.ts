/**
 * Extracted type definitions from Ox library namespaces.
 * This file centralizes the type extraction from Ox's namespace exports
 * to provide clean type imports throughout the codebase.
 */

import type { Address as OxAddress, Hex as OxHex } from "ox";

/**
 * Ethereum address type (checksummed hex string)
 * @example "0x742d35Cc6634C0532925a3b844Bc9e7595f6E123"
 */
export type Address = OxAddress.Address;

/**
 * Hex string type (0x-prefixed)
 * @example "0xdeadbeef"
 */
export type Hex = OxHex.Hex;