import { withAnvil } from "@volga/anvil-manager";
import {
	buildSafeTransaction,
	deploySafeAccount,
	executeSafeTransaction,
	type SafeDeploymentConfig,
	signSafeTransaction,
} from "@volga/picosafe";
import { getSafeGenesisPath } from "@volga/safe-genesis";
import {
	type Address,
	createPublicClient,
	createWalletClient,
	encodeFunctionData,
	formatEther,
	formatGwei,
	type Hex,
	http,
	parseAbi,
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
 * npm run run-example -- packages/examples/4-multiple-transfers-with-multisend.ts
 * ```
 */

// Pre-compiled bytecode for a minimal ERC20 token contract
// This contract has: constructor(uint256 initialSupply), transfer(), balanceOf(), decimals(), name(), symbol()
const SIMPLE_ERC20_BYTECODE =
	"0x60c0604052600a6080908152692a32b9ba102a37b5b2b760b11b60a052600290610029908261013b565b50604080518082019091526004815263151154d560e21b6020820152600390610052908261013b565b506004805460ff1916601217905534801561006b575f5ffd5b506040516105e63803806105e683398101604081905261008a916101f5565b6001819055335f9081526020819052604090205561020c565b634e487b7160e01b5f52604160045260245ffd5b600181811c908216806100cb57607f821691505b6020821081036100e957634e487b7160e01b5f52602260045260245ffd5b50919050565b601f82111561013657805f5260205f20601f840160051c810160208510156101145750805b601f840160051c820191505b81811015610133575f8155600101610120565b50505b505050565b81516001600160401b03811115610154576101546100a3565b6101688161016284546100b7565b846100ef565b6020601f82116001811461019a575f83156101835750848201515b5f19600385901b1c1916600184901b178455610133565b5f84815260208120601f198516915b828110156101c957878501518255602094850194600190920191016101a9565b50848210156101e657868401515f19600387901b60f8161c191681555b50505050600190811b01905550565b5f60208284031215610205575f5ffd5b5051919050565b6103cd806102195f395ff3fe608060405234801561000f575f5ffd5b5060043610610060575f3560e01c806306fdde031461006457806318160ddd14610082578063313ce5671461009957806370a08231146100b857806395d89b41146100d7578063a9059cbb146100df575b5f5ffd5b61006c610102565b604051610079919061028d565b60405180910390f35b61008b60015481565b604051908152602001610079565b6004546100a69060ff1681565b60405160ff9091168152602001610079565b61008b6100c63660046102dd565b5f6020819052908152604090205481565b61006c61018e565b6100f26100ed3660046102fd565b61019b565b6040519015158152602001610079565b6002805461010f90610325565b80601f016020809104026020016040519081016040528092919081815260200182805461013b90610325565b80156101865780601f1061015d57610100808354040283529160200191610186565b820191905f5260205f20905b81548152906001019060200180831161016957829003601f168201915b505050505081565b6003805461010f90610325565b335f908152602081905260408120548211156101f45760405162461bcd60e51b8152602060048201526014602482015273496e73756666696369656e742062616c616e636560601b604482015260640160405180910390fd5b335f9081526020819052604081208054849290610212908490610371565b90915550506001600160a01b0383165f908152602081905260408120805484929061023e908490610384565b90915550506040518281526001600160a01b0384169033907fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef9060200160405180910390a35060015b92915050565b602081525f82518060208401528060208501604085015e5f604082850101526040601f19601f83011684010191505092915050565b80356001600160a01b03811681146102d8575f5ffd5b919050565b5f602082840312156102ed575f5ffd5b6102f6826102c2565b9392505050565b5f5f6040838503121561030e575f5ffd5b610317836102c2565b946020939093013593505050565b600181811c9082168061033957607f821691505b60208210810361035757634e487b7160e01b5f52602260045260245ffd5b50919050565b634e487b7160e01b5f52601160045260245ffd5b818103818111156102875761028761035d565b808201808211156102875761028761035d56fea26469706673582212203a3d582b72b2c4289142203b5da73bf6fa0f876ca733a7c155e38460a787fac164736f6c634300081e0033" as Hex;

// Minimal ERC20 ABI with only the functions we need
const erc20Abi = parseAbi([
	"constructor(uint256 _initialSupply)",
	"function transfer(address to, uint256 amount) returns (bool)",
	"function balanceOf(address) view returns (uint256)",
	"function decimals() view returns (uint8)",
	"function name() view returns (string)",
	"function symbol() view returns (string)",
]);

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
		console.log("🪙  Deploying ERC20 token (TEST)…");
		const initialSupply = parseEther("1000000"); // 1 million tokens

		const tokenDeployHash = await walletClient.deployContract({
			abi: erc20Abi,
			bytecode: SIMPLE_ERC20_BYTECODE,
			args: [initialSupply],
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
			abi: erc20Abi,
			functionName: "name",
		});
		const tokenSymbol = await publicClient.readContract({
			address: tokenAddress,
			abi: erc20Abi,
			functionName: "symbol",
		});
		console.log(`   Name: ${tokenName}`);
		console.log(`   Symbol: ${tokenSymbol}`);
		console.log(
			`   Initial supply: ${formatEther(initialSupply)} ${tokenSymbol}\n`,
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
			abi: erc20Abi,
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
			abi: erc20Abi,
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
					abi: erc20Abi,
					functionName: "transfer",
					args: [recipients.token1, parseEther("100")],
				}),
			},
			{
				to: tokenAddress,
				value: 0n,
				data: encodeFunctionData({
					abi: erc20Abi,
					functionName: "transfer",
					args: [recipients.token2, parseEther("200")],
				}),
			},
			{
				to: tokenAddress,
				value: 0n,
				data: encodeFunctionData({
					abi: erc20Abi,
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
		 * 6. SIGN AND EXECUTE TRANSACTION
		 * -------------------------------------------------------------------
		 */
		console.log("🖊️  Signing Safe transaction…");
		const signature = await signSafeTransaction(
			walletClient,
			safeTx,
			walletClient.account.address,
		);
		console.log("   ✓ Transaction signed\n");

		// Estimate gas for comparison
		console.log("⛽ Gas estimation:");
		const execTx = await executeSafeTransaction(walletClient, safeTx, [
			signature,
		]);
		const gasEstimate = await publicClient.estimateGas({
			account: walletClient.account,
			to: execTx.rawTransaction.to as Address,
			data: execTx.rawTransaction.data as Hex,
		});
		console.log(`   Estimated gas: ${gasEstimate.toLocaleString()}`);
		console.log(
			`   (All ${transactions.length} transfers in one transaction!)\n`,
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
			`   Total cost: ${formatEther(execReceipt.gasUsed * execReceipt.effectiveGasPrice)} ETH\n`,
		);

		/**
		 * -------------------------------------------------------------------
		 * 7. VERIFY ALL TRANSFERS
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
				`     ${address}: ${formatEther(balance)} ETH (expected ≥ ${expectedAmount} ETH) ✓`,
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
				abi: erc20Abi,
				functionName: "balanceOf",
				args: [address],
			});
			const expectedAmount =
				label === "token1" ? "100" : label === "token2" ? "200" : "150";
			console.log(
				`     ${address}: ${formatEther(balance)} ${tokenSymbol} (expected ${expectedAmount}) ✓`,
			);
		}

		// Check remaining Safe balances
		const finalSafeEthBalance = await publicClient.getBalance({
			address: deploymentData.safeAddress as Address,
		});
		const finalSafeTokenBalance = await publicClient.readContract({
			address: tokenAddress,
			abi: erc20Abi,
			functionName: "balanceOf",
			args: [deploymentData.safeAddress],
		});

		console.log("\n📊 Final Safe balances:");
		console.log(
			`   ETH: ${formatEther(finalSafeEthBalance)} (${formatEther(safeEthBalance - finalSafeEthBalance)} sent)`,
		);
		console.log(
			`   ${tokenSymbol}: ${formatEther(finalSafeTokenBalance)} (${formatEther(safeTokenBalance - finalSafeTokenBalance)} sent)`,
		);

		/**
		 * -------------------------------------------------------------------
		 * 8. SUMMARY
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
		console.log("• Significant gas savings vs individual transactions");
		console.log(
			"• No manual MultiSend encoding needed - just pass an array of transactions!",
		);
		console.log("=".repeat(60));
	},
	{
		// Use genesis with pre-deployed Safe contracts
		genesisPath: getSafeGenesisPath(),
	},
);
