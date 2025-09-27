import {
	buildSafeTransaction,
	executeSafeTransaction,
	signSafeTransaction,
} from "@volga/picosafe";
import { parseEther } from "viem";
import { withExampleScene } from "./example-scene.js";

/**
 * Example: Complete Safe Transaction Lifecycle
 *
 * Demonstrates the full Safe transaction workflow:
 * Build transaction → Sign → Execute
 *
 * Shows how PicoSafe separates transaction building, signing, and execution
 * for maximum flexibility in multi-signature workflows.
 */

await withExampleScene(
	async (scene) => {
		const { walletClient, publicClient, safes, accounts } = scene;

		const safeTx = await buildSafeTransaction(walletClient, safes.singleOwner, [
			{
				to: accounts.nonOwner.address,
				value: parseEther("0.001"),
				data: "0x",
			},
		]);

		console.log("Transaction built - Nonce:", safeTx.nonce);

		const signature = await signSafeTransaction(
			walletClient,
			safeTx,
			accounts.owner1.address,
		);

		const execution = await executeSafeTransaction(walletClient, safeTx, [
			signature,
		]);

		const txHash = await execution.send();
		await publicClient.waitForTransactionReceipt({ hash: txHash });

		console.log("Transaction executed:", txHash);
		console.log("✓ Safe transaction completed successfully");
	},
	{
		fundSafesWithEth: "0.01", // Fund Safe with ETH for the transfer
	},
);
