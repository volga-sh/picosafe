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
 */
export function SafeAddressForm() {
	const [safeAddress, setSafeAddress] = useState("");
	const [error, setError] = useState<string | null>(null);
	const navigate = useNavigate();

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		const result = safeAddressSchema.safeParse(safeAddress);

		if (!result.success) {
			setError(result.error.issues[0]?.message || "Invalid Safe address");
			return;
		}

		navigate({
			to: "/dashboard",
			search: {
				safe: result.data,
				chainId: ETHEREUM_MAINNET.chainId,
			},
		});
	};

	return (
		<Card className="border-0 shadow-none">
			<CardHeader className="pb-3">
				<CardTitle className="text-2xl">Safe details query</CardTitle>
				<CardDescription className="text-muted-foreground">
					Enter a Safe address to inspect its on-chain owners, threshold, and
					version.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="safeAddress">Safe Address</Label>
						<Input
							id="safeAddress"
							type="text"
							placeholder="0x..."
							value={safeAddress}
							onChange={(e) => setSafeAddress(e.target.value)}
							className={
								error ? "border-destructive focus-visible:ring-destructive" : ""
							}
						/>
						{error && (
							<p className="text-sm text-destructive" role="alert">
								{error}
							</p>
						)}
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
							Chain fixed to Ethereum mainnet.
						</p>
					</div>

					<Button type="submit" className="w-full">
						Open Safe details
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}
