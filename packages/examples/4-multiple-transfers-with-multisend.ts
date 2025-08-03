import { withAnvil } from "@volga/anvil-manager";
import {
	buildSafeTransaction,
	deploySafeAccount,
	executeSafeTransaction,
	type SafeDeploymentConfig,
	signSafeTransaction,
} from "@volga/picosafe";
import { getSafeGenesisPath } from "@volga/safe-genesis";
import { TestERC20Abi, TestERC20Bytecode } from "@volga/test-contracts";
import {
	type Address,
	createPublicClient,
	createWalletClient,
	encodeFunctionData,
	formatEther,
	formatGwei,
	type Hex,
	http,
	parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

/**
 * Example demonstrating multiple transfers (ETH and ERC20) in a single Safe transaction.
 *
 * This example showcases:
 * 1. Deploying a Safe account
 * 2. Deploying a simple ERC20 token for testing
 * 3. Funding the Safe with ETH and tokens
 * 4. Creating multiple transfers (both ETH and ERC20) in a single batch
 * 5. Using buildSafeTransaction which automatically handles MultiSend for multiple transactions
 * 6. Executing all transfers atomically in one transaction
 *
 * The beauty of PicoSafe is that you don't need to manually encode MultiSend calls.
 * Simply pass an array of transactions to buildSafeTransaction and it handles the complexity.
 *
 * Run with:
 * ```bash
 * # From repository root
 * npm run run-example -w @volga/examples -- 4-multiple-transfers-with-multisend.ts
 * ```
 */

await withAnvil(
	async (anvilInstance) => {
		console.log(`🚀 Local Anvil started at ${anvilInstance.rpcUrl}`);
		console.log("   Using pre-deployed Safe contracts via genesis\n");

		// Use Anvil test accounts
		const OWNER_PRIVATE_KEY =
			"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

		const walletClient = createWalletClient({
			chain: anvil,
			transport: http(anvilInstance.rpcUrl),
			account: privateKeyToAccount(OWNER_PRIVATE_KEY),
		});

		const publicClient = createPublicClient({
			chain: anvil,
			transport: http(anvilInstance.rpcUrl),
		});

		/**
		 * -------------------------------------------------------------------
		 * 1. DEPLOY SAFE ACCOUNT
		 * -------------------------------------------------------------------
		 */
		const deploymentConfig: SafeDeploymentConfig = {
			owners: [walletClient.account.address],
			threshold: 1n,
		};

		console.log("📋 Safe Deployment Configuration:");
		console.log(`   Owner:     ${walletClient.account.address}`);
		console.log(`   Threshold: ${deploymentConfig.threshold}`);
		console.log();

		const { send: sendDeploymentTx, data: deploymentData } =
			await deploySafeAccount(walletClient, deploymentConfig);

		console.log("⏳ Deploying Safe account…");
		const deploymentHash = await sendDeploymentTx();
		await publicClient.waitForTransactionReceipt({ hash: deploymentHash });
		console.log("✅ Safe deployed at:");
		console.log(`   ${deploymentData.safeAddress}\n`);

		/**
		 * -------------------------------------------------------------------
		 * 2. DEPLOY ERC20 TOKEN
		 * -------------------------------------------------------------------
		 */
		console.log("🪙  Deploying ERC20 token (TEST)…\n");

		const tokenDeployHash = await walletClient.deployContract({
			abi: TestERC20Abi,
			bytecode: TestERC20Bytecode as Hex,
		});

		const tokenReceipt = await publicClient.waitForTransactionReceipt({
			hash: tokenDeployHash,
		});
		const tokenAddress = tokenReceipt.contractAddress;

		if (!tokenAddress) {
			throw new Error("Token deployment failed");
		}

		console.log(`✅ Token deployed at: ${tokenAddress}`);

		// Verify token details
		const tokenName = await publicClient.readContract({
			address: tokenAddress,
			abi: TestERC20Abi,
			functionName: "name",
		});
		const tokenSymbol = await publicClient.readContract({
			address: tokenAddress,
			abi: TestERC20Abi,
			functionName: "symbol",
		});
		console.log(`   Name: ${tokenName}`);
		console.log(`   Symbol: ${tokenSymbol}`);

		// Check initial balance (minted in constructor)
		const ownerBalance = await publicClient.readContract({
			address: tokenAddress,
			abi: TestERC20Abi,
			functionName: "balanceOf",
			args: [walletClient.account.address],
		});
		console.log(
			`   Initial owner balance: ${formatEther(ownerBalance)} ${tokenSymbol}\n`,
		);

		/**
		 * -------------------------------------------------------------------
		 * 3. FUND THE SAFE
		 * -------------------------------------------------------------------
		 */
		console.log("💰 Funding Safe with ETH and tokens…");

		// Fund with ETH
		const ethAmount = parseEther("1");
		const fundEthHash = await walletClient.sendTransaction({
			to: deploymentData.safeAddress,
			value: ethAmount,
		});
		await publicClient.waitForTransactionReceipt({ hash: fundEthHash });
		console.log(`   ✓ Sent ${formatEther(ethAmount)} ETH to Safe`);

		// Fund with tokens
		const tokenAmount = parseEther("10000"); // 10,000 tokens
		const fundTokensData = encodeFunctionData({
			abi: TestERC20Abi,
			functionName: "transfer",
			args: [deploymentData.safeAddress, tokenAmount],
		});

		const fundTokensHash = await walletClient.sendTransaction({
			to: tokenAddress,
			data: fundTokensData,
		});
		await publicClient.waitForTransactionReceipt({ hash: fundTokensHash });
		console.log(
			`   ✓ Sent ${formatEther(tokenAmount)} ${tokenSymbol} to Safe\n`,
		);

		// Verify Safe balances
		const safeEthBalance = await publicClient.getBalance({
			address: deploymentData.safeAddress as Address,
		});
		const safeTokenBalance = await publicClient.readContract({
			address: tokenAddress,
			abi: TestERC20Abi,
			functionName: "balanceOf",
			args: [deploymentData.safeAddress],
		});

		console.log("📊 Safe balances:");
		console.log(`   ETH: ${formatEther(safeEthBalance)}`);
		console.log(`   ${tokenSymbol}: ${formatEther(safeTokenBalance)}\n`);

		/**
		 * -------------------------------------------------------------------
		 * 4. PREPARE MULTIPLE TRANSFERS
		 * -------------------------------------------------------------------
		 */
		console.log("🔄 Preparing multiple transfers…\n");

		// Define recipients (using other Anvil test accounts)
		const recipients = {
			eth1: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
			eth2: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address,
			eth3: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address,
			token1: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as Address,
			token2: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc" as Address,
			token3: "0x976EA74026E726554dB657fA54763abd0C3a0aa9" as Address,
		};

		// Create array of transactions for batch execution
		const transactions = [
			// Native ETH transfers
			{
				to: recipients.eth1,
				value: parseEther("0.1"),
				data: "0x" as Hex,
			},
			{
				to: recipients.eth2,
				value: parseEther("0.15"),
				data: "0x" as Hex,
			},
			{
				to: recipients.eth3,
				value: parseEther("0.2"),
				data: "0x" as Hex,
			},
			// ERC20 token transfers
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

		console.log("📝 Transfer details:");
		console.log("   ETH transfers:");
		console.log(`     → ${recipients.eth1}: 0.1 ETH`);
		console.log(`     → ${recipients.eth2}: 0.15 ETH`);
		console.log(`     → ${recipients.eth3}: 0.2 ETH`);
		console.log(`   ${tokenSymbol} transfers:`);
		console.log(`     → ${recipients.token1}: 100 ${tokenSymbol}`);
		console.log(`     → ${recipients.token2}: 200 ${tokenSymbol}`);
		console.log(`     → ${recipients.token3}: 150 ${tokenSymbol}`);
		console.log();

		/**
		 * -------------------------------------------------------------------
		 * 5. BUILD SAFE TRANSACTION (AUTOMATIC MULTISEND)
		 * -------------------------------------------------------------------
		 */
		console.log("🛠️  Building Safe transaction with automatic MultiSend…");
		console.log(`   Batching ${transactions.length} transactions into one`);

		// buildSafeTransaction automatically uses MultiSend when given multiple transactions
		const safeTx = await buildSafeTransaction(
			walletClient,
			deploymentData.safeAddress as Address,
			transactions,
		);

		// When multiple transactions are provided, buildSafeTransaction:
		// 1. Automatically uses MultiSendCallOnly contract
		// 2. Encodes all transactions for batched execution
		// 3. Sets the operation to DELEGATECALL
		console.log("   ✓ MultiSend automatically configured");
		console.log("   ✓ Target: MultiSendCallOnly (via delegatecall)");
		console.log(`   ✓ Nonce: ${safeTx.nonce}\n`);

		/**
		 * -------------------------------------------------------------------
		 * 6. GAS SAVINGS ANALYSIS
		 * -------------------------------------------------------------------
		 */
		console.log("💰 Gas Savings Analysis:");
		console.log("   ═══════════════════════════════════\n");

		// Estimate individual transaction costs
		console.log("   Estimating individual transaction costs...");
		const individualGasEstimates = await Promise.all(
			transactions.map(async (tx) => {
				const estimate = await publicClient.estimateGas({
					account: deploymentData.safeAddress as Address,
					to: tx.to,
					data: tx.data,
					value: tx.value,
				});
				return estimate;
			}),
		);

		const totalIndividualGas = individualGasEstimates.reduce(
			(sum, gas) => sum + gas,
			0n,
		);

		console.log(
			`   Individual transactions: ${totalIndividualGas.toLocaleString()} gas total`,
		);
		individualGasEstimates.forEach((gas, i) => {
			if (i < 3) {
				console.log(
					`     - ETH transfer ${i + 1}: ${gas.toLocaleString()} gas`,
				);
			} else {
				console.log(
					`     - Token transfer ${i - 2}: ${gas.toLocaleString()} gas`,
				);
			}
		});

		/**
		 * -------------------------------------------------------------------
		 * 7. SIGN AND EXECUTE TRANSACTION
		 * -------------------------------------------------------------------
		 */
		console.log("\n🖊️  Signing Safe transaction…");
		const signature = await signSafeTransaction(
			walletClient,
			safeTx,
			walletClient.account.address,
		);
		console.log("   ✓ Transaction signed\n");

		// Estimate batched transaction gas
		console.log("⛽ Batched transaction estimation:");
		const execTx = await executeSafeTransaction(walletClient, safeTx, [
			signature,
		]);
		const batchGasEstimate = await publicClient.estimateGas({
			account: walletClient.account,
			to: execTx.rawTransaction.to as Address,
			data: execTx.rawTransaction.data as Hex,
		});

		const estimatedGasSaved = totalIndividualGas - batchGasEstimate;
		const estimatedPercentSaved = Number(
			(estimatedGasSaved * 100n) / totalIndividualGas,
		);

		console.log(
			`   Batch transaction: ${batchGasEstimate.toLocaleString()} gas`,
		);
		console.log(
			`   Estimated savings: ${estimatedGasSaved.toLocaleString()} gas (${estimatedPercentSaved.toFixed(1)}% saved)`,
		);
		console.log(
			`   All ${transactions.length} transfers in one transaction!\n`,
		);

		console.log("🚀 Executing batched Safe transaction…");
		const execHash = await execTx.send();
		const execReceipt = await publicClient.waitForTransactionReceipt({
			hash: execHash,
		});

		console.log("✅ All transfers executed successfully!");
		console.log(`   Transaction hash: ${execHash}`);
		console.log(`   Gas used: ${execReceipt.gasUsed.toLocaleString()}`);
		console.log(
			`   Gas price: ${formatGwei(execReceipt.effectiveGasPrice)} gwei`,
		);
		console.log(
			`   Total cost: ${formatEther(
				execReceipt.gasUsed * execReceipt.effectiveGasPrice,
			)}
`,
		);

		/**
		 * -------------------------------------------------------------------
		 * 8. VERIFY ALL TRANSFERS
		 * -------------------------------------------------------------------
		 */
		console.log("🔍 Verifying all transfers completed…\n");

		// Check ETH balances
		console.log("   ETH recipient balances:");
		for (const [label, address] of Object.entries({
			eth1: recipients.eth1,
			eth2: recipients.eth2,
			eth3: recipients.eth3,
		})) {
			const balance = await publicClient.getBalance({ address });
			const expectedAmount =
				label === "eth1" ? "0.1" : label === "eth2" ? "0.15" : "0.2";
			console.log(
				`     ${address}: ${formatEther(
					balance,
				)} ETH (expected ≥ ${expectedAmount} ETH) ✓`,
			);
		}

		// Check token balances
		console.log(`\n   ${tokenSymbol} recipient balances:`);
		for (const [label, address] of Object.entries({
			token1: recipients.token1,
			token2: recipients.token2,
			token3: recipients.token3,
		})) {
			const balance = await publicClient.readContract({
				address: tokenAddress,
				abi: TestERC20Abi,
				functionName: "balanceOf",
				args: [address],
			});
			const expectedAmount =
				label === "token1" ? "100" : label === "token2" ? "200" : "150";
			console.log(
				`     ${address}: ${formatEther(
					balance,
				)} ${tokenSymbol} (expected ${expectedAmount}) ✓`,
			);
		}

		// Check remaining Safe balances
		const finalSafeEthBalance = await publicClient.getBalance({
			address: deploymentData.safeAddress as Address,
		});
		const finalSafeTokenBalance = await publicClient.readContract({
			address: tokenAddress,
			abi: TestERC20Abi,
			functionName: "balanceOf",
			args: [deploymentData.safeAddress],
		});

		console.log("\n📊 Final Safe balances:");
		console.log(
			`   ETH: ${formatEther(finalSafeEthBalance)} (${formatEther(
				safeEthBalance - finalSafeEthBalance,
			)} sent)`,
		);
		console.log(
			`   ${tokenSymbol}: ${formatEther(finalSafeTokenBalance)} (${formatEther(
				safeTokenBalance - finalSafeTokenBalance,
			)} sent)`,
		);

		/**
		 * -------------------------------------------------------------------
		 * 9. SUMMARY
		 * -------------------------------------------------------------------
		 */
		console.log(`\n${"=".repeat(60)}`);
		console.log("🎉 Example completed successfully!\n");
		console.log("Key takeaways:");
		console.log(
			"• Executed 6 transfers (3 ETH + 3 ERC20) in a single transaction",
		);
		console.log(
			"• buildSafeTransaction automatically handled MultiSend encoding",
		);
		console.log("• All transfers were atomic - they all succeed or all fail");
		console.log(
			`• Saved ~${estimatedPercentSaved.toFixed(0)}% on gas costs vs individual transactions`,
		);
		console.log(
			"• No manual MultiSend encoding needed - just pass an array of transactions!",
		);

		// Show actual vs estimated gas usage
		const actualVsEstimatedDiff = Number(
			((execReceipt.gasUsed - batchGasEstimate) * 100n) / batchGasEstimate,
		);
		console.log(
			`\n   💡 Actual gas used was ${actualVsEstimatedDiff > 0 ? "+" : ""}${actualVsEstimatedDiff.toFixed(1)}% ${actualVsEstimatedDiff > 0 ? "higher" : "lower"} than estimated`,
		);

		console.log("=".repeat(60));
	},
	{
		// Use genesis with pre-deployed Safe contracts
		genesisPath: getSafeGenesisPath(),
	},
);
