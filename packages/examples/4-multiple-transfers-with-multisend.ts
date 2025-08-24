import { withAnvil } from "@volga/anvil-manager";
import {
	buildSafeTransaction,
	deploySafeAccount,
	executeSafeTransaction,
	type SafeDeploymentConfig,
	signSafeTransaction,
} from "@volga/picosafe";
import { getSafeGenesisPath } from "@volga/safe-genesis";
import { TestERC20Abi } from "@volga/test-contracts";
import { type Address, encodeFunctionData, type Hex, parseEther } from "viem";
import { setupTestToken, verifyTransfers } from "./helpers.js";
import { setupClients } from "./setup.js";

/**
 * Example: Multiple Transfers with Automatic MultiSend
 *
 * Shows PicoSafe's automatic MultiSend handling when passing multiple transactions
 * to buildSafeTransaction(). Demonstrates batching ETH and ERC20 transfers in a
 * single atomic Safe transaction without manual MultiSend encoding.
 */

await withAnvil(
	async (anvilInstance) => {
		const { walletClient, publicClient } = setupClients(anvilInstance.rpcUrl);

		// 1. Deploy Safe
		const deploymentConfig: SafeDeploymentConfig = {
			owners: [walletClient.account.address],
			threshold: 1n,
		};

		const { send: sendDeploymentTx, data: deploymentData } =
			await deploySafeAccount(walletClient, deploymentConfig);

		const deploymentHash = await sendDeploymentTx();
		await publicClient.waitForTransactionReceipt({ hash: deploymentHash });
		console.log("Safe deployed at:", deploymentData.safeAddress);

		// 2. Fund Safe with ETH
		const fundEthHash = await walletClient.sendTransaction({
			to: deploymentData.safeAddress,
			value: parseEther("1"),
		});
		await publicClient.waitForTransactionReceipt({ hash: fundEthHash });

		// 3. Setup test token (deploy and fund Safe)
		const tokenAddress = await setupTestToken(
			walletClient,
			publicClient,
			deploymentData.safeAddress as Address,
		);

		console.log("Safe funded with ETH and tokens");

		// 4. Create multiple transfers (3 ETH + 3 token transfers)
		const recipients = {
			eth1: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
			eth2: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address,
			eth3: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address,
			token1: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as Address,
			token2: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc" as Address,
			token3: "0x976EA74026E726554dB657fA54763abd0C3a0aa9" as Address,
		};

		const transactions = [
			// ETH transfers
			{ to: recipients.eth1, value: parseEther("0.1"), data: "0x" as Hex },
			{ to: recipients.eth2, value: parseEther("0.15"), data: "0x" as Hex },
			{ to: recipients.eth3, value: parseEther("0.2"), data: "0x" as Hex },
			// Token transfers
			{
				to: tokenAddress,
				value: 0n,
				data: encodeFunctionData({
					abi: TestERC20Abi,
					functionName: "transfer",
					args: [recipients.token1, parseEther("100")],
				}),
			},
			{
				to: tokenAddress,
				value: 0n,
				data: encodeFunctionData({
					abi: TestERC20Abi,
					functionName: "transfer",
					args: [recipients.token2, parseEther("200")],
				}),
			},
			{
				to: tokenAddress,
				value: 0n,
				data: encodeFunctionData({
					abi: TestERC20Abi,
					functionName: "transfer",
					args: [recipients.token3, parseEther("150")],
				}),
			},
		];

		console.log(`Prepared ${transactions.length} transfers:`);
		console.log("  - 0.1 ETH + 0.15 ETH + 0.2 ETH");
		console.log("  - 100 + 200 + 150 tokens");

		// 5. Build Safe transaction (automatically uses MultiSend for multiple txs)
		const safeTx = await buildSafeTransaction(
			walletClient,
			deploymentData.safeAddress as Address,
			transactions,
		);

		console.log("Safe transaction built with automatic MultiSend");
		console.log("Nonce:", safeTx.nonce);

		// 6. Sign and execute
		const signature = await signSafeTransaction(
			walletClient,
			safeTx,
			walletClient.account.address,
		);

		console.log("Transaction signed");

		const execTx = await executeSafeTransaction(walletClient, safeTx, [
			signature,
		]);

		const execHash = await execTx.send();
		const execReceipt = await publicClient.waitForTransactionReceipt({
			hash: execHash,
		});

		console.log("Transaction executed:", execHash);
		console.log("Gas used:", execReceipt.gasUsed.toLocaleString());

		// 7. Verify transfers completed
		const transfersVerified = await verifyTransfers(
			publicClient,
			recipients,
			tokenAddress,
		);

		console.log("✓ All transfers completed:", transfersVerified);
		console.log("✓ 6 transfers executed atomically in one Safe transaction");
	},
	{
		genesisPath: getSafeGenesisPath(),
	},
);
