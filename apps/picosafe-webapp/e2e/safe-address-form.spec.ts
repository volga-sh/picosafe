import { expect, test } from "@playwright/test";
import { withAnvil } from "@volga/anvil-manager";
import { deploySafeAccount } from "@volga/picosafe";
import { getSafeGenesisPath } from "@volga/safe-genesis";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

/**
 * E2E tests for Safe Address Form
 *
 * Tests the form that allows users to load a Safe by entering its address
 * Uses Anvil with pre-deployed Safe contracts and mocked wallet connection
 */

/**
 * Anvil's first default test account
 * Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
 */
const ANVIL_TEST_PRIVATE_KEY =
	"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

test.describe("Safe Address Form", () => {
	test("should accept valid Safe address and navigate to dashboard", async ({
		page,
	}) => {
		await withAnvil(
			async (anvilInstance) => {
				// Deploy a test Safe to get a valid address
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

				// Deploy Safe with 1 owner, threshold 1
				const safe = await deploySafeAccount(walletClient, {
					owners: [testAccount.address],
					threshold: 1n,
				});

				const txHash = await safe.send();
				await publicClient.waitForTransactionReceipt({ hash: txHash });

				const safeAddress = safe.data.safeAddress;

				// Mock window.ethereum before page loads
				await page.addInitScript(() => {
					// @ts-expect-error - Mocking window.ethereum
					window.ethereum = {
						request: async ({ method }: { method: string }) => {
							if (method === "eth_requestAccounts") {
								return ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"];
							}
							if (method === "eth_chainId") {
								return "0x1"; // Ethereum mainnet
							}
							// Return null for other methods
							return null;
						},
						on: () => {},
						removeListener: () => {},
					};
				});

				// Navigate to homepage
				await page.goto("/");

				// Wait for wallet connection to complete and form to load
				await page.waitForSelector('input[id="safeAddress"]', {
					state: "visible",
					timeout: 10000,
				});

				// Fill in Safe address
				await page.fill('input[id="safeAddress"]', safeAddress);

				// Submit form
				await page.click('button:has-text("Load Safe")');

				// Verify navigation to dashboard with correct search params
				await page.waitForURL(
					new RegExp(`/dashboard\\?safe=${safeAddress}&chainId=1`),
					{ timeout: 5000 },
				);

				// Verify URL contains expected parameters
				const url = page.url();
				expect(url).toContain("/dashboard");
				expect(url).toContain(`safe=${safeAddress}`);
				expect(url).toContain("chainId=1");
			},
			{
				genesisPath: getSafeGenesisPath(),
			},
		);
	});

	test("should show error for invalid address format", async ({ page }) => {
		// Mock wallet connection
		await page.addInitScript(() => {
			// @ts-expect-error - Mocking window.ethereum
			window.ethereum = {
				request: async ({ method }: { method: string }) => {
					if (method === "eth_requestAccounts") {
						return ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"];
					}
					if (method === "eth_chainId") {
						return "0x1";
					}
					return null;
				},
				on: () => {},
				removeListener: () => {},
			};
		});

		await page.goto("/");

		// Wait for form to load
		await page.waitForSelector('input[id="safeAddress"]', {
			state: "visible",
			timeout: 10000,
		});

		// Test various invalid address formats
		const invalidAddresses = [
			"0x123", // Too short
			"123456", // Missing 0x prefix
			"0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG", // Invalid hex characters
			"", // Empty
		];

		for (const invalidAddress of invalidAddresses) {
			// Fill in invalid address
			await page.fill('input[id="safeAddress"]', invalidAddress);

			// Submit form
			await page.click('button:has-text("Load Safe")');

			// Verify error message appears
			const errorMessage = page.locator("p.text-sm.text-red-600");
			await expect(errorMessage).toBeVisible({ timeout: 2000 });
			await expect(errorMessage).toContainText("Invalid");

			// Clear the input for next iteration
			await page.fill('input[id="safeAddress"]', "");
		}
	});

	test("should display network as Ethereum Mainnet", async ({ page }) => {
		// Mock wallet connection
		await page.addInitScript(() => {
			// @ts-expect-error - Mocking window.ethereum
			window.ethereum = {
				request: async ({ method }: { method: string }) => {
					if (method === "eth_requestAccounts") {
						return ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"];
					}
					if (method === "eth_chainId") {
						return "0x1";
					}
					return null;
				},
				on: () => {},
				removeListener: () => {},
			};
		});

		await page.goto("/");

		// Wait for form to load
		await page.waitForSelector('input[id="safeAddress"]', {
			state: "visible",
			timeout: 10000,
		});

		// Verify network field shows Ethereum Mainnet
		const networkInput = page.locator('input[id="network"]');
		await expect(networkInput).toBeVisible();
		await expect(networkInput).toHaveValue("Ethereum Mainnet (Chain ID: 1)");
		await expect(networkInput).toBeDisabled();
	});

	test("should require wallet connection before showing form", async ({
		page,
	}) => {
		// Navigate without mocking wallet
		await page.goto("/");

		// Should see wallet connection prompt
		await expect(
			page.locator('h2:has-text("Connect Your Wallet")'),
		).toBeVisible({ timeout: 5000 });

		// Should see connect button
		await expect(
			page.locator('button:has-text("Connect Wallet")'),
		).toBeVisible();

		// Should NOT see the Safe address form yet
		await expect(page.locator('input[id="safeAddress"]')).not.toBeVisible();
	});
});
