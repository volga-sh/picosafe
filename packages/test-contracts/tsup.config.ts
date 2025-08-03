import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["cjs", "esm"],
	/* generate declaration files */
	dts: {
		// In monorepo setups with TypeScript's composite projects, tsup's dts generation
		// can fail with "file not listed" errors when bundle: false is used. This happens
		// because tsup's underlying dts plugin (rollup-plugin-dts) doesn't properly handle
		// TypeScript project references. Setting resolve: true helps with module resolution,
		// and composite: false tells TypeScript to ignore project reference constraints
		// during type generation. This is a common workaround for tsup in monorepos.
		// Alternative: disable dts here and use a separate tsc --emitDeclarationOnly step.
		resolve: true,
		compilerOptions: {
			composite: false,
		},
	},
	clean: true,
	loader: {
		".json": "json",
	},
});
