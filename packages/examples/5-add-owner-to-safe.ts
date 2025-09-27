import {
	executeSafeTransaction,
	getAddOwnerTransaction,
	signSafeTransaction,
} from "@volga/picosafe";
import { withExampleScene } from "./example-scene.js";

/**
 * Example: Adding an Owner to a Safe
 *
 * Demonstrates how to add a new owner to an existing Safe and update the threshold.
 * This is a common governance operation for multi-signature wallets, allowing
 * organizations to adapt their signing requirements as they evolve.
 */

await withExampleScene(async (scene) => {
	const { walletClient, publicClient, safes, accounts } = scene;

	console.log("Initial state: 1 owner, threshold 1");

	const addOwnerTx = await getAddOwnerTransaction(
		walletClient,
		safes.singleOwner,
		{
			newOwner: accounts.owner2.address,
			newThreshold: 2n, // Changing from 1-of-1 to 2-of-2
		},
	);

	const signature = await signSafeTransaction(
		walletClient,
		addOwnerTx,
		accounts.owner1.address,
	);

	const execution = await executeSafeTransaction(walletClient, addOwnerTx, [
		signature,
	]);
	const txHash = await execution.send();

	await publicClient.waitForTransactionReceipt({ hash: txHash });

	console.log("Owner added:", txHash);
	console.log("✓ Upgraded to 2-of-2 multi-signature Safe");
});
