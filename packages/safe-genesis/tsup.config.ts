import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	sourcemap: true,
	splitting: false,
	// Use shims to handle import.meta in CJS build
	shims: true,
	// Copy genesis.json to dist directory
	onSuccess: async () => {
		const { copyFile } = await import("node:fs/promises");
		const { join } = await import("node:path");
		await copyFile(
			join(import.meta.dirname, "src/genesis.json"),
			join(import.meta.dirname, "dist/genesis.json"),
		);
	},
});
