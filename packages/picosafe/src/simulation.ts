import { AbiFunction } from "ox";
import type { Hex } from "./ox-types";
import { V141_ADDRESSES } from "./safe-contracts";
import { encodeSafeSignaturesBytes } from "./safe-signatures";
import type {
	EIP1193ProviderWithRequestFn,
	FullSafeTransaction,
	PicosafeSignature,
} from "./types";

// Canonical ABI for SimulateTxAccessor revert payload
const SIM_RESULT_ABI = AbiFunction.from(
	"function result(uint256 estimate, bool success, bytes returnData) returns (uint256, bool, bytes)",
);

/**
 * Result of a Safe transaction simulation.
 */
type SimulationResult = {
	/** Whether the transaction would succeed */
	success: boolean;
	/** Estimated gas used for the transaction (only available when no signatures provided) */
	gasUsed?: bigint;
	/** Return data from the transaction */
	returnData?: Hex;
	/** Error message if simulation failed */
	error?: string;
};

/**
 * Simulates Safe transaction execution without sending it to the blockchain.
 *
 * This function allows testing whether a transaction would succeed before actually executing it.
 * It supports two simulation modes:
 *
 * 1. **Without signatures**: Uses the SimulateTxAccessor contract via `simulateAndRevert` to estimate
 *    gas usage and predict transaction outcome. This is useful for testing transaction data before
 *    collecting signatures.
 *
 * 2. **With signatures**: Uses `eth_call` to simulate the complete `execTransaction` call including
 *    signature validation. This is useful for validating that a fully-signed transaction will succeed.
 *
 * @param provider - The EIP-1193 compatible provider for blockchain interactions
 * @param transaction - The Safe transaction to simulate
 * @param signatures - Optional array of signatures. If provided, simulates full execution with signature validation.
 * @returns Promise resolving to simulation result with success status, optional gas estimate, return data, and error message
 *
 * @example
 * ```typescript
 * import { simulateSafeTransaction, buildSafeTransaction } from 'picosafe';
 * import { createPublicClient, http } from 'viem';
 * import { mainnet } from 'viem/chains';
 *
 * const publicClient = createPublicClient({
 *   chain: mainnet,
 *   transport: http(),
 * });
 *
 * // Build a transaction to simulate
 * const tx = await buildSafeTransaction(
 *   publicClient,
 *   '0xSafeAddress',
 *   [{
 *     to: '0xRecipient',
 *     value: 1000000000000000000n, // 1 ETH
 *     data: '0x'
 *   }]
 * );
 *
 * // Simulate without signatures to check if transaction would succeed
 * const result = await simulateSafeTransaction(publicClient, tx);
 *
 * if (result.success) {
 *   console.log(`Transaction will succeed, estimated gas: ${result.gasUsed}`);
 * } else {
 *   console.error(`Transaction will fail: ${result.error}`);
 * }
 * ```
 *
 * @example
 * ```typescript
 * import { simulateSafeTransaction, buildSafeTransaction, signSafeTransaction } from 'picosafe';
 * import { createWalletClient, http } from 'viem';
 * import { mainnet } from 'viem/chains';
 *
 * const walletClient = createWalletClient({
 *   chain: mainnet,
 *   transport: http(),
 * });
 *
 * // Build and sign a transaction
 * const tx = await buildSafeTransaction(walletClient, safeAddress, [...]);
 * const signature1 = await signSafeTransaction(walletClient, tx, owner1Address);
 * const signature2 = await signSafeTransaction(walletClient, tx, owner2Address);
 *
 * // Simulate with signatures to validate complete execution
 * const result = await simulateSafeTransaction(walletClient, tx, [signature1, signature2]);
 *
 * if (result.success) {
 *   console.log('Transaction will succeed with provided signatures');
 *   // Safe to execute
 * } else {
 *   console.error('Transaction will fail:', result.error);
 * }
 * ```
 *
 * @throws {Error} If the provider call fails (e.g., network/provider error) or
 *                 if the simulation revert payload cannot be decoded into the
 *                 expected (estimate, success, returnData) tuple.
 *
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/accessors/SimulateTxAccessor.sol
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/common/StorageAccessible.sol
 */
