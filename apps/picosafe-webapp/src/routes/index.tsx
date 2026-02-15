import { createFileRoute } from "@tanstack/react-router";
import { RequireWallet } from "@/components/RequireWallet";
import { SafeAddressForm } from "@/components/SafeAddressForm";

/**
 * Main app component wrapped with wallet requirement
 */
export function App() {
	return (
		<RequireWallet>
			<AppInner />
		</RequireWallet>
	);
}

/**
 * Home view shown after wallet connection
 */
function AppInner() {
	return (
		<div className="grid lg:grid-cols-[1.15fr_1fr] gap-8 items-start">
			<section>
				<h1 className="text-4xl sm:text-5xl font-semibold leading-tight text-foreground">
					Inspect Safe accounts
				</h1>
				<p className="max-w-xl text-base sm:text-lg text-muted-foreground mt-4">
					Enter a Safe address to load chain-resolved configuration:
					owners, threshold, nonce, and version.
				</p>
			</section>

			<aside>
					<SafeAddressForm />
			</aside>
		</div>
	);
}

export const Route = createFileRoute("/")({
	component: App,
});
