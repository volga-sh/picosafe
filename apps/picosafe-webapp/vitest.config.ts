import { resolve } from "node:path";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [viteReact()],
	test: {
		globals: true,
		environment: "jsdom",
		exclude: ["**/node_modules/**", "**/e2e/**"],
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
		},
	},
});
