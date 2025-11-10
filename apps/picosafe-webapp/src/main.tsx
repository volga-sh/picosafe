import { createRouter, RouterProvider } from "@tanstack/react-router";
import { init, Web3OnboardProvider } from "@web3-onboard/react";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";

import * as TanStackQueryProvider from "./integrations/tanstack-query/root-provider.js";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

import "./styles.css";
import { web3OnboardConfig } from "./lib/web3-onboard";
import reportWebVitals from "./reportWebVitals.js";

// Create a new router instance

// Initialize Web3Onboard
const web3Onboard = init(web3OnboardConfig);

const TanStackQueryProviderContext = TanStackQueryProvider.getContext();
const router = createRouter({
	routeTree,
	context: {
		...TanStackQueryProviderContext,
	},
	defaultPreload: "intent",
	scrollRestoration: true,
	defaultStructuralSharing: true,
	defaultPreloadStaleTime: 0,
});

// Register the router instance for type safety
declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

// Render the app
const rootElement = document.getElementById("app");
if (rootElement && !rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	root.render(
		<StrictMode>
			<Web3OnboardProvider web3Onboard={web3Onboard}>
				<TanStackQueryProvider.Provider {...TanStackQueryProviderContext}>
					<RouterProvider router={router} />
				</TanStackQueryProvider.Provider>
			</Web3OnboardProvider>
		</StrictMode>,
	);
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
