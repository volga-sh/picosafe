import { AbiFunction, Address as OxAddress } from "ox";
import { PARSED_SAFE_ABI } from "./abis.js";
import { getNonce } from "./account-state.js";
import { getSafeEip712Domain, SAFE_TX_EIP712_TYPES } from "./eip712.js";
import { encodeMultiSendCall } from "./multisend.js";
import type { Address, Hex } from "./ox-types";
import { V141_ADDRESSES } from "./safe-contracts.js";
import { encodeSafeSignaturesBytes } from "./safe-signatures.js";
import type {
	ECDSASignature,
	EIP1193ProviderWithRequestFn,
	FullSafeTransaction,
	MetaTransaction,
	PicosafeSignature,
} from "./types";
import { Operation } from "./types.js";
import { EMPTY_BYTES, ZERO_ADDRESS } from "./utilities/constants.js";
import { getAccounts, getChainId } from "./utilities/eip1193-provider.js";
import type { WrappedTransaction } from "./utilities/wrapEthereumTransaction.js";
import { wrapEthereumTransaction } from "./utilities/wrapEthereumTransaction.js";

type BuiltSafeTransactionMetaTx = Pick<MetaTransaction, "to"> &
	Partial<Omit<MetaTransaction, "to">>;

type BuildSafeTransactionOptions = Partial<{
	UNSAFE_DELEGATE_CALL: boolean;
	baseGas: bigint;
	safeTxGas: bigint;
	gasPrice: bigint;
	gasToken: Address;
	refundReceiver: Address;
	nonce: bigint;
	chainId: bigint;
}>;

type SecureSafeTransactionOptions = Omit<
	BuildSafeTransactionOptions,
	"UNSAFE_DELEGATE_CALL"
>;

/**
 * Builds a complete unsigned Safe transaction object from one or more meta-transactions by filling in
 * missing fields with sensible defaults and chain-specific values. When multiple
 * transactions are provided, they are automatically batched using MultiSend.
 *
 * Important: When batching multiple transactions, the Safe executes MultiSend via delegatecall.
 * This means MultiSend runs in the Safe's context and has direct access to the Safe's state.
 *
 * @param provider - EIP-1193 compatible provider for blockchain interaction
 * @param safeAddress - The address of the Safe contract that will execute the transaction
 * @param transactions - Array of meta-transactions.  Each object **must** contain a `to` address and may optionally include `value` (defaults to `0n`) and `data` (defaults to `'0x'`).  Missing fields are automatically filled with those defaults.
 * @param transactionOptions - Optional transaction parameters
 * @param transactionOptions.UNSAFE_DELEGATE_CALL - If true, executes as delegate call (use with extreme caution - can compromise Safe)
 * @param transactionOptions.baseGas - Base gas for transaction execution (defaults to 0n)
 * @param transactionOptions.safeTxGas - Gas limit for Safe transaction execution (defaults to 0n)
 * @param transactionOptions.gasPrice - Gas price for refund calculations (defaults to 0n)
 * @param transactionOptions.gasToken - Token address for gas payment (defaults to 0x0 for ETH)
 * @param transactionOptions.refundReceiver - Address to receive gas refunds (defaults to 0x0)
 * @param transactionOptions.nonce - Transaction nonce (defaults to current Safe nonce)
 * @param transactionOptions.chainId - Chain ID (defaults to current chain)
 * @returns Complete FullSafeTransaction object with all fields populated
 * @throws {Error} If `transactions` is an empty array (`"No transactions provided"`)
 *
 * @remarks
 * • All addresses in the returned object are normalised to their EIP-55 checksum representation (even if callers pass lower-case or mixed-case strings).
 * @example
 * ```typescript
 * import { buildSafeTransaction } from 'picosafe';
 * import type { EIP1193Provider } from 'viem';
 *
 * const provider: EIP1193Provider = window.ethereum;
 * const safeAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f4278';
 *
 * // Single ETH transfer
 * const transferTx = await buildSafeTransaction(provider, safeAddress, [{
 *   to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
 *   value: 1000000000000000000n, // 1 ETH
 *   data: '0x'
 * }]);
 *
 * // Batch multiple transfers using MultiSend (automatically uses MultiSendCallOnly)
 * // Note: The Safe must have sufficient balance to cover all individual transaction values
 * const batchTx = await buildSafeTransaction(provider, safeAddress, [
 *   {
 *     to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
 *     value: 1000000000000000000n, // 1 ETH
 *     data: '0x'
 *   },
 *   {
 *     to: '0x742d35Cc6634C0532925a3b844Bc9e7595Ed6cC5',
 *     value: 2000000000000000000n, // 2 ETH
 *     data: '0x'
 *   }
 * ]);
 * // batchTx.value will be 0n, individual values are in the MultiSend encoded data
 *
 * // Contract interaction with custom gas settings
 * const contractTx = await buildSafeTransaction(
 *   provider,
 *   safeAddress,
 *   [{
 *     to: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI token
 *     data: '0xa9059cbb000000000000000000000000d8dA6BF26964aF9D7eEd9e03E53415D37aA960450000000000000000000000000000000000000000000000008ac7230489e80000', // transfer(address,uint256)
 *     value: 0n
 *   }],
 *   {
 *     safeTxGas: 100000n,
 *     baseGas: 30000n
 *   }
 * );
 * ```
 */
