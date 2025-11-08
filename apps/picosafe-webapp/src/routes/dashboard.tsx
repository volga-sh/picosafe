import { createFileRoute } from "@tanstack/react-router";
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
 *
 * Fetches and displays Safe owners, threshold, nonce, and version
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
			<div className="flex items-center justify-center min-h-screen">
				<div className="text-center">
					<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4" />
					<p className="text-gray-800 font-medium">
						Loading Safe configuration...
					</p>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-center justify-center min-h-screen">
				<Card className="w-full max-w-md border-red-200">
					<CardHeader>
						<CardTitle className="text-red-600">Error Loading Safe</CardTitle>
						<CardDescription>
							Failed to load Safe configuration. Please verify the address and
							try again.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-sm text-red-700">{error.message}</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (!data) {
		return null;
	}

	return (
		<div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
			<div className="max-w-4xl mx-auto space-y-6">
				{/* Header */}
				<div>
					<h1 className="text-3xl font-bold text-gray-900 mb-2">
						Safe Dashboard
					</h1>
					<p className="text-gray-600">
						{safe} on {ETHEREUM_MAINNET.name}
					</p>
				</div>

				{/* Safe Configuration */}
				<Card>
					<CardHeader>
						<CardTitle>Safe Configuration</CardTitle>
						<CardDescription>Current Safe account settings</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<h3 className="text-sm font-medium text-gray-500">Version</h3>
								<p className="mt-1 text-lg font-semibold">{data.version}</p>
							</div>
							<div>
								<h3 className="text-sm font-medium text-gray-500">Nonce</h3>
								<p className="mt-1 text-lg font-semibold">
									{data.nonce.toString()}
								</p>
							</div>
							<div>
								<h3 className="text-sm font-medium text-gray-500">Threshold</h3>
								<p className="mt-1 text-lg font-semibold">
									{data.threshold.toString()} of {data.owners.length}
								</p>
							</div>
							<div>
								<h3 className="text-sm font-medium text-gray-500">Owners</h3>
								<p className="mt-1 text-lg font-semibold">
									{data.owners.length}
								</p>
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Owners List */}
				<Card>
					<CardHeader>
						<CardTitle>Owners</CardTitle>
						<CardDescription>
							Addresses authorized to approve transactions
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-2">
							{data.owners.map((owner, index) => (
								<div
									key={owner}
									className="flex items-center justify-between p-3 bg-gray-50 rounded-md"
								>
									<span className="text-sm font-medium text-gray-500">
										Owner {index + 1}
									</span>
									<code className="text-sm text-gray-900 font-mono">
										{owner}
									</code>
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
