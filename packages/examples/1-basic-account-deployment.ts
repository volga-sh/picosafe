import { deploySafeAccount, type SafeDeploymentConfig } from "@volga/picosafe";
import { withExampleScene } from "./example-scene.js";

/**
 * Example: Basic Safe Account Deployment
 *
 * Demonstrates deploying a new Safe account with multiple owners and a threshold.
 * Shows how to use deploySafeAccount() with various configurations.
 */

await withExampleScene(async (scene) => {
	const { walletClient, publicClient } = scene;

	const deploymentConfig: SafeDeploymentConfig = {
		owners: [
			"0xcf244a263F94e7aff4fb97f9E83fc26462726632",
			"0xc598A72206f42a6e16Fc957Bc6c20a20Ed3A0Ff9",
			"0x792D43C8f5E99F1B7a90F3e4d85d46DfF5F98D24",
		],
		threshold: 2n,
		saltNonce: 42n, // Custom salt for deterministic address
	};

	const deployment = await deploySafeAccount(walletClient, deploymentConfig);

	console.log("Safe Address:", deployment.data.safeAddress);

	const txHash = await deployment.send();
	await publicClient.waitForTransactionReceipt({ hash: txHash });

	console.log("Deployed in transaction:", txHash);
	console.log("✓ 2-of-3 multisig Safe deployed successfully");
});
