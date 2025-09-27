import type { AnvilInstance } from "@volga/anvil-manager";
import { withAnvil } from "@volga/anvil-manager";
import { deploySafeAccount, type SafeDeploymentConfig } from "@volga/picosafe";
import { getSafeGenesisPath } from "@volga/safe-genesis";
import { TestERC20Abi, TestERC20Bytecode } from "@volga/test-contracts";
import {
	type Account,
	type Address,
	type Chain,
	createPublicClient,
	createWalletClient,
	type Hex,
	http,
	type PublicClient,
	parseEther,
	type Transport,
	type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

/**
 * Pre-configured test environment for PicoSafe examples
 */
export type ExampleScene<
	TOptions extends ExampleSceneOptions = ExampleSceneOptions,
> = {
	// Standard clients
	walletClient: WalletClient<Transport, Chain, Account>;
	publicClient: PublicClient;

	// Pre-deployed Safes with different configurations
	safes: {
		singleOwner: Address; // 1-of-1 Safe with walletClient.account as owner
		multiOwner: Address; // 2-of-3 Safe with test addresses
		highThreshold: Address; // 3-of-3 Safe for demonstrating threshold changes
	};

	// Test accounts (private keys available)
	accounts: {
		owner1: Account; // Primary account (walletClient.account)
		owner2: Account; // Additional test accounts
		owner3: Account;
		nonOwner: Account;
	};

	// Test contracts - guaranteed to exist when deployToken is true
	contracts: TOptions extends { deployToken: true }
		? { testToken: Address }
		: { testToken?: Address };

	// Anvil instance reference
	anvilInstance: AnvilInstance;
};

/**
 * Options for configuring the example scene
 */
export type ExampleSceneOptions = {
	/**
	 * Deploy a test ERC20 token
	 */
	deployToken?: boolean;

	/**
	 * Fund the Safes with ETH (in ether units)
	 */
	fundSafesWithEth?: string;

	/**
	 * Additional custom Safes to deploy
	 */
	customSafes?: Array<{
		config: SafeDeploymentConfig;
		name: string;
	}>;
};

// Anvil's well-known test private keys
const TEST_PRIVATE_KEYS = {
	owner1: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
	owner2: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
	owner3: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
	nonOwner:
		"0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
};

/**
 * Execute a function with a pre-configured test environment including deployed Safes
 *
 * This function sets up a complete test environment with:
 * - An Anvil instance with pre-deployed Safe contracts
 * - Multiple test accounts with known private keys
 * - Pre-deployed Safe accounts with various configurations
 * - Optional test ERC20 token
 *
 * @param fn - The function to execute with the example scene
 * @param options - Configuration options for the scene
 * @returns The result of the provided function
 *
 * @example
 * ```typescript
 * await withExampleScene(async (scene) => {
 *   const { walletClient, publicClient, safes, accounts } = scene;
 *
 *   // Your example code here, focusing purely on PicoSafe functionality
 *   const safeTx = await buildSafeTransaction(
 *     walletClient,
 *     safes.singleOwner,
 *     [{ to: recipient, value: parseEther("0.1"), data: "0x" }]
 *   );
 *   // ...
 * });
 * ```
 */
export async function withExampleScene<
	T,
	TOptions extends ExampleSceneOptions = ExampleSceneOptions,
>(
	fn: (scene: ExampleScene<TOptions>) => Promise<T>,
	options?: TOptions,
): Promise<T> {
	return withAnvil(
		async (anvilInstance) => {
			// Setup accounts
			const accounts = {
				owner1: privateKeyToAccount(TEST_PRIVATE_KEYS.owner1 as Hex),
				owner2: privateKeyToAccount(TEST_PRIVATE_KEYS.owner2 as Hex),
				owner3: privateKeyToAccount(TEST_PRIVATE_KEYS.owner3 as Hex),
				nonOwner: privateKeyToAccount(TEST_PRIVATE_KEYS.nonOwner as Hex),
			};

			// Setup clients with the primary account
			const walletClient = createWalletClient({
				chain: anvil,
				transport: http(anvilInstance.rpcUrl),
				account: accounts.owner1,
			});

			const publicClient = createPublicClient({
				chain: anvil,
				transport: http(anvilInstance.rpcUrl),
			});

			// Deploy standard Safes
			const safes: ExampleScene["safes"] = {
				singleOwner: "" as Address,
				multiOwner: "" as Address,
				highThreshold: "" as Address,
			};

			// 1. Single owner Safe (1-of-1)
			const singleOwnerDeployment = await deploySafeAccount(walletClient, {
				owners: [accounts.owner1.address],
				threshold: 1n,
			});
			await publicClient.waitForTransactionReceipt({
				hash: await singleOwnerDeployment.send(),
			});
			safes.singleOwner = singleOwnerDeployment.data.safeAddress as Address;

			// 2. Multi-owner Safe (2-of-3)
			const multiOwnerDeployment = await deploySafeAccount(walletClient, {
				owners: [
					accounts.owner1.address,
					accounts.owner2.address,
					accounts.owner3.address,
				],
				threshold: 2n,
			});
			await publicClient.waitForTransactionReceipt({
				hash: await multiOwnerDeployment.send(),
			});
			safes.multiOwner = multiOwnerDeployment.data.safeAddress as Address;

			// 3. High threshold Safe (3-of-3)
			const highThresholdDeployment = await deploySafeAccount(walletClient, {
				owners: [
					accounts.owner1.address,
					accounts.owner2.address,
					accounts.owner3.address,
				],
				threshold: 3n,
			});
			await publicClient.waitForTransactionReceipt({
				hash: await highThresholdDeployment.send(),
			});
			safes.highThreshold = highThresholdDeployment.data.safeAddress as Address;

			// Deploy custom Safes if requested
			if (options?.customSafes) {
				for (const customSafe of options.customSafes) {
					const deployment = await deploySafeAccount(
						walletClient,
						customSafe.config,
					);
					await publicClient.waitForTransactionReceipt({
						hash: await deployment.send(),
					});
					// Add to safes object with custom name
					(safes as Record<string, Address>)[customSafe.name] = deployment.data
						.safeAddress as Address;
				}
			}

			// Fund Safes with ETH if requested
			if (options?.fundSafesWithEth) {
				const fundAmount = parseEther(options.fundSafesWithEth);
				for (const safeAddress of Object.values(safes)) {
					if (safeAddress) {
						const fundHash = await walletClient.sendTransaction({
							to: safeAddress,
							value: fundAmount,
						});
						await publicClient.waitForTransactionReceipt({ hash: fundHash });
					}
				}
			}

			// Deploy test contracts if requested
			const contracts: ExampleScene<TOptions>["contracts"] =
				{} as ExampleScene<TOptions>["contracts"];

			if (options?.deployToken) {
				const deployHash = await walletClient.deployContract({
					abi: TestERC20Abi,
					bytecode: TestERC20Bytecode as Hex,
				});

				const receipt = await publicClient.waitForTransactionReceipt({
					hash: deployHash,
				});
				contracts.testToken = receipt.contractAddress as Address;

				// Fund all Safes with tokens
				for (const safeAddress of Object.values(safes)) {
					if (safeAddress) {
						const fundHash = await walletClient.writeContract({
							address: contracts.testToken,
							abi: TestERC20Abi,
							functionName: "transfer",
							args: [safeAddress, parseEther("10000")],
						});
						await publicClient.waitForTransactionReceipt({ hash: fundHash });
					}
				}
			}

			// Create the scene object
			const scene: ExampleScene<TOptions> = {
				walletClient,
				publicClient,
				safes,
				accounts,
				contracts,
				anvilInstance,
			};

			// Execute the provided function with the scene
			return await fn(scene);
		},
		{
			genesisPath: getSafeGenesisPath(),
		},
	);
}
