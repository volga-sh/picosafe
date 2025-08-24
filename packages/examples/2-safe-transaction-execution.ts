import { withAnvil } from "@volga/anvil-manager";
import {
	buildSafeTransaction,
	deploySafeAccount,
	executeSafeTransaction,
	type SafeDeploymentConfig,
	signSafeTransaction,
} from "@volga/picosafe";
import { getSafeGenesisPath } from "@volga/safe-genesis";
import { formatEther, parseEther } from "viem";
import { setupClients } from "./setup.js";

/**
 * Example: Complete Safe Transaction Lifecycle
 *
 * Demonstrates the full Safe transaction workflow:
 * 1. Deploy Safe → 2. Build transaction → 3. Sign → 4. Execute
 *
 * Shows how PicoSafe separates transaction building, signing, and execution
 * for maximum flexibility in multi-signature workflows.
 */

await withAnvil(
	async (anvilInstance) => {
		const { walletClient, publicClient } = setupClients(anvilInstance.rpcUrl);

		// 1. Deploy single-owner Safe
		const deploymentConfig: SafeDeploymentConfig = {
			owners: [walletClient.account.address],
			threshold: 1n,
		};

		const { send: sendDeploymentTx, data: deploymentData } =
			await deploySafeAccount(walletClient, deploymentConfig);

		const deploymentHash = await sendDeploymentTx();
		await publicClient.waitForTransactionReceipt({ hash: deploymentHash });
		console.log("Safe deployed at:", deploymentData.safeAddress);

		// 2. Fund the Safe
		const fundHash = await walletClient.sendTransaction({
			to: deploymentData.safeAddress,
			value: parseEther("0.01"),
		});
		await publicClient.waitForTransactionReceipt({ hash: fundHash });
		console.log("Safe funded with 0.01 ETH");

		// 3. Build Safe transaction (ETH transfer)
		const recipient = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
		const transferAmount = parseEther("0.001");

		const safeTx = await buildSafeTransaction(
			walletClient,
			deploymentData.safeAddress as `0x${string}`,
			[
				{
					to: recipient,
					value: transferAmount,
					data: "0x",
				},
			],
		);

		console.log("Transaction built - Nonce:", safeTx.nonce);

		// 4. Sign the transaction
		const signature = await signSafeTransaction(
			walletClient,
			safeTx,
			walletClient.account.address,
		);

		console.log("Transaction signed by owner");

		// 5. Execute the transaction
		const execTx = await executeSafeTransaction(walletClient, safeTx, [
			signature,
		]);

		const execHash = await execTx.send();
		await publicClient.waitForTransactionReceipt({ hash: execHash });
		console.log("Transaction executed:", execHash);

		// Verify the transfer
		const recipientBalance = await publicClient.getBalance({
			address: recipient,
		});
		console.log(
			"Recipient received:",
			formatEther(recipientBalance),
			"ETH (includes 0.001 ETH transfer)",
		);
	},
	{
		genesisPath: getSafeGenesisPath(),
	},
);
