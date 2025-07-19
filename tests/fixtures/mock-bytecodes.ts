import type { Hex } from "viem";

/**
 * Mock ERC-1271 contract bytecode that always returns the magic value 0x1626ba7e
 * indicating a valid signature. This is used for testing ERC-1271 signature validation.
 *
 * The bytecode does the following:
 * 1. PUSH4 0x1626ba7e - Push the ERC-1271 magic value (4 bytes)
 * 2. PUSH1 0xe0 - Push 224 (shift amount in bits)
 * 3. SHL - Shift left by 224 bits to move magic value to high 4 bytes
 * 4. PUSH0 - Push 0 (memory offset)
 * 5. MSTORE - Store the value at memory position 0
 * 6. PUSH1 0x20 - Push 32 (return data size)
 * 7. PUSH0 - Push 0 (return data offset)
 * 8. RETURN - Return 32 bytes from memory position 0
 *
 * @returns Bytecode that always returns ERC-1271 magic value for valid signature
 * @example
 * ```typescript
 * import { getMockERC1271ValidBytecode } from "./mock-bytecodes"
 * import { type Address, deployContract } from "viem"
 *
 * // Deploy a mock contract that always returns valid signature
 * const mockContract = await deployContract({
 *   abi: [],
 *   bytecode: getMockERC1271ValidBytecode(),
 *   client: walletClient,
 * })
 * ```
 */
function getMockERC1271ValidBytecode(): Hex {
	return "0x631626ba7e60e01b5f5260205ff3";
}

/**
 * Mock ERC-1271 contract bytecode that always returns an invalid magic value 0xc0ffee00.
 * This is used for testing invalid ERC-1271 signature validation.
 *
 * The bytecode does the following:
 * 1. PUSH4 0xc0ffee00 - Push a custom invalid value (4 bytes)
 * 2. PUSH1 0xe0 - Push 224 (shift amount in bits)
 * 3. SHL - Shift left by 224 bits to move value to high 4 bytes
 * 4. PUSH0 - Push 0 (memory offset)
 * 5. MSTORE - Store the value at memory position 0
 * 6. PUSH1 0x20 - Push 32 (return data size)
 * 7. PUSH0 - Push 0 (return data offset)
 * 8. RETURN - Return 32 bytes from memory position 0
 *
 * @returns Bytecode that always returns invalid magic value
 * @example
 * ```typescript
 * import { getMockERC1271InvalidBytecode } from "./mock-bytecodes"
 * import { type Address, deployContract } from "viem"
 *
 * // Deploy a mock contract that always returns invalid signature
 * const mockContract = await deployContract({
 *   abi: [],
 *   bytecode: getMockERC1271InvalidBytecode(),
 *   client: walletClient,
 * })
 * ```
 */
function getMockERC1271InvalidBytecode(): Hex {
	return "0x63c0ffee0060e01b5f5260205ff3";
}

/**
 * Mock ERC-1271 contract bytecode that always returns the legacy magic value 0x20c13b0b.
 * This is the magic value that Safe contracts expect for valid signatures.
 *
 * The bytecode does the following:
 * 1. PUSH4 0x20c13b0b - Push the legacy ERC-1271 magic value (4 bytes)
 * 2. PUSH1 0xe0 - Push 224 (shift amount in bits)
 * 3. SHL - Shift left by 224 bits to move magic value to high 4 bytes
 * 4. PUSH0 - Push 0 (memory offset)
 * 5. MSTORE - Store the value at memory position 0
 * 6. PUSH1 0x20 - Push 32 (return data size)
 * 7. PUSH0 - Push 0 (return data offset)
 * 8. RETURN - Return 32 bytes from memory position 0
 *
 * @returns Bytecode that always returns Safe's expected ERC-1271 magic value
 * @example
 * ```typescript
 * import { getMockERC1271LegacyValidBytecode } from "./mock-bytecodes"
 * import { type Address, deployContract } from "viem"
 *
 * // Deploy a mock contract that returns Safe's expected ERC-1271 magic value
 * const mockContract = await deployContract({
 *   abi: [],
 *   bytecode: getMockERC1271LegacyValidBytecode(),
 *   client: walletClient,
 * })
 * ```
 */
function getMockERC1271LegacyValidBytecode(): Hex {
	return "0x6320c13b0b60e01b5f5260205ff3";
}

// Export statements at the bottom of the file
export {
	getMockERC1271ValidBytecode,
	getMockERC1271InvalidBytecode,
	getMockERC1271LegacyValidBytecode,
};
