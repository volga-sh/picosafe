import {
	type Account,
	type Chain,
	createPublicClient,
	createWalletClient,
	http,
	type PublicClient,
	type Transport,
	type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

/**
 * Standard Viem client setup for examples - not PicoSafe specific
 *
 * This is standard blockchain client configuration that any Ethereum
 * application needs. The actual PicoSafe functionality begins after
 * these clients are created.
 */
export function setupClients(rpcUrl: string): {
	walletClient: WalletClient<Transport, Chain, Account>;
	publicClient: PublicClient;
} {
	// Using Anvil's well-known test private key - safe only for testing
	const OWNER_PRIVATE_KEY =
		"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

	const walletClient = createWalletClient({
		chain: anvil,
		transport: http(rpcUrl),
		account: privateKeyToAccount(OWNER_PRIVATE_KEY),
	});

	const publicClient = createPublicClient({
		chain: anvil,
		transport: http(rpcUrl),
	});

	return { walletClient, publicClient };
}
