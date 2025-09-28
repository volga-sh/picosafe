import {
	executeSafeTransaction,
	signSafeTransaction,
	UNSAFE_getEnableModuleTransaction,
} from "@volga/picosafe";
import { createWalletClient, http } from "viem";
import { withExampleScene } from "./example-scene.js";

/**
 * Example: Enabling a Module for a Safe
 *
 * ⚠️ CRITICAL SECURITY WARNING ⚠️
 *
 * Modules have UNLIMITED power over your Safe. Once enabled, a module can:
 * - Execute ANY transaction without owner signatures
 * - Transfer ALL assets (ETH, tokens, NFTs) without restrictions
 * - Call ANY contract on behalf of the Safe
 * - Enable other modules or change Safe settings
 *
 * Only enable modules you fully trust and have audited.
 *
 * This example demonstrates the technical process of enabling a module.
 * In production, extreme caution and thorough security audits are essential.
 */

await withExampleScene(
	async (scene) => {
		const {
			walletClient,
			publicClient,
			safes,
			accounts,
			contracts,
			anvilInstance,
		} = scene;

		console.warn("\n⚠️  MODULE SECURITY WARNING");
		console.warn(
			"Modules have UNLIMITED power over the Safe and can execute any transaction without signatures.",
		);

		const moduleAddress = contracts.testModule;

		// Note the UNSAFE_ prefix - this operation can compromise your Safe
		const enableModuleTx = await UNSAFE_getEnableModuleTransaction(
			walletClient,
			safes.multiOwner,
			moduleAddress,
		);

		// For a 2-of-3 Safe, we need 2 signatures
		const signature1 = await signSafeTransaction(
			walletClient,
			enableModuleTx,
			accounts.owner1.address,
		);

		// Second owner signs
		const walletClient2 = createWalletClient({
			chain: walletClient.chain,
			transport: http(anvilInstance.rpcUrl),
			account: accounts.owner2,
		});
		const signature2 = await signSafeTransaction(
			walletClient2,
			enableModuleTx,
			accounts.owner2.address,
		);

		const execution = await executeSafeTransaction(
			walletClient,
			enableModuleTx,
			[signature1, signature2],
		);

		const txHash = await execution.send();
		await publicClient.waitForTransactionReceipt({ hash: txHash });

		console.log(`Module enabled in transaction: ${txHash}`);
	},
	{
		deployModule: true,
	},
);
