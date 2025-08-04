import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["cjs", "esm"],
	dts: {
		// tsup delegates declaration generation to rollup-plugin-dts which still
		// struggles with TypeScript *project-references* that are typical in
		// monorepos. Without the tweaks below it often crashes with
		// "file not listed in project" / TS6059 errors.
		//
		//   • resolve: true – makes rollup-plugin-dts follow project references and
		//     path-aliases so it can find the source files it needs.
		//   • compilerOptions.composite: false – disables the stricter "composite"
		//     checks that conflict with the way the plugin flattens type files.
		//
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
