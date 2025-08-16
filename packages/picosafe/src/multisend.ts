import { Abi, AbiFunction, Bytes, Hex as HexUtils } from "ox";
import type { Hex } from "./ox-types";
import type { MetaTransaction } from "./types";
import { Operation } from "./types";

const MULTISEND_ABI = Abi.from([
	"function multiSend(bytes transactions) payable",
]);

/**
 * Encodes multiple transactions for atomic execution by the MultiSend contract.
 *
 * Packs multiple transactions into a single bytes payload following the MultiSend
 * contract format. Each transaction is encoded as: operation (1 byte) + to (20 bytes) +
 * value (32 bytes) + data length (32 bytes) + data (variable).
 *
 * The resulting payload can be used with MultiSend.multiSend() to execute all
 * transactions atomically - either all succeed or all fail.
 *
 * @param transactions - Array of meta-transactions to batch together
 * @param transactions[].to - Target address for the transaction
 * @param transactions[].value - ETH value to send in wei
 * @param transactions[].data - Encoded call data for the transaction
 * @param transactions[].UNSAFE_DELEGATE_CALL - Optional flag to execute as delegate call (defaults to false)
 * @returns Hex-encoded packed transactions ready for MultiSend.multiSend()
 * @example
 * ```typescript
 * import { encodeMultiSend } from 'picosafe';
 * import { encodeFunctionData } from 'viem';
 *
 * // Batch ETH transfers
 * const encoded = encodeMultiSend([
 *   {
 *     to: '0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5',
 *     value: 1000000000000000000n, // 1 ETH
 *     data: '0x'
 *   },
 *   {
 *     to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
 *     value: 2000000000000000000n, // 2 ETH
 *     data: '0x'
 *   }
 * ]);
 *
 * // Use with buildSafeTransaction to execute via Safe
 * const safeTx = await buildSafeTransaction(provider, safeAddress, [{
 *   to: '0x998739BFdAAdde7C933B942a68053933098f9EDa', // MultiSendCallOnly address
 *   data: encodeFunctionData({
 *     abi: multiSendAbi,
 *     functionName: 'multiSend',
 *     args: [encoded]
 *   }),
 *   value: 0n
 * }]);
 * ```
 * @example
 * ```typescript
 * import { encodeMultiSend } from 'picosafe';
 * import { encodeFunctionData, parseAbi } from 'viem';
 *
 * // Approve and swap tokens in one transaction
 * const tokenAbi = parseAbi(['function approve(address,uint256)']);
 * const dexAbi = parseAbi(['function swap(address,address,uint256)']);
 *
 * const encoded = encodeMultiSend([
 *   {
 *     to: tokenAddress,
 *     value: 0n,
 *     data: encodeFunctionData({
 *       abi: tokenAbi,
 *       functionName: 'approve',
 *       args: [spender, amount]
 *     })
 *   },
 *   {
 *     to: dexAddress,
 *     value: 0n,
 *     data: encodeFunctionData({
 *       abi: dexAbi,
 *       functionName: 'swap',
 *       args: [tokenIn, tokenOut, amount]
 *     })
 *   }
 * ]);
 * ```
 */
function encodeMultiSendCall(
	transactions: readonly (MetaTransaction & {
		UNSAFE_DELEGATE_CALL?: boolean;
	})[],
): Hex {
	if (transactions.length === 0) {
		throw new Error("No transactions provided for MultiSend encoding");
	}

	let packed = "0x";

	// MultiSend expects a packed concatenation of its transaction fields without
	// the array length prefix, dynamic offsets, or 32-byte padding that standard
	// ABI encoding would add. Therefore we manually build the bytes sequence below
	// instead of using high-level Abi helpers.
	for (const tx of transactions) {
		const encoded = Bytes.fromArray([
			...Bytes.from(
				Bytes.fromNumber(
					tx.UNSAFE_DELEGATE_CALL
						? Operation.UNSAFE_DELEGATECALL
						: Operation.Call,
					{
						size: 1,
					},
				),
			),
			...Bytes.from(tx.to),
			...Bytes.from(Bytes.fromNumber(tx.value, { size: 32 })),
			...Bytes.from(
				Bytes.fromNumber(BigInt(tx.data.length / 2 - 1), { size: 32 }),
			),
			...Bytes.from(tx.data),
		]);
		packed += HexUtils.fromBytes(encoded).slice(2);
	}

	const multiSendFn = AbiFunction.fromAbi(MULTISEND_ABI, "multiSend");
	return AbiFunction.encodeData(multiSendFn, [packed as Hex]);
}

export { MULTISEND_ABI, encodeMultiSendCall };
