import { deploySafeAccount, type SafeDeploymentConfig } from "@volga/picosafe";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const DEPLOYER_PRIVATE_KEY =
	"0x846874340b80d1de6f5c2bf9234c4a75677b1c5b1525b71279748ceeadad79d3";

const walletClient = createWalletClient({
	chain: baseSepolia,
	transport: http(),
	account: privateKeyToAccount(DEPLOYER_PRIVATE_KEY),
});

const METAMASK_ACCOUNT = "0xcf244a263F94e7aff4fb97f9E83fc26462726632";
const LEDGER_ACCOUNT = "0xc598A72206f42a6e16Fc957Bc6c20a20Ed3A0Ff9";
const BACKUP_ACCOUNT = "0x792D43C8f5E99F1B7a90F3e4d85d46DfF5F98D24";

const deploymentConfiguration: SafeDeploymentConfig = {
	owners: [METAMASK_ACCOUNT, LEDGER_ACCOUNT, BACKUP_ACCOUNT],
	threshold: 2n,
};

const {
	rawTransaction,
	send: sendDeploymentTransaction,
	data: deploymentData,
} = await deploySafeAccount(walletClient, deploymentConfiguration);

console.log("SAFE ACCOUNT ADDRESS:");
console.log(deploymentData.safeAddress);

console.log("DEPLOYMENT TRANSACTION:");
console.dir(rawTransaction, { depth: null });

console.log("DEPLOYMENT DATA:");
console.dir(deploymentData, { depth: null });

const deploymentTransactionHash = await sendDeploymentTransaction();

console.log("DEPLOYMENT TRANSACTION HASH:");
console.log(deploymentTransactionHash);
