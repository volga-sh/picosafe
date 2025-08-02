import { withAnvil } from "@volga/anvil-manager";
import {
	calculateSafeAddress,
	deploySafeAccount,
	encodeMultiSendCall,
	type SafeDeploymentConfig,
	V141_ADDRESSES,
} from "@volga/picosafe";
import { getSafeGenesisPath } from "@volga/safe-genesis";
import {
	type Address,
	createPublicClient,
	createWalletClient,
	formatEther,
	formatGwei,
	http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

/**
 * Example demonstrating batch deployment of multiple Safe accounts in a single transaction
 * using the MultiSend contract. This showcases the power of PicoSafe's design where
 * functions return raw transaction data that can be composed together.
 *
 * This example:
 * 1. Prepares deployment data for 5 different Safe accounts with various configurations
 * 2. Uses the rawTransaction property from deploySafeAccount to get deployment transactions
 * 3. Batches all deployments through MultiSend contract
 * 4. Executes all deployments atomically in a single transaction
 * 5. Demonstrates significant gas savings compared to individual deployments
 *
 * Run with:
 * ```bash
 * # From repository root
 * npm run run-example -- packages/examples/3-batch-safe-deployment-with-multisend.ts
 * ```
 */

await withAnvil(
	async (anvilInstance) => {
		console.log(`🚀 Local Anvil started at ${anvilInstance.rpcUrl}`);
		console.log("   Using pre-deployed Safe contracts via genesis\n");

		// Use Anvil test accounts
		const DEPLOYER_PRIVATE_KEY =
			"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

		const walletClient = createWalletClient({
			chain: anvil,
			transport: http(anvilInstance.rpcUrl),
			account: privateKeyToAccount(DEPLOYER_PRIVATE_KEY),
		});

		const publicClient = createPublicClient({
			chain: anvil,
			transport: http(anvilInstance.rpcUrl),
		});

		/**
		 * -------------------------------------------------------------------
		 * 1. PREPARE MULTIPLE SAFE CONFIGURATIONS
		 * -------------------------------------------------------------------
		 */
		console.log("📋 Preparing 5 Safe account configurations:\n");

		// Different owner configurations for variety
		const safeConfigs: readonly SafeDeploymentConfig[] = [
			{
				// Safe 1: Single owner (simple wallet)
				owners: ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"],
				threshold: 1n,
				saltNonce: 100n,
			},
			{
				// Safe 2: 2-of-3 multisig (typical setup)
				owners: [
					"0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
					"0x90F79bf6EB2c4f870365E785982E1f101E93b906",
					"0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
				],
				threshold: 2n,
				saltNonce: 200n,
			},
			{
				// Safe 3: 3-of-5 multisig (high security)
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
				// Safe 4: 2-of-2 multisig (dual control)
				owners: [
					"0xBcd4042DE499D14e55001CcbB24a551F3b954096",
					"0x71bE63f3384f5fb98995898A86B02Fb2426c5788",
				],
				threshold: 2n,
				saltNonce: 400n,
			},
			{
				// Safe 5: Single owner with high salt nonce
				owners: ["0xFABB0ac9d68B0B445fB7357272Ff202C5651694a"],
				threshold: 1n,
				saltNonce: 12345678n,
			},
		] as const;

		// Calculate predicted addresses
		console.log("🔮 Predicted Safe addresses:");
		const predictedAddresses = safeConfigs.map((config, index) => {
			const address = calculateSafeAddress(config);
			console.log(`   Safe ${index + 1}: ${address}`);
			return address;
		});
		console.log();

		/**
		 * -------------------------------------------------------------------
		 * 2. PREPARE DEPLOYMENT TRANSACTIONS
		 * -------------------------------------------------------------------
		 */
		console.log("🛠️  Preparing deployment transactions...\n");

		// Prepare all deployments but don't send them
		const deployments = await Promise.all(
			safeConfigs.map(async (config) => {
				const deployment = await deploySafeAccount(walletClient, config);
				return deployment;
			}),
		);

		// Extract raw transactions from each deployment
		const deploymentTransactions = deployments.map((deployment) => ({
			to: deployment.rawTransaction.to as Address,
			value: deployment.rawTransaction.value || 0n,
			data: deployment.rawTransaction.data as `0x${string}`,
		}));

		console.log("📦 Deployment transactions prepared:");
		deploymentTransactions.forEach((tx, index) => {
			console.log(`   Safe ${index + 1}:`);
			console.log(`     To: ${tx.to}`);
			console.log(`     Data: ${tx.data.slice(0, 66)}...`);
		});
		console.log();

		/**
		 * -------------------------------------------------------------------
		 * 3. BATCH WITH MULTISEND
		 * -------------------------------------------------------------------
		 */
		console.log("🔗 Encoding batch deployment with MultiSend...\n");

		// Encode all deployments for MultiSend
		const multiSendData = encodeMultiSendCall(deploymentTransactions);

		// Create the MultiSend transaction
		const multiSendAddress = V141_ADDRESSES.MultiSend;
		console.log(`   MultiSend contract: ${multiSendAddress}`);
		console.log(`   Batched ${deploymentTransactions.length} deployments`);
		console.log(`   Encoded data size: ${multiSendData.length / 2} bytes\n`);

		/**
		 * -------------------------------------------------------------------
		 * 4. GAS ESTIMATION & SAVINGS ANALYSIS
		 * -------------------------------------------------------------------
		 */
		console.log("💰 Gas Estimation & Savings Analysis:");
		console.log("   ═══════════════════════════════════\n");

		// Estimate individual deployment costs
		const individualGasEstimates = await Promise.all(
			deployments.map(async (deployment) => {
				const estimate = await publicClient.estimateGas({
					account: walletClient.account,
					to: deployment.rawTransaction.to,
					data: deployment.rawTransaction.data,
				});
				return estimate;
			}),
		);

		const totalIndividualGas = individualGasEstimates.reduce(
			(sum, gas) => sum + gas,
			0n,
		);

		// Estimate batch deployment cost
		const batchGasEstimate = await publicClient.estimateGas({
			account: walletClient.account,
			to: multiSendAddress,
			data: multiSendData,
		});

		const estimatedGasSaved = totalIndividualGas - batchGasEstimate;
		const estimatedPercentSaved = Number(
			(estimatedGasSaved * 100n) / totalIndividualGas,
		);

		console.log(
			`   Individual deployments (estimated): ${totalIndividualGas.toLocaleString()} gas`,
		);
		console.log(
			`   Batch deployment (estimated): ${batchGasEstimate.toLocaleString()} gas`,
		);
		console.log(
			`   Estimated gas savings: ${estimatedGasSaved.toLocaleString()} gas (${estimatedPercentSaved.toFixed(1)}%)\n`,
		);

		/**
		 * -------------------------------------------------------------------
		 * 5. EXECUTE BATCH DEPLOYMENT
		 * -------------------------------------------------------------------
		 */
		console.log("🚀 Executing batch deployment...\n");

		// Send the MultiSend transaction
		const txHash = await walletClient.sendTransaction({
			to: multiSendAddress,
			data: multiSendData,
		});

		console.log(`   Transaction hash: ${txHash}`);
		console.log("   ⏳ Waiting for confirmation...\n");

		// Wait for transaction confirmation
		const receipt = await publicClient.waitForTransactionReceipt({
			hash: txHash,
		});

		console.log("✅ Batch deployment completed!");
		console.log(`   Block: ${receipt.blockNumber}`);
		console.log(`   Actual gas used: ${receipt.gasUsed.toLocaleString()}`);
		console.log(
			`   Effective gas price: ${formatGwei(receipt.effectiveGasPrice)} gwei`,
		);
		console.log(
			`   Total cost: ${formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} ETH\n`,
		);

		/**
		 * -------------------------------------------------------------------
		 * 6. VERIFY DEPLOYMENTS
		 * -------------------------------------------------------------------
		 */
		console.log("🔍 Verifying all Safe deployments...\n");

		await Promise.all(
			predictedAddresses.map(async (address, i) => {
				if (!address) return;
				const code = await publicClient.getCode({
					address,
				});
				const isDeployed = code && code !== "0x";
				if (!isDeployed) {
					throw new Error(`Safe ${i + 1} (${address}) not deployed!`);
				}

				console.log(`   Safe ${i + 1} (${address}): ✅ Deployed`);
			}),
		);

		console.log("\n🎉 All Safes deployed successfully");

		/**
		 * -------------------------------------------------------------------
		 * 7. FINAL SUMMARY
		 * -------------------------------------------------------------------
		 */
		console.log("\n📝 Summary:");
		console.log(
			`   • Deployed ${safeConfigs.length} Safe accounts in 1 transaction`,
		);
		console.log(
			`   • Saved ~${estimatedPercentSaved.toFixed(0)}% on gas costs`,
		);
		console.log("   • All deployments succeeded atomically");
		console.log(
			"   • Demonstrates composability of PicoSafe's rawTransaction design",
		);

		// Show actual vs estimated gas usage
		const actualVsEstimatedDiff = Number(
			((receipt.gasUsed - batchGasEstimate) * 100n) / batchGasEstimate,
		);
		console.log(
			`\n   💡 Actual gas used was ${actualVsEstimatedDiff > 0 ? "+" : ""}${actualVsEstimatedDiff.toFixed(1)}% ${actualVsEstimatedDiff > 0 ? "higher" : "lower"} than estimated`,
		);
	},
	{
		// Use genesis with pre-deployed Safe contracts
		genesisPath: getSafeGenesisPath(),
	},
);
