import {
	executeSafeTransaction,
	getAddOwnerTransaction,
	getOwners,
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

	console.log("Initial Safe:", safes.singleOwner);
	console.log("Current owner:", accounts.owner1.address);
	console.log("New owner to add:", accounts.owner2.address);

	// 1. Check current owners
	const initialOwners = await getOwners(walletClient, {
		safeAddress: safes.singleOwner,
	});
	console.log("Initial owners:", initialOwners);
	console.log("Initial threshold: 1-of-1");

	// 2. Build transaction to add owner and update threshold to 2-of-2
	const addOwnerTx = await getAddOwnerTransaction(
		walletClient,
		safes.singleOwner,
		{
			newOwner: accounts.owner2.address,
			newThreshold: 2n, // Changing from 1-of-1 to 2-of-2
		},
	);

	console.log("Transaction built - Nonce:", addOwnerTx.nonce);

	// 3. Sign the transaction with the current owner
	const signature = await signSafeTransaction(
		walletClient,
		addOwnerTx,
		accounts.owner1.address,
	);

	console.log("Transaction signed by current owner");

	// 4. Execute the transaction
	const execution = await executeSafeTransaction(walletClient, addOwnerTx, [
		signature,
	]);
	const txHash = await execution.send();

	await publicClient.waitForTransactionReceipt({ hash: txHash });
	console.log("Owner added - Transaction:", txHash);

	// 5. Verify the new owner was added and threshold updated
	const newOwners = await getOwners(walletClient, {
		safeAddress: safes.singleOwner,
	});

	console.log("Updated owners:", newOwners);
	console.log("Updated threshold: 2-of-2");
	console.log(
		"✓ Successfully upgraded from single-owner to multi-signature Safe",
	);
});
