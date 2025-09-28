import {
	executeSafeTransaction,
	getDisableModuleTransaction,
	signSafeTransaction,
} from "@volga/picosafe";
import { withExampleScene } from "./example-scene.js";

/**
 * Example: Disabling a Module from a Safe
 *
 * This example demonstrates how to disable a previously enabled module.
 * Disabling a module revokes its authorization to execute transactions
 * on behalf of the Safe, restoring the security boundary.
 *
 * The Safe uses a linked list structure for modules, so when disabling
 * a module, the SDK automatically finds the correct previous module
 * in the list.
 */

await withExampleScene(
	async (scene) => {
		const { walletClient, publicClient, safes, accounts, contracts } = scene;

		const moduleAddress = contracts.testModule;

		// Build the disable module transaction
		const disableModuleTx = await getDisableModuleTransaction(
			walletClient,
			safes.multiOwner,
			moduleAddress,
		);

		// For a 2-of-3 Safe, we need 2 signatures
		const signature1 = await signSafeTransaction(
			walletClient,
			disableModuleTx,
			accounts.owner1.address,
		);

		const walletClient2 = walletClient.extend((client) => ({
			account: accounts.owner2,
		}));
		const signature2 = await signSafeTransaction(
			walletClient2,
			disableModuleTx,
			accounts.owner2.address,
		);

		// Execute disable transaction
		const execution = await executeSafeTransaction(
			walletClient,
			disableModuleTx,
			[signature1, signature2],
		);

		const txHash = await execution.send();
		await publicClient.waitForTransactionReceipt({ hash: txHash });

		console.log(`Module disabled in transaction: ${txHash}`);
		console.log("✓ Module has been successfully disabled and can no longer execute transactions");
	},
	{
		deployModule: true,
		enableModuleOnSafe: "multiOwner",
	},
);