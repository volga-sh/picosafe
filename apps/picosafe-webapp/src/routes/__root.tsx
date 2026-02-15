import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import Header from "../components/Header";

export interface MyRouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	component: () => (
		<div className="min-h-screen bg-background text-foreground">
			<div className="mx-auto w-full max-w-6xl px-4 py-8">
				<Header />
				<Outlet />
			</div>
		</div>
	),
});
