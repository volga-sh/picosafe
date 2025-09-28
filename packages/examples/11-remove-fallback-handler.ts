import {
	executeSafeTransaction,
	getFallbackHandler,
	signSafeTransaction,
	UNSAFE_getSetFallbackHandlerTransaction,
	ZERO_ADDRESS,
} from "@volga/picosafe";
import { withExampleScene } from "./example-scene.js";

/**
 * Example: Removing a Fallback Handler from a Safe
 *
 * Demonstrates how to remove a fallback handler from a Safe by setting it to the zero address.
 * This restores the Safe to its default state without fallback handler functionality.
 */

await withExampleScene(
	async (scene) => {
		const { walletClient, publicClient, safes, accounts } = scene;

		console.log("Safe has fallback handler set");

		// Remove the fallback handler by setting it to zero address
		const removeHandlerTx = await UNSAFE_getSetFallbackHandlerTransaction(
			walletClient,
			safes.singleOwner,
			ZERO_ADDRESS,
		);

		// Sign the transaction
		const signature = await signSafeTransaction(
			walletClient,
			removeHandlerTx,
			accounts.owner1.address,
		);

		// Execute the transaction
		const execution = await executeSafeTransaction(
			walletClient,
			removeHandlerTx,
			[signature],
		);
		const txHash = await execution.send();

		await publicClient.waitForTransactionReceipt({ hash: txHash });

		// Get the current fallback handler
		const currentHandler = await getFallbackHandler(walletClient, {
			safeAddress: safes.singleOwner,
		});

		console.log("Fallback handler removed transaction:", txHash);
		console.log("Current fallback handler:", currentHandler);
	},
	{
		setFallbackHandlerOnSafe: "singleOwner", // Pre-set fallback handler on the Safe
	},
);
