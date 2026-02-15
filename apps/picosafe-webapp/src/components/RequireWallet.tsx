import { useConnectWallet } from "@web3-onboard/react";
import { createContext, use, useMemo } from "react";
import { createWalletClient, custom, type WalletClient } from "viem";
import { mainnet } from "viem/chains";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

const WalletIllustration = () => (
	<svg
		width="220"
		height="150"
		viewBox="0 0 220 150"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		className="mx-auto mb-6 block"
		role="img"
		aria-label="Wallet connection illustration"
	>
		<title>Wallet connection illustration</title>
		<rect
			x="20"
			y="42"
			width="180"
			height="90"
			rx="10"
			fill="currentColor"
			opacity="0.09"
		/>
		<rect
			x="40"
			y="60"
			width="140"
			height="18"
			rx="4"
			fill="currentColor"
			opacity="0.14"
		/>
		<rect
			x="42"
			y="92"
			width="80"
			height="9"
			rx="4"
			fill="currentColor"
			opacity="0.12"
		/>
		<rect
			x="130"
			y="92"
			width="32"
			height="26"
			rx="4"
			fill="currentColor"
			opacity="0.25"
		/>
		<rect
			x="48"
			y="28"
			width="120"
			height="24"
			rx="5"
			fill="currentColor"
			opacity="0.1"
		/>
		<circle cx="62" cy="40" r="5" fill="currentColor" opacity="0.32" />
	</svg>
);

const WalletContext = createContext<WalletClient | null>(null);

interface RequireWalletProps {
	children: React.ReactNode;
}

/**
 * Hook to get the Viem WalletClient from the connected wallet.
 */
function useWalletClient(): WalletClient | undefined {
	const [{ wallet }] = useConnectWallet();

	return useMemo(() => {
		if (!wallet) return undefined;
		return createWalletClient({
			chain: mainnet,
			transport: custom(wallet.provider),
		});
	}, [wallet]);
}

export function RequireWallet({ children }: RequireWalletProps) {
	const [{ wallet }, connect] = useConnectWallet();
	const walletClient = useWalletClient();

	if (!wallet) {
		return (
			<div className="flex min-h-[60vh] items-center">
				<div className="mx-auto w-full max-w-lg">
					<Card>
						<CardHeader className="pb-4 text-center">
							<WalletIllustration />
							<CardTitle className="text-2xl">Connect wallet</CardTitle>
							<CardDescription>
								Connect a wallet to read Safe account state from chain.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Button
								onClick={() => connect()}
								className="w-full py-6 text-base"
								size="lg"
							>
								<svg
									className="w-5 h-5 mr-2"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									xmlns="http://www.w3.org/2000/svg"
									role="img"
									aria-label="Connect wallet"
								>
									<title>Connect wallet</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M13 10V3L4 14h7v7l9-11h-7z"
									/>
								</svg>
								Connect Wallet
							</Button>
						</CardContent>
					</Card>
				</div>
			</div>
		);
	}

	if (!walletClient) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<Card className="mx-auto w-full max-w-sm">
					<CardContent className="flex min-h-32 flex-col items-center justify-center py-8">
						<p className="text-sm font-medium text-muted-foreground">
							Preparing wallet
						</p>
						<div className="mt-3 h-10 w-10 animate-spin rounded-full border-b-2 border-foreground" />
						<p className="mt-3 text-sm text-muted-foreground">
							Initializing wallet client...
						</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<WalletContext.Provider value={walletClient}>
			{children}
		</WalletContext.Provider>
	);
}

/** Hook to access the WalletClient from context. */
export function useWalletProvider(): WalletClient {
	const walletClient = use(WalletContext);
	if (!walletClient) {
		throw new Error("useWalletProvider must be used within RequireWallet");
	}
	return walletClient;
}
