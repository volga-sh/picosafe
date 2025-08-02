import { withAnvil } from "@volga/anvil-manager";
import { deploySafeAccount, type SafeDeploymentConfig } from "@volga/picosafe";
import { getSafeGenesisPath } from "@volga/safe-genesis";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

// Example demonstrating Safe account deployment using a local Anvil instance
// with pre-deployed Safe contracts for faster execution
await withAnvil(
	async (anvilInstance) => {
		console.log(
			`🚀 Starting example with local Anvil at ${anvilInstance.rpcUrl}`,
		);
		console.log("   Using pre-deployed Safe contracts via genesis\n");

		// Use the first Anvil test account as deployer
		const DEPLOYER_PRIVATE_KEY =
			"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

		const walletClient = createWalletClient({
			chain: anvil,
			transport: http(anvilInstance.rpcUrl),
			account: privateKeyToAccount(DEPLOYER_PRIVATE_KEY),
		});

		const publicClient = createPublicClient({
			chain: anvil,
			transport: http(anvilInstance.rpcUrl),
		});

		// Example addresses for Safe owners
		const METAMASK_ACCOUNT = "0xcf244a263F94e7aff4fb97f9E83fc26462726632";
		const LEDGER_ACCOUNT = "0xc598A72206f42a6e16Fc957Bc6c20a20Ed3A0Ff9";
		const BACKUP_ACCOUNT = "0x792D43C8f5E99F1B7a90F3e4d85d46DfF5F98D24";

		const deploymentConfiguration: SafeDeploymentConfig = {
			owners: [METAMASK_ACCOUNT, LEDGER_ACCOUNT, BACKUP_ACCOUNT],
			threshold: 2n,
		};

		console.log("📋 Deployment Configuration:");
		console.log(`   Owners: ${deploymentConfiguration.owners.length}`);
		console.log(`   Threshold: ${deploymentConfiguration.threshold}`);
		console.log();

		const {
			rawTransaction,
			send: sendDeploymentTransaction,
			data: deploymentData,
		} = await deploySafeAccount(walletClient, deploymentConfiguration);

		console.log("🔐 SAFE ACCOUNT ADDRESS:");
		console.log(`   ${deploymentData.safeAddress}`);
		console.log();

		console.log("📦 DEPLOYMENT TRANSACTION:");
		console.log(`   To: ${rawTransaction.to}`);
		console.log(
			`   Data: ${rawTransaction.data ? `${rawTransaction.data.slice(0, 66)}...` : "N/A"}`,
		);
		console.log();

		console.log("📊 DEPLOYMENT DATA:");
		console.log(`   Safe Address: ${deploymentData.safeAddress}`);
		console.log("   Deployment Config:", deploymentData.deploymentConfig);
		console.log();

		console.log("⏳ Deploying Safe account...");
		const deploymentTransactionHash = await sendDeploymentTransaction();

		console.log("✅ DEPLOYMENT TRANSACTION HASH:");
		console.log(`   ${deploymentTransactionHash}`);
		console.log();

		// Wait for transaction to be mined
		console.log("⏳ Waiting for transaction to be mined...");
		const receipt = await publicClient.waitForTransactionReceipt({
			hash: deploymentTransactionHash,
		});

		console.log("🎉 Safe account deployed successfully!");
		console.log(`   Block Number: ${receipt.blockNumber}`);
		console.log(`   Gas Used: ${receipt.gasUsed}`);
		console.log();

		// Verify deployment
		const code = await publicClient.getCode({
			address: deploymentData.safeAddress as `0x${string}`,
		});
		console.log("🔍 Verification:");
		console.log(
			`   Contract deployed: ${code && code !== "0x" ? "✅ Yes" : "❌ No"}`,
		);
	},
	{
		// Use genesis with pre-deployed Safe contracts
		genesisPath: getSafeGenesisPath(),
	},
);
