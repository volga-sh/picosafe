import {
	executeSafeTransaction,
	getOwners,
	getRemoveOwnerTransaction,
	getThreshold,
	signSafeTransaction,
} from "@volga/picosafe";
import { createWalletClient, http } from "viem";
import { withExampleScene } from "./example-scene.js";

/**
 * Example: Removing an Owner from a Safe
 *
 * Shows how to remove an existing owner from a multi-signature Safe while keeping
 * governance intact by updating the signature threshold. Demonstrates collecting
 * signatures from multiple owners before executing the administrative change.
 */

await withExampleScene(async (scene) => {
	const { walletClient, publicClient, safes, accounts, anvilInstance } = scene;

	const currentOwners = await getOwners(walletClient, {
		safeAddress: safes.multiOwner,
	});
	const currentThreshold = await getThreshold(walletClient, {
		safeAddress: safes.multiOwner,
	});

	console.log(
		`Initial state: ${currentOwners.length} owners, threshold ${currentThreshold.toString()}`,
	);
	const projectedOwnerCount = currentOwners.length - 1;
	const newThreshold = BigInt(Math.ceil(projectedOwnerCount / 2));

	const removeOwnerTx = await getRemoveOwnerTransaction(
		walletClient,
		safes.multiOwner,
		{
			ownerToRemove: accounts.owner3.address,
			newThreshold: newThreshold, // 2 owners → ceil(2 / 2) = 1 signature
		},
	);

	const owner1Signature = await signSafeTransaction(
		walletClient,
		removeOwnerTx,
		accounts.owner1.address,
	);

	const owner2WalletClient = createWalletClient({
		chain: walletClient.chain,
		transport: http(anvilInstance.rpcUrl),
		account: accounts.owner2,
	});

	const owner2Signature = await signSafeTransaction(
		owner2WalletClient,
		removeOwnerTx,
		accounts.owner2.address,
	);

	const execution = await executeSafeTransaction(walletClient, removeOwnerTx, [
		owner1Signature,
		owner2Signature,
	]);

	const txHash = await execution.send();
	await publicClient.waitForTransactionReceipt({ hash: txHash });

	console.log("Owner removed:", txHash);
	console.log(
		`✓ Safe updated to ${projectedOwnerCount} owners with ${newThreshold.toString()} required signature(s)`,
	);
});
