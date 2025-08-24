import { TestERC20Abi, TestERC20Bytecode } from "@volga/test-contracts";
import {
	type Account,
	type Address,
	type Chain,
	encodeFunctionData,
	type Hex,
	type PublicClient,
	parseEther,
	type Transport,
	type WalletClient,
} from "viem";

/**
 * Helper function to deploy and fund a test ERC20 token
 */
export async function setupTestToken(
	walletClient: WalletClient<Transport, Chain, Account>,
	publicClient: PublicClient,
	safeAddress: Address,
): Promise<Address> {
	if (!walletClient.account) {
		throw new Error("WalletClient must have an account");
	}

	// Deploy token
	const deployHash = await walletClient.deployContract({
		abi: TestERC20Abi,
		bytecode: TestERC20Bytecode as Hex,
	});

	const receipt = await publicClient.waitForTransactionReceipt({
		hash: deployHash,
	});
	const tokenAddress = receipt.contractAddress;

	if (!tokenAddress) {
		throw new Error("Token deployment failed");
	}

	// Fund Safe with tokens
	const fundHash = await walletClient.sendTransaction({
		to: tokenAddress,
		data: encodeFunctionData({
			abi: TestERC20Abi,
			functionName: "transfer",
			args: [safeAddress, parseEther("10000")],
		}),
	});
	await publicClient.waitForTransactionReceipt({ hash: fundHash });

	return tokenAddress;
}

/**
 * Helper function to verify transfers completed successfully
 */
export async function verifyTransfers(
	publicClient: PublicClient,
	recipients: Record<string, Address>,
	tokenAddress: Address,
): Promise<boolean> {
	// Check ETH balances (safely handle undefined)
	const ethRecipients = [
		recipients.eth1,
		recipients.eth2,
		recipients.eth3,
	].filter((addr): addr is Address => addr !== undefined);
	const ethBalances = await Promise.all(
		ethRecipients.map((address) => publicClient.getBalance({ address })),
	);

	// Check token balances (safely handle undefined)
	const tokenRecipients = [
		recipients.token1,
		recipients.token2,
		recipients.token3,
	].filter((addr): addr is Address => addr !== undefined);
	const tokenBalances = await Promise.all(
		tokenRecipients.map((address) =>
			publicClient.readContract({
				address: tokenAddress,
				abi: TestERC20Abi,
				functionName: "balanceOf",
				args: [address],
			}),
		),
	);

	// Simple verification - check if transfers occurred
	const ethTransfersOk = ethBalances.every((balance) => balance > 0n);
	const tokenTransfersOk = tokenBalances.every((balance) => balance > 0n);

	return ethTransfersOk && tokenTransfersOk;
}