async function simulateSafeTransaction(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	transaction: Readonly<FullSafeTransaction>,
	signatures?: readonly PicosafeSignature[],
): Promise<SimulationResult> {
	if (signatures && signatures.length > 0) {
		return simulateWithSignatures(provider, transaction, signatures);
	}

	// Simulate without signatures using SimulateTxAccessor
	return simulateWithAccessor(provider, transaction);
}

/**
 * Simulates transaction execution with signatures using eth_call.
 * This validates both the transaction logic and signature verification.
 */
async function simulateWithSignatures(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	transaction: Readonly<FullSafeTransaction>,
	signatures: readonly PicosafeSignature[],
): Promise<SimulationResult> {
	try {
		// Encode execTransaction call
		const encodedSignatures = encodeSafeSignaturesBytes(signatures);

		// Build the execTransaction call data
		const execTransactionAbi = AbiFunction.from(
			"function execTransaction(address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes memory signatures) public payable returns (bool success)",
		);
		const execTransactionData = AbiFunction.encodeData(execTransactionAbi, [
			transaction.to,
			transaction.value,
			transaction.data,
			transaction.operation,
			transaction.safeTxGas,
			transaction.baseGas,
			transaction.gasPrice,
			transaction.gasToken,
			transaction.refundReceiver,
			encodedSignatures,
		]);

		// Use eth_call to simulate the transaction
		const result = (await provider.request({
			method: "eth_call",
			params: [
				{
					to: transaction.safeAddress,
					data: execTransactionData,
				},
				"latest",
			],
		})) as Hex;

		// execTransaction returns a bool, encoded as 32 bytes
		// true = 0x0000...0001, false = 0x0000...0000
		const success = result !== "0x" && BigInt(result) !== 0n;

		return {
			success,
			returnData: result,
		};
	} catch (error) {
		// eth_call reverts on failure - extract error message
		return {
			success: false,
			error:
				error instanceof Error ? error.message : "Simulation failed with error",
		};
	}
}

/**
 * Simulates transaction execution without signatures using SimulateTxAccessor.
 * This estimates gas and checks if the transaction would succeed, without validating signatures.
 */
async function simulateWithAccessor(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	transaction: Readonly<FullSafeTransaction>,
): Promise<SimulationResult> {
	try {
		// Build the simulate call to SimulateTxAccessor
		// Function signature: simulate(address to, uint256 value, bytes calldata data, Enum.Operation operation)
		const simulateFunctionAbi = AbiFunction.from(
			"function simulate(address to, uint256 value, bytes calldata data, uint8 operation) external returns (uint256 estimate, bool success, bytes memory returnData)",
		);

		const simulateCallData = AbiFunction.encodeData(simulateFunctionAbi, [
			transaction.to,
			transaction.value,
			transaction.data,
			transaction.operation,
		]);

		// Use simulateAndRevert from StorageAccessible to call SimulateTxAccessor via delegatecall
		// Function signature: simulateAndRevert(address targetContract, bytes calldataPayload)
		const simulateAndRevertAbi = AbiFunction.from(
			"function simulateAndRevert(address targetContract, bytes calldataPayload)",
		);
		const simulateAndRevertData = AbiFunction.encodeData(simulateAndRevertAbi, [
			V141_ADDRESSES.SimulateTxAccessor,
			simulateCallData,
		]);

		await provider.request({
			method: "eth_call",
			params: [
				{
					from: transaction.safeAddress, // call from Safe so delegatecall-access checks inside accessor pass
					to: transaction.safeAddress,
					data: simulateAndRevertData,
				},
				"latest",
			],
		});

		// If we reach here, something unexpected happened
		return {
			success: false,
			error: "Simulation did not revert as expected",
		};
	} catch (error) {
		// The call should revert with the simulation result encoded as the canonical tuple
		const revertData = extractRevertData(error);
		if (!revertData) {
			return { success: false, error: "Failed to extract simulation result" };
		}
		try {
			const decoded = decodeSimulateAccessorReturn(revertData);
			if (!decoded) throw new Error("decode failed");
			return {
				success: decoded.success,
				gasUsed: decoded.estimate,
				returnData: decoded.returnData,
			};
		} catch {
			return { success: false, error: "Failed to decode simulation result" };
		}
	}
}