async function buildSafeTransaction(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	safeAddress: Address,
	transactions: readonly BuiltSafeTransactionMetaTx[],
	transactionOptions?: Readonly<BuildSafeTransactionOptions>,
): Promise<FullSafeTransaction> {
	if (transactions.length === 0) {
		throw new Error("No transactions provided");
	}

	// Use provided nonce or fetch current nonce from the Safe contract
	// Better set explicitly but using the current nonce is a common pattern
	const nonce =
		transactionOptions?.nonce ?? (await getNonce(provider, { safeAddress }));

	// Ensure all addresses use EIP-55 checksum casing so that callers
	// consistently receive checksummed values, no matter the input.
	const normalizedSafeAddress = OxAddress.checksum(safeAddress);

	const normalizedTransactions: MetaTransaction[] = transactions.map((tx) => ({
		to: OxAddress.checksum(tx.to),
		data: tx.data ?? EMPTY_BYTES,
		value: tx.value ?? 0n,
	}));

	// Gas parameters should be zero if not provided
	// They're relevant for gas refund logic and every gas refund logic is unique
	// So it should be handled by the user
	const safeTxGas = transactionOptions?.safeTxGas ?? 0n;
	const baseGas = transactionOptions?.baseGas ?? 0n;
	const gasPrice = transactionOptions?.gasPrice ?? 0n;
	const gasTokenInput = transactionOptions?.gasToken ?? ZERO_ADDRESS;
	const refundReceiverInput =
		transactionOptions?.refundReceiver ?? ZERO_ADDRESS;
	const gasToken =
		gasTokenInput === ZERO_ADDRESS
			? ZERO_ADDRESS
			: OxAddress.checksum(gasTokenInput);
	const refundReceiver =
		refundReceiverInput === ZERO_ADDRESS
			? ZERO_ADDRESS
			: OxAddress.checksum(refundReceiverInput);

	let txTo: Address;
	let txData: Hex;
	let txValue: bigint;
	let txOperation: Operation;
	if (normalizedTransactions.length > 1) {
		txTo = OxAddress.checksum(V141_ADDRESSES.MultiSendCallOnly);
		txData = encodeMultiSendCall(normalizedTransactions);
		txValue = 0n;
		txOperation = Operation.UNSAFE_DELEGATECALL;
	} else if (normalizedTransactions[0]) {
		txTo = normalizedTransactions[0].to;
		txData = normalizedTransactions[0].data;
		txValue = normalizedTransactions[0].value;
		txOperation = transactionOptions?.UNSAFE_DELEGATE_CALL
			? Operation.UNSAFE_DELEGATECALL
			: Operation.Call;
	} else {
		// This branch is theoretically unreachable because an earlier check
		// throws when `normalizedTransactions.length === 0` and the other two
		// branches cover all remaining lengths.  Added solely to satisfy
		// TypeScript's definite-assignment analysis.
		throw new Error("Unreachable code path in buildSafeTransaction");
	}

	const transaction: FullSafeTransaction = {
		safeAddress: normalizedSafeAddress,
		chainId: transactionOptions?.chainId ?? (await getChainId(provider)),
		to: txTo,
		value: txValue,
		data: txData,
		operation: txOperation,
		safeTxGas,
		baseGas,
		gasPrice,
		gasToken,
		refundReceiver,
		nonce,
	};

	return transaction;
}

/**
 * Signs a Safe transaction using EIP-712 typed data signing.
 * The signature can be used to authorize the execution of the transaction by the Safe.
 *
 * @param provider - EIP-1193 compatible provider with signing capabilities
 * @param transaction - Complete Safe transaction object to sign (must include safeAddress and chainId)
 * @param signerAddress - (optional) Address of the signer (must be connected to provider and be a Safe owner).
 *                        If not provided, the first available account from the provider will be used.
 * @returns {@link StaticSignature} object containing the signer address and static signature data
 * @throws {Error} If signing fails (e.g., user rejection, wallet doesn't support eth_signTypedData_v4)
 * @example
 * ```typescript
 * import { signSafeTransaction, buildSafeTransaction } from 'picosafe';
 * import type { EIP1193Provider } from 'viem';
 *
 * const provider: EIP1193Provider = window.ethereum;
 * const safeAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f4278';
 * const ownerAddress = '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1';
 *
 * // First build the transaction
 * const transaction = await buildSafeTransaction(provider, safeAddress, [{
 *   to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
 *   value: 1000000000000000000n, // 1 ETH
 *   data: '0x'
 * }]);
 *
 * // Sign the transaction with an owner account
 * const signature = await signSafeTransaction(
 *   provider,
 *   transaction,
 *   ownerAddress
 * );
 *
 * console.log('Signature:', signature);
 * // {
 * //   signer: '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1',
 * //   data: '0x5ae401dc2b9f3d1e8f2a5c3e8d4a3b2c1f0e9d8c7b6a5948372615243546372819283a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f01b' // 65 bytes signature
 * // }
 * ```
 */
