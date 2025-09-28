import { Hash, Hex as HexUtils } from "ox";
import type { Address, Hex } from "./ox-types";

/**
 * Defines the well-known storage slot addresses used by Safe contracts.
 * These slots are used to store critical Safe configuration parameters like owners, threshold, nonce, and module/guard addresses.
 * The values are represented as 32-byte hexadecimal strings, padded with leading zeros to match the EVM storage slot size.
 * For mapping storage slots (e.g., `modulesMapping`, `ownersMapping`, `signedMessagesMapping`, `approvedHashesMapping`), the final storage slot is computed as `keccak256(abi.encodePacked(mapping_key, mapping_position))`, where `mapping_key` is the key used in the mapping and `mapping_position` is the base slot for that mapping.
 *
 * @property singleton - Storage slot for the Safe singleton (implementation) address (slot 0).
 * @property modulesMapping - Storage slot for the modules mapping (slot 1).
 * @property ownersMapping - Storage slot for the owners mapping (slot 2).
 * @property ownerCount - Storage slot for the owner count (slot 3).
 * @property threshold - Storage slot for the signature threshold (slot 4).
 * @property nonce - Storage slot for the transaction nonce (slot 5).
 * @property deprecatedDomainSeparator - Deprecated storage slot for the EIP-712 domain separator (slot 6).
 * @property signedMessagesMapping - Storage slot for the signed messages mapping (slot 7).
 * @property approvedHashesMapping - Storage slot for the approved hashes mapping (slot 8).
 * @property fallbackHandler - Storage slot for the custom fallback handler address (keccak256("fallback_manager.handler.address")).
 * @property guard - Storage slot for the custom guard address (keccak256("guard_manager.guard.address")).
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.5.0/contracts/libraries/SafeStorage.sol
 */
const SAFE_STORAGE_SLOTS = {
	singleton: HexUtils.padLeft("0x0", 32),
	modulesMapping: HexUtils.padLeft("0x1", 32),
	ownersMapping: HexUtils.padLeft("0x2", 32),
	ownerCount: HexUtils.padLeft("0x3", 32),
	threshold: HexUtils.padLeft("0x4", 32),
	nonce: HexUtils.padLeft("0x5", 32),
	deprecatedDomainSeparator: HexUtils.padLeft("0x6", 32),
	signedMessagesMapping: HexUtils.padLeft("0x7", 32),
	approvedHashesMapping: HexUtils.padLeft("0x8", 32),
	// keccak256("fallback_manager.handler.address")
	fallbackHandler:
		"0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5",
	// keccak256("guard_manager.guard.address")
	guard: "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8",
} as const;

/**
 * Computes the storage slot for a mapping(address => address) entry in Solidity contracts.
 * This is a generic helper that calculates where Solidity stores mapping values.
 *
 * Solidity stores a mapping value at `keccak256(key . slot)` where both
 * components are tightly packed and 32-byte padded.
 *
 * @param key - Address that acts as the mapping key
 * @param mappingSlot - The base storage slot where the mapping is stored
 * @returns 32-byte hex string representing the calculated storage slot
 * @example
 * ```typescript
 * import { computeMappingStorageSlot } from "picosafe/storage";
 *
 * // Calculate slot for owners[0x1234...]
 * const ownerKey = "0x1234567890123456789012345678901234567890";
 * const slot = computeMappingStorageSlot(ownerKey, "0x2");
 * ```
 * @see https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html#mappings-and-dynamic-arrays
 */
function computeMappingStorageSlot(key: Address, mappingSlot: Hex): Hex {
	// Pad address and slot to 32 bytes each then hash the concatenation
	// This follows Solidity's storage slot calculation for mappings: keccak256(key + slot)
	return Hash.keccak256(
		HexUtils.concat(
			HexUtils.padLeft(key, 32),
			HexUtils.padLeft(mappingSlot, 32),
		),
	);
}

/**
 * Computes the storage slot for a specific owner address in the Safe's owners mapping.
 * The owners mapping is stored at storage slot 2 in Safe contracts and uses a linked-list structure
 * where each owner points to the next owner in the sequence.
 *
 * @param ownerAddress - Address that acts as the mapping key (owner address or SENTINEL_NODE)
 * @returns 32-byte hex string representing the calculated storage slot for owners[ownerAddress]
 * @example
 * ```typescript
 * import { computeOwnersMappingSlot, SENTINEL_NODE } from "picosafe";
 *
 * // Get storage slot for the sentinel node (points to first owner)
 * const sentinelSlot = computeOwnersMappingSlot(SENTINEL_NODE);
 *
 * // Get storage slot for a specific owner
 * const ownerSlot = computeOwnersMappingSlot("0x1234567890123456789012345678901234567890");
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.5.0/contracts/libraries/SafeStorage.sol
 */
function computeOwnersMappingSlot(ownerAddress: Address): Hex {
	return computeMappingStorageSlot(
		ownerAddress,
		SAFE_STORAGE_SLOTS.ownersMapping,
	);
}

/**
 * Computes the storage slot for a mapping(address => address) entry used by the
 * Safe contracts for module linked-list management. The mapping itself is
 * located at storage slot `1` (see {@link SAFE_STORAGE_SLOTS.modulesMapping}).
 *
 * Solidity stores a mapping value at `keccak256(key . slot)` where both
 * components are tightly packed and 32-byte padded. This helper produces that
 * location so we can use Anvil's `setStorageAt` to simulate enabled modules
 * without executing on-chain Safe transactions (which would otherwise require
 * signatures & execution).
 *
 * @param moduleAddress - Address that acts as the mapping key (either `SENTINEL_NODE` or a module address)
 * @returns 32-byte hex string representing the calculated storage slot
 * @example
 * ```typescript
 * import { computeModulesMappingSlot } from "picosafe";
 *
 * const moduleAddress = "0x0000000000000000000000000000000000000001";
 * const slot = computeModulesMappingSlot(moduleAddress);
 * console.log(slot); // 0xcc69885fda6bcc1a4ace058b4a62bf5e179ea78fd58a1ccd71c22cc9b688792f
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.5.0/contracts/libraries/SafeStorage.sol
 */
function computeModulesMappingSlot(moduleAddress: Address): Hex {
	return computeMappingStorageSlot(
		moduleAddress,
		SAFE_STORAGE_SLOTS.modulesMapping,
	);
}

export {
	SAFE_STORAGE_SLOTS,
	computeMappingStorageSlot,
	computeOwnersMappingSlot,
	computeModulesMappingSlot,
};
