import { expect, test, type Page } from "@playwright/test";
import { withAnvil } from "@volga/anvil-manager";
import { deploySafeAccount } from "@volga/picosafe";
import { getSafeGenesisPath } from "@volga/safe-genesis";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

/**
 * E2E tests for Safe loading and dashboard rendering.
 */

/**
 * Anvil's first default account.
 */
const ANVIL_TEST_PRIVATE_KEY =
	"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const ANVIL_TEST_ACCOUNT =
	"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const INVALID_SAFE_ADDRESSES = [
	"0x123", // too short
	"123456", // missing 0x prefix
	"0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG", // invalid hex chars
	"", // empty
];

async function installWalletMock(page: Page) {
	await page.addInitScript(() => {
		// @ts-expect-error - mocked wallet provider used in tests only
		window.ethereum = {
			request: async ({ method }: { method: string }) => {
				switch (method) {
					case "eth_requestAccounts":
						return ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"];
					case "eth_chainId":
						return "0x1";
					default:
						return null;
				}
			},
			on: () => {},
			removeListener: () => {},
		};
	});
}

const safeAddressInput = (page: Page) => page.getByRole("textbox", { name: /safe address/i });
const networkInput = (page: Page) => page.getByRole("textbox", { name: /network/i });
const submitButton = (page: Page) =>
	page.getByRole("button", { name: /open safe details/i });

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

				await installWalletMock(page);
				await page.goto("/");

				await expect(safeAddressInput(page)).toBeVisible();
				await safeAddressInput(page).fill(safeAddress);
				await submitButton(page).click();

				await expect(page).toHaveURL(/\/dashboard\?/);
				expect(page.url()).toContain(`safe=${safeAddress}`);
				expect(page.url()).toContain("chainId=1");

				await expect(page.getByRole("heading", { name: /safe configuration/i })).toBeVisible();
				await expect(page.getByText("Version")).toBeVisible();
				await expect(page.getByText("Threshold")).toBeVisible();
				await expect(page.getByText("Owners")).toBeVisible();
				await expect(page.getByRole("heading", { name: new RegExp(`^${safeAddress}$`) })).toBeVisible();
				await expect(page.getByText("1 of 1")).toBeVisible();
				await expect(page.getByText(ANVIL_TEST_ACCOUNT)).toBeVisible();
			},
			{
				genesisPath: getSafeGenesisPath(),
			},
		);
	});

	test("shows a validation error for invalid Safe addresses", async ({ page }) => {
		await installWalletMock(page);
		await page.goto("/");
		await expect(safeAddressInput(page)).toBeVisible();

		for (const invalidAddress of INVALID_SAFE_ADDRESSES) {
			await safeAddressInput(page).fill(invalidAddress);
			await submitButton(page).click();

			const error = page.getByRole("alert");
			await expect(error).toBeVisible();
			await expect(error).toContainText(/invalid/i);
			await expect(page).not.toHaveURL(/\/dashboard\?/);
		}
	});

	test("shows the network as Ethereum mainnet and disables it", async ({ page }) => {
		await installWalletMock(page);
		await page.goto("/");
		await expect(networkInput(page)).toBeVisible();
		await expect(networkInput(page)).toHaveValue("Ethereum Mainnet (Chain ID: 1)");
		await expect(networkInput(page)).toBeDisabled();
	});

	test("requires wallet connection before showing Safe form", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();
		await expect(safeAddressInput(page)).not.toBeVisible();
		await expect(networkInput(page)).not.toBeVisible();
	});
});

test("shows dashboard failure state when safe address is not a Safe", async ({ page }) => {
	await installWalletMock(page);
	await page.goto("/dashboard?safe=0x0000000000000000000000000000000000000001&chainId=1");

	await expect(page.getByRole("heading", { name: /failed to load safe/i })).toBeVisible();
	await expect(
		page.getByText(/could not fetch safe configuration/i),
	).toBeVisible();
});