async function signSafeTransaction(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	transaction: Readonly<FullSafeTransaction>,
	signerAddress?: Address,
): Promise<Readonly<ECDSASignature>> {
	// We convert the chain id to a string so it could be serialized to JSON
	const domain = getSafeEip712Domain(
		transaction.safeAddress,
		transaction.chainId.toString(),
	);

	const signerAddressToUse = signerAddress || (await getAccounts(provider))[0];
	if (!signerAddressToUse) {
		throw new Error("No signer address provided and no accounts found");
	}

	const signature = (await provider.request({
		method: "eth_signTypedData_v4",
		params: [
			signerAddressToUse,
			JSON.stringify({
				types: SAFE_TX_EIP712_TYPES,
				domain,
				primaryType: "SafeTx",
				message: {
					to: transaction.to,
					value: transaction.value.toString(),
					data: transaction.data,
					operation: transaction.operation,
					safeTxGas: transaction.safeTxGas.toString(),
					baseGas: transaction.baseGas.toString(),
					gasPrice: transaction.gasPrice.toString(),
					gasToken: transaction.gasToken,
					refundReceiver: transaction.refundReceiver,
					nonce: transaction.nonce.toString(),
				},
			}),
		],
	})) as Hex;

	return {
		signer: signerAddressToUse,
		data: signature,
	};
}

/**
 * Executes a Safe transaction by submitting it to the blockchain with the required signatures.
 * This function encodes the signatures and calls the Safe's execTransaction function.
 *
 * @param provider - EIP-1193 compatible provider with an unlocked account for sending transactions
 * @param transaction - Complete Safe transaction object with all required fields (must include safeAddress)
 * @param signatures - Array of signatures from Safe owners (must meet threshold requirement)
 * @returns WrappedTransaction object with rawTransaction data and send() method
 * @throws {Error} If transaction submission fails
 * @example
 * ```typescript
 * import { executeSafeTransaction, buildSafeTransaction, signSafeTransaction } from 'picosafe';
 * import { createWalletClient, custom } from 'viem';
 * import { mainnet } from 'viem/chains';
 *
 * const walletClient = createWalletClient({
 *   chain: mainnet,
 *   transport: custom(window.ethereum),
 * });
 *
 * const safeAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f4278';
 *
 * // Build the transaction
 * const transaction = await buildSafeTransaction(walletClient, safeAddress, [{
 *   to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
 *   value: 1000000000000000000n, // 1 ETH
 *   data: '0x'
 * }]);
 *
 * // Collect signatures from owners
 * const signature1 = await signSafeTransaction(
 *   walletClient,
 *   transaction,
 *   '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1'
 * );
 *
 * const signature2 = await signSafeTransaction(
 *   walletClient,
 *   transaction,
 *   '0xFFcf8FDEE72ac11b5c542428B35EEF5769C409f0'
 * );
 *
 * // Execute transaction with collected signatures
 * const executionTx = await executeSafeTransaction(
 *   walletClient,
 *   transaction,
 *   [signature1, signature2]
 * );
 *
 * // Send the transaction
 * const txHash = await executionTx.send();
 * console.log('Transaction submitted:', txHash);
 *
 * // Or get raw transaction data for manual sending
 * console.log('Raw transaction:', executionTx.rawTransaction);
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L139
 */
async function executeSafeTransaction(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	transaction: Readonly<FullSafeTransaction>,
	signatures: readonly PicosafeSignature[],
): Promise<WrappedTransaction<void>> {
	const encodedSignatures = encodeSafeSignaturesBytes(signatures);

	const execTransactionFn = AbiFunction.fromAbi(
		PARSED_SAFE_ABI,
		"execTransaction",
	);
	const data = AbiFunction.encodeData(execTransactionFn, [
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

	return wrapEthereumTransaction(provider, {
		to: transaction.safeAddress,
		data,
		value: 0n,
	});
}

export type { BuildSafeTransactionOptions, SecureSafeTransactionOptions };
export { buildSafeTransaction, signSafeTransaction, executeSafeTransaction };
