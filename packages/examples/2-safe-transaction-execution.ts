import { withAnvil } from "@volga/anvil-manager";
import {
	buildSafeTransaction,
	deploySafeAccount,
	executeSafeTransaction,
	type SafeDeploymentConfig,
	signSafeTransaction,
} from "@volga/picosafe";
import { getSafeGenesisPath } from "@volga/safe-genesis";
import {
	createPublicClient,
	createWalletClient,
	formatEther,
	http,
	parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

/**
 * Example demonstrating the full Safe transaction lifecycle:
 * 1. Deploy a new Safe account (single-owner for simplicity)
 * 2. Build an unsigned Safe transaction transferring 0.001 ETH
 * 3. Sign the transaction with the Safe owner
 * 4. Execute the transaction via the Safe contract
 *
 * The script runs against a local Anvil instance that is automatically
 * started with pre-deployed Safe 1.4.1 contracts using `@volga/safe-genesis`.
 *
 * Run with:
 *
 * ```bash
 * # From repository root
 * npm run run-example -- packages/examples/2-safe-transaction-execution.ts
 * ```
 */

await withAnvil(
	async (anvilInstance) => {
		console.log(`🚀 Local Anvil started at ${anvilInstance.rpcUrl}`);
		console.log("   Using pre-deployed Safe contracts via genesis\n");

		// Use the first Anvil test account as wallet/Safe owner
		const OWNER_PRIVATE_KEY =
			"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

		const walletClient = createWalletClient({
			chain: anvil,
			transport: http(anvilInstance.rpcUrl),
			account: privateKeyToAccount(OWNER_PRIVATE_KEY),
		});

		const publicClient = createPublicClient({
			chain: anvil,
			transport: http(anvilInstance.rpcUrl),
		});

		/**
		 * -------------------------------------------------------------------
		 * 1. DEPLOY SAFE ACCOUNT
		 * -------------------------------------------------------------------
		 */
		const deploymentConfig: SafeDeploymentConfig = {
			owners: [walletClient.account.address],
			threshold: 1n, // Single-owner Safe for this example
		};

		console.log("📋 Safe Deployment Configuration:");
		console.log(`   Owner:    ${walletClient.account.address}`);
		console.log(`   Threshold: ${deploymentConfig.threshold}`);
		console.log();

		const { send: sendDeploymentTx, data: deploymentData } =
			await deploySafeAccount(walletClient, deploymentConfig);

		console.log("⏳ Deploying Safe account…");
		const deploymentHash = await sendDeploymentTx();
		await publicClient.waitForTransactionReceipt({ hash: deploymentHash });
		console.log("🎉 Safe deployed at:");
		console.log(`   ${deploymentData.safeAddress}\n`);

		/**
		 * -------------------------------------------------------------------
		 * 2. FUND THE SAFE
		 * -------------------------------------------------------------------
		 */
		console.log("💸 Funding Safe with 0.01 ETH from owner account…");
		const fundHash = await walletClient.sendTransaction({
			to: deploymentData.safeAddress,
			value: parseEther("0.01"),
		});
		await publicClient.waitForTransactionReceipt({ hash: fundHash });
		console.log("   Funding tx mined:\n  ", fundHash, "\n");

		/**
		 * -------------------------------------------------------------------
		 * 3. BUILD & SIGN SAFE TRANSACTION
		 * -------------------------------------------------------------------
		 */
		// vitalik.eth
		const recipient = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
		const transferValue = parseEther("0.001"); // 0.001 ETH

		console.log("🛠️  Building Safe transaction ➡️  Transfer 0.001 ETH");
		const safeTx = await buildSafeTransaction(
			walletClient,
			deploymentData.safeAddress as `0x${string}`,
			[
				{
					to: recipient,
					value: transferValue,
					data: "0x",
				},
			],
		);

		console.log("🖊️  Signing Safe transaction…");
		const signature = await signSafeTransaction(
			walletClient,
			safeTx,
			walletClient.account.address,
		);

		/**
		 * -------------------------------------------------------------------
		 * 4. EXECUTE SAFE TRANSACTION
		 * -------------------------------------------------------------------
		 */
		console.log("🚀 Executing Safe transaction…");
		const execTx = await executeSafeTransaction(walletClient, safeTx, [
			signature,
		]);

		const execHash = await execTx.send();
		await publicClient.waitForTransactionReceipt({ hash: execHash });

		console.log("✅ Safe transaction executed:");
		console.log(`   Tx Hash: ${execHash}`);

		// Display recipient balance for confirmation
		const balance = await publicClient.getBalance({ address: recipient });
		console.log("💰 Recipient balance:");
		console.log(
			`   ${formatEther(balance)} ETH (should include the 0.001 ETH transfer)`,
		);
	},
	{
		// Use genesis with pre-deployed Safe contracts
		genesisPath: getSafeGenesisPath(),
	},
);
