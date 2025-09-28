import {
	executeSafeTransaction,
	getGuard,
	signSafeTransaction,
	UNSAFE_getSetGuardTransaction,
	ZERO_ADDRESS,
} from "@volga/picosafe";
import { withExampleScene } from "./example-scene.js";

/**
 * Example: Removing a Guard from a Safe
 *
 * Demonstrates how to remove a guard from a Safe by setting it to the zero address.
 * This restores the Safe to its default state without guard validation.
 */

await withExampleScene(
	async (scene) => {
		const { walletClient, publicClient, safes, accounts, contracts } = scene;

		console.log("Safe has guard:", contracts.testGuard);

		const removeGuardTx = await UNSAFE_getSetGuardTransaction(
			walletClient,
			safes.singleOwner,
			ZERO_ADDRESS,
		);

		const signature = await signSafeTransaction(
			walletClient,
			removeGuardTx,
			accounts.owner1.address,
		);

		const execution = await executeSafeTransaction(
			walletClient,
			removeGuardTx,
			[signature],
		);
		const txHash = await execution.send();

		await publicClient.waitForTransactionReceipt({ hash: txHash });

		// Verify the guard is removed
		const currentGuard = await getGuard(walletClient, {
			safeAddress: safes.singleOwner,
		});

		console.log("Guard removed transaction:", txHash);
		console.log("✓ Guard removed, current guard:", currentGuard);
	},
	{
		deployGuard: true,
		setGuardOnSafe: "singleOwner", // Pre-set guard on the Safe
	},
);