/**
 * Extracts revert data from an error object or message.
 * Handles various error formats from different providers.
 */
function extractRevertData(error: unknown): Hex | null {
	if (!error) return null;

	// Check if error has data property (common in provider errors)
	if (
		typeof error === "object" &&
		error !== null &&
		"data" in error &&
		typeof (error as { data?: unknown }).data === "string"
	) {
		return (error as { data: string }).data as Hex;
	}

	// Check error message for hex data
	if (error instanceof Error) {
		const hexMatch = error.message.match(/0x[0-9a-fA-F]+/);
		if (hexMatch) {
			return hexMatch[0] as Hex;
		}
	}

	return null;
}

export { simulateSafeTransaction };
export type { SimulationResult };

/**
 * Decodes the ABI-encoded tuple (uint256 estimate, bool success, bytes returnData)
 * produced by SimulateTxAccessor via StorageAccessible.simulateAndRevert.
 *
 * Minimalism with robustness:
 * - First we decode using the canonical tuple ABI at offset 0 (the only ABI we care about).
 * - Some providers wrap the revert payload (e.g., Anvil surfaces a custom error envelope),
 *   which shifts the tuple away from offset 0. To remain simple and robust without
 *   maintaining wrapper ABIs, we include a tiny fallback that scans for the tuple head
 *   (estimate, success, 0x60) and decodes the tail.
 *
 * References:
 * - SimulateTxAccessor.sol
 *   https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/accessors/SimulateTxAccessor.sol
 * - SimulateTxAccessor.spec.ts
 *   https://github.com/safe-global/safe-smart-account/blob/main/test/accessors/SimulateTxAccessor.spec.ts
 */
function decodeSimulateAccessorReturn(
	data: Hex,
): { estimate: bigint; success: boolean; returnData: Hex } | null {
	const payload = data.startsWith("0x") ? data : (`0x${data}` as Hex);

	try {
		const [estimate, success, ret] = AbiFunction.decodeResult(
			SIM_RESULT_ABI,
			payload,
		);
		return {
			estimate: estimate as bigint,
			success: success as boolean,
			returnData: ret as Hex,
		};
	} catch {}

	// Minimal fallback: scan for (estimate, success, 0x60) head and decode tail
	const hex = payload.slice(2);
	const totalWords = Math.floor(hex.length / 64);
	for (let base = 0; base + 3 <= totalWords; base++) {
		const readWord = (i: number): bigint => {
			const s = i * 64;
			const slice = hex.slice(s, s + 64);
			if (slice.length !== 64) return 0n;
			return BigInt(`0x${slice}`);
		};
		const estimate = readWord(base + 0);
		const successWord = readWord(base + 1);
		const offsetBytes = readWord(base + 2);
		if (offsetBytes !== 0x60n) continue;
		const tailStart = (base + 3) * 64 + Number(offsetBytes) * 2 - 0x60 * 2;
		if (tailStart < 0 || hex.length < tailStart + 64) continue;
		const lenSlice = hex.slice(tailStart, tailStart + 64);
		const length = Number(BigInt(`0x${lenSlice}`));
		const dataStart = tailStart + 64;
		const dataEnd = dataStart + length * 2;
		if (!Number.isFinite(length) || length < 0 || hex.length < dataEnd)
			continue;
		const returnData = `0x${hex.slice(dataStart, dataEnd)}` as Hex;
		return { estimate, success: successWord !== 0n, returnData };
	}

	return null;
}
