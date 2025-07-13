import type {
	Account,
	Address,
	Chain,
	Hex,
	PublicClient,
	TestClient,
	Transport,
	WalletClient,
} from "viem";
import {
	createPublicClient,
	createTestClient,
	createWalletClient,
	http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

const ANVIL_DEFAULT_ACCOUNTS = [
	{
		address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
		privateKey:
			"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex,
	},
	{
		address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
		privateKey:
			"0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex,
	},
	{
		address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address,
		privateKey:
			"0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex,
	},
	{
		address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address,
		privateKey:
			"0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex,
	},
	{
		address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as Address,
		privateKey:
			"0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" as Hex,
	},
] as const;

type TupleOf<
	T,
	N extends number,
	R extends unknown[] = [],
> = R["length"] extends N ? R : TupleOf<T, N, [...R, T]>;

/**
 * Creates viem clients for interacting with the local Anvil blockchain.
 *
 * @returns An object containing the test client, public client, and wallet clients
 * @returns {TestClient} testClient - Client for Anvil-specific test operations
 * @returns {PublicClient} publicClient - Client for reading blockchain state
 * @returns {WalletClient[]} walletClients - Array of wallet clients for each test account
 *
 * @throws {Error} If unable to connect to Anvil at http://127.0.0.1:8545
 *
 * @example
 * import { createClients } from './setup';
 *
 * const { testClient, publicClient, walletClients } = createClients();
 * const snapshotId = await testClient.snapshot();
 */
function createClients(): {
	testClient: TestClient;
	publicClient: PublicClient;
	walletClients: TupleOf<WalletClient<Transport, Chain, Account>, 5>;
} {
	const transport = http("http://127.0.0.1:8545");

	const testClient = createTestClient({
		chain: anvil,
		mode: "anvil",
		transport,
		// Disable caching to ensure fresh data in tests
		cacheTime: 0,
	});

	const publicClient = createPublicClient({
		chain: anvil,
		transport,
		// Disable caching to ensure fresh data in tests
		cacheTime: 0,
	});

	const walletClients = ANVIL_DEFAULT_ACCOUNTS.map((account) =>
		createWalletClient({
			account: privateKeyToAccount(account.privateKey),
			chain: anvil,
			transport,
			// Disable caching to ensure fresh data in tests
			cacheTime: 0,
		}),
	);

	return {
		testClient,
		publicClient,
		// Type assertion rationale:
		// The following coercion to TupleOf<WalletClient<Transport, Chain, Account>, 5> is safe because:
		// 1. ANVIL_DEFAULT_ACCOUNTS is a readonly array of exactly 5 elements
		// 2. Each client is created with an account from privateKeyToAccount()
		// 3. TypeScript does not preserve tuple length through .map()
		// If the number of default accounts ever changes, update the TupleOf type accordingly.
		// TODO(types): Remove this assertion if TypeScript gains better tuple inference for .map(), or refactor to enforce tuple length at compile time.
		walletClients: walletClients as unknown as TupleOf<
			WalletClient<Transport, Chain, Account>,
			5
		>,
	};
}

/**
 * Funds multiple addresses with ETH on the test blockchain.
 *
 * @param testClient - The Anvil test client to use for setting balances
 * @param addresses - Array of addresses to fund
 * @param amount - Amount of ETH to fund each address with (default: 1 ETH)
 *
 * @throws {Error} If unable to set balance for any address
 *
 * @example
 * import { type TestClient } from 'viem';
 * import { fundAccounts } from './setup';
 *
 * await fundAccounts(testClient, ["0x123...", "0x456..."], 5n * 10n ** 18n);
 */
async function fundAccounts(
	testClient: TestClient,
	addresses: Address[],
	amount = 10n ** 18n,
): Promise<void> {
	for (const address of addresses) {
		await testClient.setBalance({
			address,
			value: amount,
		});
	}
}

/**
 * Creates a blockchain state snapshot and returns a function to revert to it.
 * Useful for test isolation by allowing state reset between tests.
 *
 * @param testClient - The Anvil test client to use for snapshots
 * @returns A function that when called, reverts the blockchain to the snapshot
 *
 * @throws {Error} If unable to create snapshot or revert to it
 *
 * @example
 * import { type TestClient } from 'viem';
 * import { snapshot } from './setup';
 *
 * const revert = await snapshot(testClient);
 * // ... perform test operations ...
 * await revert(); // Reset blockchain state
 */
async function snapshot(testClient: TestClient): Promise<() => Promise<void>> {
	const id = await testClient.snapshot();
	return async () => {
		await testClient.revert({ id });
	};
}

export { createClients, fundAccounts, snapshot };
