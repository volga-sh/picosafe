import type { Address, Hex, Log } from "viem";
import {
	decodeEventLog,
	encodeFunctionData,
	encodePacked,
	getContractAddress,
	keccak256,
} from "viem";
import { PARSED_SAFE_ABI, PARSED_SAFE_PROXY_FACTORY_ABI } from "./abis.js";
import { V141_ADDRESSES } from "./safe-contracts.js";
import type { EIP1193ProviderWithRequestFn } from "./types.js";
import { EMPTY_BYTES, ZERO_ADDRESS } from "./utilities/constants.js";
import { getAccounts } from "./utilities/eip1193-provider.js";
import type { WrappedTransaction } from "./utilities/wrapEthereumTransaction.js";
import { wrapEthereumTransaction } from "./utilities/wrapEthereumTransaction.js";

/**
 * Configuration for deploying a Safe smart account
 */
interface SafeDeploymentConfig {
	/**
	 * Array of owner addresses that will control the Safe
	 */
	owners: readonly Address[];

	/**
	 * Number of required confirmations for Safe transactions
	 */
	threshold: bigint;

	/**
	 * Contract address for optional delegate call during setup
	 * WARNING: DELEGATECALL IS UNSAFE AND SHOULD ONLY BE USED WITH TRUSTED CONTRACTS
	 * @default ZERO_ADDRESS
	 */
	UNSAFE_DELEGATECALL_to?: Address;

	/**
	 * Data payload for optional delegate call during setup
	 * WARNING: DELEGATECALL IS UNSAFE AND SHOULD ONLY BE USED WITH TRUSTED CONTRACTS
	 * @default EMPTY_BYTES
	 */
	UNSAFE_DELEGATECALL_data?: Hex;

	/**
	 * Address of fallback handler contract
	 * @default V141_ADDRESSES.CompatibilityFallbackHandler
	 */
	fallbackHandler?: Address;

	/**
	 * Token address for deployment payment
	 * @default ZERO_ADDRESS (ETH)
	 */
	paymentToken?: Address;

	/**
	 * Amount to pay for deployment
	 * @default 0n
	 */
	payment?: bigint;

	/**
	 * Address to receive deployment payment
	 * @default ZERO_ADDRESS
	 */
	paymentReceiver?: Address;

	/**
	 * Nonce used for deterministic address generation via CREATE2
	 * @default 0n
	 */
	saltNonce?: bigint;

	/**
	 * Address of Safe singleton/master copy contract
	 * @default V141_ADDRESSES.SafeL2
	 */
	singleton?: Address;

	/**
	 * Address of Safe proxy factory contract
	 * @default V141_ADDRESSES.SafeProxyFactory
	 */
	proxyFactory?: Address;
}

type FullSafeDeploymentConfig = Required<SafeDeploymentConfig>;

/**
 * Configuration for calculating a Safe address with pre-encoded setup data
 */
interface SafeAddressCalculationWithSetupData {
	/**
	 * Pre-encoded setup data for the Safe proxy
	 */
	setupData: Hex;

	/**
	 * Nonce used for deterministic address generation via CREATE2
	 * @default 0n
	 */
	saltNonce?: bigint;

	/**
	 * Address of Safe singleton/master copy contract
	 * @default V141_ADDRESSES.SafeL2
	 */
	singleton?: Address;

	/**
	 * Address of Safe proxy factory contract
	 * @default V141_ADDRESSES.SafeProxyFactory
	 */
	proxyFactory?: Address;
}

/**
 * Calculates the deterministic address for a Safe deployment using CREATE2
 *
 * This function computes the counterfactual address where a Safe will be deployed
 * based on the provided configuration. The address is deterministic and can be
 * calculated before the actual deployment.
 *
 * @param config - Safe deployment configuration (see {@link SafeDeploymentConfig} for field details) or pre-encoded setup data
 *
 * @returns The predicted Safe proxy address
 *
 * @throws {Error} If encoding of setup data or address calculation fails
 *
 * @example
 * // Calculate address for a 2-of-3 multisig
 * const predictedAddress = calculateSafeAddress({
 *   owners: [
 *     '0x1234567890123456789012345678901234567890',
 *     '0x2345678901234567890123456789012345678901',
 *     '0x3456789012345678901234567890123456789012'
 *   ],
 *   threshold: 2n,
 *   saltNonce: 42n // Use custom nonce for unique address
 * });
 * console.log('Safe will be deployed at:', predictedAddress);
 *
 * @example
 * // Calculate address with pre-encoded setup data
 * const setupData = encodeSetupData({ owners, threshold });
 * const predictedAddress = calculateSafeAddress({
 *   setupData,
 *   saltNonce: 42n
 * });
 */
