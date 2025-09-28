import {
	executeSafeTransaction,
	getAddOwnerTransaction,
	getOwners,
	getThreshold,
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

	const currentOwners = await getOwners(walletClient, {
		safeAddress: safes.singleOwner,
	});
	const currentThreshold = await getThreshold(walletClient, {
		safeAddress: safes.singleOwner,
	});

	console.log(
		`Initial state: ${currentOwners.length} owners, threshold ${currentThreshold.toString()}`,
	);
	const projectedOwnerCount = currentOwners.length + 1;
	const newThreshold = BigInt(Math.ceil(projectedOwnerCount / 2));

	const addOwnerTx = await getAddOwnerTransaction(
		walletClient,
		safes.singleOwner,
		{
			newOwner: accounts.owner2.address,
			newThreshold: newThreshold, // 3 owners → ceil(3 / 2) = 2 signatures
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
	console.log(
		`✓ Safe now operates with ${projectedOwnerCount} owners and ${newThreshold.toString()} required signatures`,
	);
});
