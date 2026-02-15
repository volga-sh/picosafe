import { Link } from "@tanstack/react-router";

export default function Header() {
	return (
		<header className="mb-6 rounded-xl border border-border bg-card px-4 py-4">
			<div className="flex items-center justify-between gap-4">
				<Link
					to="/"
					className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground"
				>
					<span className="text-sm text-muted-foreground font-medium uppercase tracking-[0.15em]">
						picosafe
					</span>
				</Link>
			</div>
		</header>
	);
}
