import type { ChildProcess } from "node:child_process";

declare global {
	var __anvil_process__: ChildProcess | undefined;
}
