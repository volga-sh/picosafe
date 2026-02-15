import { createFileRoute, Link } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useEIP1193Provider } from "@/hooks/useEIP1193Provider";
import { useSafeConfiguration } from "@/hooks/useSafeConfiguration";
import { ETHEREUM_MAINNET } from "@/lib/chains";
import { safeIdSchema } from "@/lib/validators";

/**
 * Dashboard route component that displays Safe configuration
 */
export function Dashboard() {
	const { safe, chainId } = Route.useSearch();
	const provider = useEIP1193Provider();
	const { data, isLoading, error } = useSafeConfiguration(
		provider,
		safe as `0x${string}`,
		chainId,
	);

	if (isLoading) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<div className="text-center">
					<p className="mb-2 text-sm font-medium tracking-wide text-muted-foreground">
						Loading
					</p>
					<Card className="border-dashed">
						<CardContent className="px-6 py-4">
							<p className="text-sm text-muted-foreground">
								Loading Safe configuration...
							</p>
						</CardContent>
					</Card>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-center justify-center min-h-[60vh]">
				<Card className="w-full max-w-lg border-destructive/25">
					<CardHeader>
						<CardDescription className="font-medium text-destructive">
							Error
						</CardDescription>
						<CardTitle className="text-destructive">
							Failed to load Safe
						</CardTitle>
						<CardDescription>
							Could not fetch Safe configuration. Verify the address and the
							connected wallet/network.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-sm text-destructive">{error.message}</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (!data) {
		return null;
	}

	return (
		<div className="space-y-8">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
						Safe configuration
					</p>
					<h1 className="text-4xl font-semibold leading-tight text-foreground">
						{safe}
					</h1>
					<p className="mt-2 text-muted-foreground">
						on {ETHEREUM_MAINNET.name} · Chain {chainId}
					</p>
				</div>
				<Link
					to="/"
					className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
				>
					← Load another Safe
				</Link>
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Safe configuration</CardTitle>
						<CardDescription>Current on-chain account state</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
							<div className="space-y-2">
								<p className="text-muted-foreground">Version</p>
								<p className="text-xl font-semibold">{data.version}</p>
							</div>
							<div className="space-y-2">
								<p className="text-muted-foreground">Nonce</p>
								<p className="text-xl font-semibold">{data.nonce.toString()}</p>
							</div>
							<div className="space-y-2">
								<p className="text-muted-foreground">Threshold</p>
								<p className="text-xl font-semibold">
									{data.threshold.toString()} of {data.owners.length}
								</p>
							</div>
							<div className="space-y-2">
								<p className="text-muted-foreground">Owners</p>
								<p className="text-xl font-semibold">{data.owners.length}</p>
							</div>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Owners</CardTitle>
						<CardDescription>
							Authorized addresses with signing power
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-2">
							{data.owners.map((owner, index) => (
								<div
									key={owner}
									className="rounded-xl border border-border/60 bg-background/60 px-4 py-3"
								>
									<div className="flex items-center justify-between gap-4 text-sm">
										<p className="text-muted-foreground">Owner {index + 1}</p>
										<code className="font-medium text-foreground">{owner}</code>
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

export const Route = createFileRoute("/dashboard")({
	component: Dashboard,
	validateSearch: zodValidator(safeIdSchema),
});
