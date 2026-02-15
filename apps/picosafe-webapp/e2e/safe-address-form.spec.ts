import { expect, type Page, test } from "@playwright/test";
import { withAnvil } from "@volga/anvil-manager";
import { deploySafeAccount } from "@volga/picosafe";
import { getSafeGenesisPath } from "@volga/safe-genesis";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { installAnvilInjectedProvider } from "./anvil-injected-wallet";

/**
 * E2E tests for Safe loading and dashboard rendering.
 */

/**
 * Anvil's first default account.
 */
const ANVIL_TEST_PRIVATE_KEY =
	"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const INVALID_SAFE_ADDRESSES = [
	"0x123", // too short
	"123456", // missing 0x prefix
	"0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG", // invalid hex chars
	"", // empty
];

const safeAddressInput = (page: Page) =>
	page.getByRole("textbox", { name: /safe address/i });
const networkInput = (page: Page) =>
	page.getByRole("textbox", { name: /network/i });
const submitButton = (page: Page) =>
	page.getByRole("button", { name: /open safe details/i });

const connectWalletButton = (page: Page) =>
	page.getByRole("button", { name: /connect wallet/i });

const detectedWalletButton = (page: Page) =>
	page.getByRole("button", { name: /detected wallet/i });

const ensureWalletConnected = async (page: Page) => {
	if (await connectWalletButton(page).isVisible().catch(() => false)) {
		await connectWalletButton(page).click();
		await expect(detectedWalletButton(page)).toBeVisible({ timeout: 5000 });
		await detectedWalletButton(page).click();
	}

	await expect(safeAddressInput(page)).toBeVisible({ timeout: 10000 });
};

test.describe("Safe Address form", () => {
	test("loads a valid Safe and shows expected dashboard sections", async ({
		page,
	}) => {
		await withAnvil(
			async (anvilInstance) => {
				const testAccount = privateKeyToAccount(ANVIL_TEST_PRIVATE_KEY);

				const walletClient = createWalletClient({
					chain: anvil,
					transport: http(anvilInstance.rpcUrl),
					account: testAccount,
				});

				const publicClient = createPublicClient({
					chain: anvil,
					transport: http(anvilInstance.rpcUrl),
				});

				const safe = await deploySafeAccount(walletClient, {
					owners: [testAccount.address],
					threshold: 1n,
				});

				const txHash = await safe.send();
				await publicClient.waitForTransactionReceipt({ hash: txHash });
				const safeAddress = safe.data.safeAddress;
				const [expectedOwner] = safe.data.deploymentConfig.owners;

				await installAnvilInjectedProvider(page, anvilInstance.rpcUrl);
				await page.goto("/");
				await ensureWalletConnected(page);

				await safeAddressInput(page).fill(safeAddress);
				await submitButton(page).click();

				await expect(page).toHaveURL(/\/dashboard\?/);
				expect(page.url()).toContain(`safe=${safeAddress}`);
				expect(page.url()).toContain("chainId=1");

				await expect(page.getByText("Version")).toBeVisible();
				await expect(page.getByText("Threshold")).toBeVisible();
				await expect(
					page.getByRole("heading", { name: new RegExp(`^${safeAddress}$`) }),
				).toBeVisible();
				await expect(page.getByText("Current on-chain account state")).toBeVisible();
				await expect(page.getByText("1 of 1")).toBeVisible();
				await expect(page.getByText(expectedOwner)).toBeVisible();
			},
			{
				genesisPath: getSafeGenesisPath(),
			},
		);
	});

	test("shows a validation error for invalid Safe addresses", async ({
		page,
	}) => {
		await withAnvil(
			async (anvilInstance) => {
				await installAnvilInjectedProvider(page, anvilInstance.rpcUrl);
				await page.goto("/");
				await ensureWalletConnected(page);

				for (const invalidAddress of INVALID_SAFE_ADDRESSES) {
					await safeAddressInput(page).fill(invalidAddress);
					await submitButton(page).click();

					const error = page.getByRole("alert");
					await expect(error).toBeVisible();
					await expect(error).toContainText(/invalid/i);
					await expect(page).not.toHaveURL(/\/dashboard\?/);
				}
			},
			{
				genesisPath: getSafeGenesisPath(),
			},
		);
	});

	test("shows the network as Ethereum mainnet and disables it", async ({
		page,
	}) => {
		await withAnvil(
			async (anvilInstance) => {
				await installAnvilInjectedProvider(page, anvilInstance.rpcUrl);
				await page.goto("/");
				await ensureWalletConnected(page);
				await expect(networkInput(page)).toBeVisible();
				await expect(networkInput(page)).toHaveValue(
					"Ethereum Mainnet (Chain ID: 1)",
				);
				await expect(networkInput(page)).toBeDisabled();
			},
			{
				genesisPath: getSafeGenesisPath(),
			},
		);
	});

	test("requires wallet connection before showing Safe form", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(
			page.getByRole("button", { name: /connect wallet/i }),
		).toBeVisible();
		await expect(safeAddressInput(page)).not.toBeVisible();
		await expect(networkInput(page)).not.toBeVisible();
	});
});

test("shows dashboard failure state when safe address is not a Safe", async ({
	page,
}) => {
	const nonSafeAddress = "0x0000000000000000000000000000000000000001";

	await withAnvil(
		async (anvilInstance) => {
			await installAnvilInjectedProvider(page, anvilInstance.rpcUrl);
			await page.goto("/");
			await ensureWalletConnected(page);
			await safeAddressInput(page).fill(nonSafeAddress);
			await submitButton(page).click();

			await expect(page).toHaveURL(/\/dashboard\?/);
			expect(page.url()).toContain(`safe=${nonSafeAddress}`);
			expect(page.url()).toContain("chainId=1");
			await expect(page.getByText(/failed to load safe/i)).toBeVisible({
				timeout: 15000,
			});
			await expect(
				page.getByText(/could not fetch safe configuration/i),
			).toBeVisible({ timeout: 15000 });
		},
		{
			genesisPath: getSafeGenesisPath(),
		},
	);
});
