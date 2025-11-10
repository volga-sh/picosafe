import { createFileRoute } from "@tanstack/react-router";
import { RequireWallet } from "@/components/RequireWallet";
import { SafeAddressForm } from "@/components/SafeAddressForm";

/**
 * Safe vault illustration SVG
 */
const SafeIllustration = () => (
	<svg
		width="240"
		height="180"
		viewBox="0 0 240 180"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		className="mx-auto mb-8"
		role="img"
		aria-label="Safe vault illustration"
	>
		<title>Safe vault illustration</title>
		<rect
			x="40"
			y="40"
			width="160"
			height="120"
			rx="8"
			fill="#f8f8f8"
			stroke="#333"
			strokeWidth="2"
		/>
		<rect
			x="60"
			y="60"
			width="120"
			height="80"
			rx="4"
			fill="#f0f0f0"
			stroke="#666"
			strokeWidth="1"
		/>
		<rect x="90" y="80" width="60" height="10" rx="2" fill="#d0d0d0" />
		<rect x="90" y="100" width="60" height="10" rx="2" fill="#e0e0e0" />
		<rect x="90" y="120" width="60" height="10" rx="2" fill="#e0e0e0" />
		<rect x="60" y="40" width="30" height="20" rx="2" fill="#333" />
		<circle cx="75" cy="50" r="2" fill="#fff" />
	</svg>
);

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
 * Inner component that renders after wallet connection
 */
function AppInner() {
	return (
		<div className="min-h-screen bg-gray-50">
			<div className="max-w-4xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
				<div className="text-center mb-12">
					<h1 className="text-3xl font-bold text-gray-900 sm:text-4xl mb-4">
						picosafe
					</h1>
					<p className="text-lg text-gray-700 max-w-2xl mx-auto">
						Minimalistic but advanced Safe Smart Account SDK
					</p>
				</div>

				<div className="flex justify-center">
					<div className="w-full max-w-lg">
						<SafeIllustration />
						<SafeAddressForm />
					</div>
				</div>
			</div>
		</div>
	);
}

export const Route = createFileRoute("/")({
	component: App,
});