function calculateSafeAddress(
	config: Readonly<SafeDeploymentConfig | SafeAddressCalculationWithSetupData>,
): Address {
	let setupData: Hex;
	let saltNonce: bigint;
	let singleton: Address;
	let proxyFactory: Address;

	if ("setupData" in config) {
		setupData = config.setupData;
		saltNonce = config.saltNonce ?? 0n;
		singleton = config.singleton ?? V141_ADDRESSES.SafeL2;
		proxyFactory = config.proxyFactory ?? V141_ADDRESSES.SafeProxyFactory;
	} else {
		const {
			owners,
			threshold,
			UNSAFE_DELEGATECALL_to = ZERO_ADDRESS,
			UNSAFE_DELEGATECALL_data = EMPTY_BYTES,
			fallbackHandler = V141_ADDRESSES.CompatibilityFallbackHandler,
			paymentToken = ZERO_ADDRESS,
			payment = 0n,
			paymentReceiver = ZERO_ADDRESS,
		} = config;

		setupData = encodeSetupData({
			owners,
			threshold,
			UNSAFE_DELEGATECALL_to,
			UNSAFE_DELEGATECALL_data,
			fallbackHandler,
			paymentToken,
			payment,
			paymentReceiver,
		});

		saltNonce = config.saltNonce ?? 0n;
		singleton = config.singleton ?? V141_ADDRESSES.SafeL2;
		proxyFactory = config.proxyFactory ?? V141_ADDRESSES.SafeProxyFactory;
	}

	const salt = keccak256(
		encodePacked(["bytes32", "uint256"], [keccak256(setupData), saltNonce]),
	);

	const proxyBytecode =
		"0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564" as Hex;
	const bytecodeHash = keccak256(
		encodePacked(["bytes", "uint256"], [proxyBytecode, BigInt(singleton)]),
	);

	return getContractAddress({
		bytecodeHash,
		from: proxyFactory,
		opcode: "CREATE2",
		salt,
	});
}

/**
 * Deploys a new Safe smart account using a proxy factory
 *
 * This function deploys a new Safe proxy contract with the specified configuration.
 * It uses the Safe proxy factory to deploy a minimal proxy pointing to the Safe
 * singleton contract, making deployment gas-efficient.
 *
 * @param provider - EIP-1193 compatible provider for blockchain interaction
 * @param config - Safe deployment configuration (see {@link SafeDeploymentConfig} for field details)
 *
 * @returns {WrappedTransaction<{ safeAddress: Address }>} Wrapper containing:
 *          - rawTransaction: the transaction request object for deployment
 *          - send(overrides?): function to send the transaction, returning a promise resolving to the transaction hash
 *          - data.safeAddress: the predicted Safe proxy address
 *
 * @throws {Error} If provider is not connected or has no accounts
 * @throws {Error} If the deployment transaction fails or is rejected
 * @throws {Error} If encoding of setup data fails
 *
 * @example
 * ```typescript
 * import { deploySafeAccount } from 'picosafe';
 * import { createWalletClient, http } from 'viem';
 * import { mainnet } from 'viem/chains';
 *
 * const walletClient = createWalletClient({
 *   chain: mainnet,
 *   transport: http(),
 * });
 *
 * // Deploy a 2-of-3 multisig Safe
 * const deployment = await deploySafeAccount(walletClient, {
 *   owners: [
 *     '0x1234567890123456789012345678901234567890',
 *     '0x2345678901234567890123456789012345678901',
 *     '0x3456789012345678901234567890123456789012'
 *   ],
 *   threshold: 2n
 * });
 *
 * // Get the predicted Safe address
 * console.log('Safe will be deployed at:', deployment.data.safeAddress);
 *
 * // Send the deployment transaction
 * const txHash = await deployment.send();
 * console.log('Transaction hash:', txHash);
 * ```
 *
 * @example
 * ```typescript
 * import { deploySafeAccount } from 'picosafe';
 * import { parseEther } from 'viem';
 *
 * // Deploy with custom configuration and payment
 * const deployment = await deploySafeAccount(walletClient, {
 *   owners: ['0x1234567890123456789012345678901234567890'],
 *   threshold: 1n,
 *   saltNonce: 12345n, // Custom nonce for unique address
 *   payment: parseEther('0.01'), // Pay 0.01 ETH for deployment
 *   paymentReceiver: '0x9876543210987654321098765432109876543210'
 * });
 *
 * // Access the raw transaction if needed
 * console.log('Raw tx:', deployment.rawTransaction);
 *
 * // Deploy the Safe
 * const txHash = await deployment.send();
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/proxies/SafeProxyFactory.sol#L52
 */
