import { withAnvil } from "@volga/anvil-manager";
import { deploySafeAccount, type SafeDeploymentConfig } from "@volga/picosafe";
import { getSafeGenesisPath } from "@volga/safe-genesis";
import { setupClients } from "./setup.js";

/**
 * Example: Basic Safe Account Deployment
 *
 * Demonstrates deploying a new Safe account with multiple owners and a threshold.
 * Shows how to use deploySafeAccount() and access both the predicted address
 * and raw transaction data for flexible deployment patterns.
 */

await withAnvil(
	async (anvilInstance) => {
		const { walletClient, publicClient } = setupClients(anvilInstance.rpcUrl);

		// Safe configuration - 2-of-3 multisig
		const deploymentConfig: SafeDeploymentConfig = {
			owners: [
				"0xcf244a263F94e7aff4fb97f9E83fc26462726632", // MetaMask
				"0xc598A72206f42a6e16Fc957Bc6c20a20Ed3A0Ff9", // Ledger
				"0x792D43C8f5E99F1B7a90F3e4d85d46DfF5F98D24", // Backup
			],
			threshold: 2n,
		};

		// Deploy Safe account
		const { rawTransaction, send, data } = await deploySafeAccount(
			walletClient,
			deploymentConfig,
		);

		console.log("Safe Address (predicted):", data.safeAddress);
		console.log("Deployment Target:", rawTransaction.to);

		// Execute deployment
		const txHash = await send();
		console.log("Transaction Hash:", txHash);

		// Wait for confirmation
		const receipt = await publicClient.waitForTransactionReceipt({
			hash: txHash,
		});
		console.log("Deployed in block:", receipt.blockNumber);

		// Verify deployment
		const code = await publicClient.getCode({
			address: data.safeAddress as `0x${string}`,
		});
		console.log("Deployment verified:", code && code !== "0x");
	},
	{
		genesisPath: getSafeGenesisPath(),
	},
);
