import {
	buildSafeTransaction,
	executeSafeTransaction,
	signSafeTransaction,
} from "@volga/picosafe";
import { TestERC20Abi } from "@volga/test-contracts";
import { type Address, encodeFunctionData, type Hex, parseEther } from "viem";
import { withExampleScene } from "./example-scene.js";

/**
 * Example: Multiple Transfers with Automatic MultiSend
 *
 * Shows picosafe's automatic MultiSend handling when passing multiple transactions
 * to buildSafeTransaction(). Demonstrates batching ETH and ERC20 transfers in a
 * single atomic Safe transaction without manual MultiSend encoding.
 */

await withExampleScene(
	async (scene) => {
		const { walletClient, publicClient, safes, accounts, contracts } = scene;

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
				to: contracts.testToken,
				value: 0n,
				data: encodeFunctionData({
					abi: TestERC20Abi,
					functionName: "transfer",
					args: [recipients.token1, parseEther("100")],
				}),
			},
			{
				to: contracts.testToken,
				value: 0n,
				data: encodeFunctionData({
					abi: TestERC20Abi,
					functionName: "transfer",
					args: [recipients.token2, parseEther("200")],
				}),
			},
			{
				to: contracts.testToken,
				value: 0n,
				data: encodeFunctionData({
					abi: TestERC20Abi,
					functionName: "transfer",
					args: [recipients.token3, parseEther("150")],
				}),
			},
		];

		const safeTx = await buildSafeTransaction(
			walletClient,
			safes.singleOwner,
			transactions,
		);

		const signature = await signSafeTransaction(
			walletClient,
			safeTx,
			accounts.owner1.address,
		);

		const execTx = await executeSafeTransaction(walletClient, safeTx, [
			signature,
		]);

		const execHash = await execTx.send();
		await publicClient.waitForTransactionReceipt({
			hash: execHash,
		});

		console.log("MultiSend transaction executed:", execHash);
		console.log("✓ 6 transfers executed atomically in one Safe transaction");
	},
	{
		deployToken: true,
		fundSafesWithEth: "1", // Fund Safe with 1 ETH for the transfers
	},
);