async function deploySafeAccount(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	config: Readonly<SafeDeploymentConfig>,
): Promise<WrappedTransaction<{ safeAddress: Address }>> {
	const {
		owners,
		threshold,
		UNSAFE_DELEGATECALL_to = ZERO_ADDRESS,
		UNSAFE_DELEGATECALL_data = EMPTY_BYTES,
		fallbackHandler = V141_ADDRESSES.CompatibilityFallbackHandler,
		paymentToken = ZERO_ADDRESS,
		payment = 0n,
		paymentReceiver = ZERO_ADDRESS,
		saltNonce = 0n,
		singleton = V141_ADDRESSES.SafeL2,
		proxyFactory = V141_ADDRESSES.SafeProxyFactory,
	} = config;

	const setupData = encodeSetupData({
		owners,
		threshold,
		UNSAFE_DELEGATECALL_to,
		UNSAFE_DELEGATECALL_data,
		fallbackHandler,
		paymentToken,
		payment,
		paymentReceiver,
	});

	const predictedAddress = calculateSafeAddress({
		setupData,
		saltNonce,
		singleton,
		proxyFactory,
	});

	const deploymentData = encodeFunctionData({
		abi: PARSED_SAFE_PROXY_FACTORY_ABI,
		functionName: "createProxyWithNonce",
		args: [singleton, setupData, saltNonce],
	});

	const accounts = await getAccounts(provider);

	return wrapEthereumTransaction(
		provider,
		{
			from: accounts[0],
			to: proxyFactory,
			data: deploymentData,
		},
		{ safeAddress: predictedAddress },
	);
}

/**
 * Encodes the call data for the Safe proxy `setup` function.
 *
 * @param config - Safe setup configuration (subset of {@link SafeDeploymentConfig} excluding saltNonce, singleton, and proxyFactory)
 * @returns Hex-encoded data for the Safe `setup` contract call
 *
 * @example
 * import { encodeSetupData } from 'picosafe/deployment';
 *
 * const data = encodeSetupData({
 *   owners: [
 *     '0x1234567890123456789012345678901234567890',
 *     '0x2345678901234567890123456789012345678901',
 *     '0x3456789012345678901234567890123456789012',
 *   ],
 *   threshold: 2n,
 * });
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L95
 */
function encodeSetupData(
	config: Omit<
		FullSafeDeploymentConfig,
		"saltNonce" | "singleton" | "proxyFactory"
	>,
): Hex {
	return encodeFunctionData({
		abi: PARSED_SAFE_ABI,
		functionName: "setup",
		args: [
			config.owners,
			config.threshold,
			config.UNSAFE_DELEGATECALL_to,
			config.UNSAFE_DELEGATECALL_data,
			config.fallbackHandler,
			config.paymentToken,
			config.payment,
			config.paymentReceiver,
		],
	});
}

type SafeSetupEvent = {
	eventName: "SafeSetup";
	args: {
		initiator: Address;
		owners: readonly Address[];
		threshold: bigint;
		initializer: Address;
		fallbackHandler: Address;
	};
};

/**
 * Decodes all `SafeSetup` events present in a list of Ethereum logs.
 *
 * A Safe proxy emits a single `SafeSetup(address initiator,address[] owners,uint256 threshold,address initializer,address fallbackHandler)`
 * event during its `setup` call. This utility iterates over the provided `logs`, attempts to decode each one as a
 * `SafeSetup` event using the canonical Safe v1.4.1 ABI, and returns an array containing only the successfully decoded
 * events.
 *
 * Logs that do not correspond to the `SafeSetup` signature are silently ignored—no exception is thrown. This makes the
 * function convenient for post-deployment inspection where the transaction receipt may contain heterogeneous logs
 * (e.g., proxy factory events followed by Safe events).
 *
 * @param logs - Array of raw log objects (as returned by {@link viem.PublicClient.getTransactionReceipt} or
 *               `eth_getLogs`) to scan for `SafeSetup` events.
 *
 * @returns Array of decoded `SafeSetup` event objects. Returns an empty array if no matching events are found.
 *
 * @example
 * import { publicClient } from "viem";
 * import { decodeSafeSetupEventFromLogs } from "picosafe/deployment";
 *
 * // Assume `txHash` is the hash of a Safe deployment transaction
 * const { logs } = await publicClient.getTransactionReceipt({ hash: txHash });
 *
 * const setupEvents = decodeSafeSetupEventFromLogs(logs);
 * setupEvents.forEach(event => {
 *   console.log("Safe deployed by", event.args.initiator);
 *   console.log("Owners:", event.args.owners);
 *   console.log("Threshold:", event.args.threshold.toString());
 * });
 */
function decodeSafeSetupEventFromLogs(logs: readonly Log[]): SafeSetupEvent[] {
	const decoded: SafeSetupEvent[] = [];

	logs.forEach((log) => {
		try {
			const event = decodeEventLog({
				abi: PARSED_SAFE_ABI,
				data: log.data,
				topics: log.topics,
				eventName: "SafeSetup",
				strict: true,
			});
			decoded.push(event);
		} catch {}
	});

	return decoded;
}

export type {
	SafeDeploymentConfig,
	FullSafeDeploymentConfig,
	SafeAddressCalculationWithSetupData,
};
export {
	calculateSafeAddress,
	deploySafeAccount,
	encodeSetupData,
	decodeSafeSetupEventFromLogs,
};
