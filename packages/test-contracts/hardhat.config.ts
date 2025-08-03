import type { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
	solidity: "0.8.30",
	typechain: {
		// Disable TypeChain generation since viem can infer types from ABI constants
		outDir: undefined,
		target: undefined,
	},
};

export default config;
