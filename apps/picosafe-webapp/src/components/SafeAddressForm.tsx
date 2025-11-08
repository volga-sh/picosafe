import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ETHEREUM_MAINNET } from "@/lib/chains";
import { safeAddressSchema } from "@/lib/validators";

/**
 * Form component for loading a Safe by entering its address
 *
 * Validates the address and navigates to the dashboard route with the Safe address
 * and chain ID as search parameters. Currently supports Ethereum mainnet only.
 *
 * @returns SafeAddressForm component
 */
export function SafeAddressForm() {
	const [safeAddress, setSafeAddress] = useState("");
	const [error, setError] = useState<string | null>(null);
	const navigate = useNavigate();

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		// Validate the Safe address
		const result = safeAddressSchema.safeParse(safeAddress);

		if (!result.success) {
			setError(result.error.issues[0]?.message || "Invalid Safe address");
			return;
		}

		// Navigate to dashboard with the validated Safe address and chain ID
		navigate({
			to: "/dashboard",
			search: {
				safe: result.data,
				chainId: ETHEREUM_MAINNET.chainId,
			},
		});
	};

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle>Load Safe</CardTitle>
				<CardDescription>
					Enter your Safe address to view and manage your Safe account
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="safeAddress">Safe Address</Label>
						<Input
							id="safeAddress"
							type="text"
							placeholder="0x..."
							value={safeAddress}
							onChange={(e) => setSafeAddress(e.target.value)}
							className={error ? "border-red-500" : ""}
						/>
						{error && <p className="text-sm text-red-600">{error}</p>}
					</div>

					<div className="space-y-2">
						<Label htmlFor="network">Network</Label>
						<Input
							id="network"
							type="text"
							value={`${ETHEREUM_MAINNET.name} (Chain ID: ${ETHEREUM_MAINNET.chainId})`}
							disabled
							className="bg-muted"
						/>
						<p className="text-xs text-muted-foreground">
							Currently supporting Ethereum mainnet only
						</p>
					</div>

					<Button type="submit" className="w-full">
						Load Safe
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}
