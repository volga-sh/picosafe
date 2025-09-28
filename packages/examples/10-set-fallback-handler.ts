import {
	executeSafeTransaction,
	getFallbackHandler,
	signSafeTransaction,
	UNSAFE_getSetFallbackHandlerTransaction,
	V141_ADDRESSES,
} from "@volga/picosafe";
import { withExampleScene } from "./example-scene.js";

/**
 * Example: Setting a Fallback Handler on a Safe
 *
 * Demonstrates how to set a fallback handler contract on an existing Safe.
 * Fallback handlers receive all calls that don't match Safe's built-in functions,
 * including EIP-1271 signature validation and token callbacks.
 *
 * ⚠️ WARNING: Fallback handlers can compromise your Safe's security. A malicious
 * handler can fake signature validations and execute arbitrary code with the
 * Safe's permissions. Only use handlers from trusted, audited sources.
 */

await withExampleScene(async (scene) => {
	const { walletClient, publicClient, safes, accounts } = scene;

	console.log("Setting fallback handler on Safe:", safes.singleOwner);

	// Prepare the transaction to set the fallback handler
	const setHandlerTx = await UNSAFE_getSetFallbackHandlerTransaction(
		walletClient,
		safes.singleOwner,
		V141_ADDRESSES.CompatibilityFallbackHandler,
	);

	// Sign the transaction
	const signature = await signSafeTransaction(
		walletClient,
		setHandlerTx,
		accounts.owner1.address,
	);

	// Execute the transaction
	const execution = await executeSafeTransaction(walletClient, setHandlerTx, [
		signature,
	]);
	const txHash = await execution.send();

	await publicClient.waitForTransactionReceipt({ hash: txHash });

	// Get the current fallback handler
	const currentHandler = await getFallbackHandler(walletClient, {
		safeAddress: safes.singleOwner,
	});

	console.log("Fallback handler set transaction:", txHash);
	console.log("Current fallback handler:", currentHandler);
});
