import { withAnvil } from "@volga/anvil-manager";
import {
	calculateSafeAddress,
	deploySafeAccount,
	encodeMultiSendCall,
	type SafeDeploymentConfig,
	V141_ADDRESSES,
} from "@volga/picosafe";
import { getSafeGenesisPath } from "@volga/safe-genesis";
import type { Address } from "viem";
import { setupClients } from "./setup.js";

/**
 * Example: Batch Safe Deployment with MultiSend
 *
 * Demonstrates PicoSafe's composability by deploying multiple Safe accounts
 * in a single transaction using the MultiSend contract. Shows how to:
 * - Use rawTransaction data from deploySafeAccount()
 * - Batch operations with encodeMultiSendCall()
 * - Deploy 5 different Safe configurations atomically
 */

await withAnvil(
	async (anvilInstance) => {
		const { walletClient, publicClient } = setupClients(anvilInstance.rpcUrl);

		// Define 5 different Safe configurations
		const safeConfigs: readonly SafeDeploymentConfig[] = [
			{
				owners: ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"],
				threshold: 1n,
				saltNonce: 100n,
			},
			{
				owners: [
					"0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
					"0x90F79bf6EB2c4f870365E785982E1f101E93b906",
					"0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
				],
				threshold: 2n,
				saltNonce: 200n,
			},
			{
				owners: [
					"0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
					"0x976EA74026E726554dB657fA54763abd0C3a0aa9",
					"0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
					"0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
					"0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
				],
				threshold: 3n,
				saltNonce: 300n,
			},
			{
				owners: [
					"0xBcd4042DE499D14e55001CcbB24a551F3b954096",
					"0x71bE63f3384f5fb98995898A86B02Fb2426c5788",
				],
				threshold: 2n,
				saltNonce: 400n,
			},
			{
				owners: ["0xFABB0ac9d68B0B445fB7357272Ff202C5651694a"],
				threshold: 1n,
				saltNonce: 12345678n,
			},
		] as const;

		// Calculate predicted addresses
		const predictedAddresses = safeConfigs.map((config) =>
			calculateSafeAddress(config),
		);
		console.log("Predicted Safe addresses:");
		predictedAddresses.forEach((address, i) => {
			console.log(`  Safe ${i + 1}: ${address}`);
		});

		// Prepare deployment transactions (but don't send them)
		const deployments = await Promise.all(
			safeConfigs.map((config) => deploySafeAccount(walletClient, config)),
		);

		// Extract raw transactions for batching
		const deploymentTransactions = deployments.map((deployment) => ({
			to: deployment.rawTransaction.to as Address,
			value: deployment.rawTransaction.value || 0n,
			data: deployment.rawTransaction.data as `0x${string}`,
		}));

		console.log(
			`Prepared ${deploymentTransactions.length} deployment transactions`,
		);

		// Encode for MultiSend
		const multiSendData = encodeMultiSendCall(deploymentTransactions);
		const multiSendAddress = V141_ADDRESSES.MultiSend;

		console.log("MultiSend contract:", multiSendAddress);
		console.log("Encoded data size:", multiSendData.length / 2, "bytes");

		// Gas estimation comparison
		const batchGasEstimate = await publicClient.estimateGas({
			account: walletClient.account,
			to: multiSendAddress,
			data: multiSendData,
		});

		console.log("Estimated gas for batch:", batchGasEstimate.toLocaleString());

		// Execute batch deployment
		const txHash = await walletClient.sendTransaction({
			to: multiSendAddress,
			data: multiSendData,
		});

		console.log("Transaction sent:", txHash);

		// Wait for confirmation
		const receipt = await publicClient.waitForTransactionReceipt({
			hash: txHash,
		});

		console.log("Block:", receipt.blockNumber);
		console.log("Gas used:", receipt.gasUsed.toLocaleString());

		// Verify all deployments
		const verifications = await Promise.all(
			predictedAddresses.map(async (address) => {
				const code = await publicClient.getCode({ address });
				return code && code !== "0x";
			}),
		);

		const allDeployed = verifications.every(Boolean);
		console.log("All Safes deployed successfully:", allDeployed);

		if (!allDeployed) {
			throw new Error("Some Safe deployments failed");
		}

		console.log(
			`✓ Deployed ${safeConfigs.length} Safe accounts atomically in one transaction`,
		);
	},
	{
		genesisPath: getSafeGenesisPath(),
	},
);
