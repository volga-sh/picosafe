import {
	deploySafeAccount,
	executeSafeTransaction,
	getChangeThresholdTransaction,
	getOwners,
	getThreshold,
	signSafeTransaction,
} from "@volga/picosafe";
import { createWalletClient, http } from "viem";
import { withExampleScene } from "./example-scene.js";

/**
 * Example: Changing a Safe's Signature Threshold
 *
 * Demonstrates updating the number of signatures required to authorize Safe
 * transactions. Deploys a misconfigured Safe, computes the recommended quorum
 * (ceil(owners / 2)), and raises the threshold with signatures from the
 * necessary owners.
 */

await withExampleScene(async (scene) => {
	const { walletClient, publicClient, accounts, anvilInstance } = scene;

	const safeDeployment = await deploySafeAccount(walletClient, {
		owners: [
			accounts.owner1.address,
			accounts.owner2.address,
			accounts.owner3.address,
		],
		threshold: 1n,
	});

	const deploymentHash = await safeDeployment.send();
	await publicClient.waitForTransactionReceipt({ hash: deploymentHash });

	const safeAddress = safeDeployment.data.safeAddress;
	console.log("Provisioned Safe:", safeAddress);

	const owners = await getOwners(walletClient, { safeAddress });
	const currentThreshold = await getThreshold(walletClient, { safeAddress });
	const targetThreshold = BigInt(Math.ceil(owners.length / 2));

	console.log(
		`Initial state: ${owners.length} owners, threshold ${currentThreshold.toString()} (target ${targetThreshold.toString()})`,
	);

	const changeThresholdTx = await getChangeThresholdTransaction(
		walletClient,
		safeAddress,
		targetThreshold,
	);

	const owner1Signature = await signSafeTransaction(
		walletClient,
		changeThresholdTx,
		accounts.owner1.address,
	);

	const owner2WalletClient = createWalletClient({
		chain: walletClient.chain,
		transport: http(anvilInstance.rpcUrl),
		account: accounts.owner2,
	});
	const owner2Signature = await signSafeTransaction(
		owner2WalletClient,
		changeThresholdTx,
		accounts.owner2.address,
	);

	const execution = await executeSafeTransaction(
		walletClient,
		changeThresholdTx,
		[owner1Signature, owner2Signature],
	);

	const txHash = await execution.send();
	await publicClient.waitForTransactionReceipt({ hash: txHash });

	const updatedThreshold = await getThreshold(walletClient, { safeAddress });
	console.log("Threshold updated:", txHash);
	console.log(
		`✓ Safe now enforces ${updatedThreshold.toString()} approvals across ${owners.length} owners (ceil(${owners.length} / 2))`,
	);
});
