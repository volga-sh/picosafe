import {
	executeSafeTransaction,
	getGuard,
	signSafeTransaction,
	UNSAFE_getSetGuardTransaction,
} from "@volga/picosafe";
import { withExampleScene } from "./example-scene.js";

/**
 * Example: Setting a Guard on a Safe
 *
 * Demonstrates how to set a guard contract on an existing Safe.
 * Guards are powerful security mechanisms that can validate and potentially
 * block transactions before and after execution.
 *
 * ⚠️ WARNING: Guards can permanently brick your Safe if they malfunction or
 * are malicious. Only use guards from trusted, audited sources.
 */

await withExampleScene(
	async (scene) => {
		const { walletClient, publicClient, safes, accounts, contracts } = scene;

		console.log("Setting guard on Safe:", safes.singleOwner);

		// Prepare the transaction to set the guard
		const setGuardTx = await UNSAFE_getSetGuardTransaction(
			walletClient,
			safes.singleOwner,
			contracts.testGuard,
		);

		// Sign the transaction
		const signature = await signSafeTransaction(
			walletClient,
			setGuardTx,
			accounts.owner1.address,
		);

		// Execute the transaction
		const execution = await executeSafeTransaction(walletClient, setGuardTx, [
			signature,
		]);
		const txHash = await execution.send();

		await publicClient.waitForTransactionReceipt({ hash: txHash });

		// Verify the guard is set
		const currentGuard = await getGuard(walletClient, {
			safeAddress: safes.singleOwner,
		});

		console.log("Guard set transaction:", txHash);
		console.log("✓ Guard is now active:", currentGuard);
	},
	{
		deployGuard: true, // Deploy test guard contract
	},
);
