import { getOwners, getStorageAt } from "./account-state";
import type { Address } from "./ox-types";
import { computeOwnersMappingSlot } from "./storage";
import type {
	EIP1193ProviderWithRequestFn,
	PicosafeRpcBlockIdentifier,
} from "./types";
import { SENTINEL_NODE } from "./utilities/constants";

type SafeContracts =
	| "SafeProxyFactory"
	| "Safe"
	| "SafeL2"
	| "CompatibilityFallbackHandler"
	| "MultiSend"
	| "MultiSendCallOnly"
	| "CreateCall";

/**
 * Supported Safe contract versions by PicoSafe SDK.
 * The SDK is tested and compatible with these specific versions.
 */
const SUPPORTED_SAFE_VERSIONS = ["1.4.1"] as const;

const V141_ADDRESSES = {
	SafeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
	Safe: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
	SafeL2: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
	CompatibilityFallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
	MultiSend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
	MultiSendCallOnly: "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
	CreateCall: "0x9b35Af71d77eaf8d7e40252370304687390A1A52",
} satisfies Record<SafeContracts, Address>;

/**
 * Best-effort detection function to determine if a contract address is a Safe account.
 * This function works with any proxy type by verifying both method responses and storage patterns
 * specific to Safe contracts.
 *
 * @remarks
 * The detection strategy combines two verification methods:
 * 1. Calls `getOwners()` method which should return an array of owner addresses
 * 2. Reads the storage slot `owners[SENTINEL_NODE]` and verifies it matches the first owner
 *
 * This approach is "best-effort" because:
 * - A malicious contract could implement the same methods and storage patterns
 * - However, the combination makes it very unlikely for non-Safe contracts to pass both checks
 * - The storage verification is particularly specific to Safe's linked-list owner structure
 *
 * The function is non-throwing and returns false for any errors or validation failures.
 *
 * @param provider - An EIP-1193 compliant provider for blockchain interactions
 * @param address - The contract address to check
 * @param options - Optional parameters
 * @param options.block - Block identifier to query at (defaults to "latest")
 * @returns Promise that resolves to true if the contract appears to be a Safe, false otherwise
 * @example
 * ```typescript
 * import { isSafeAccount } from "picosafe";
 * import { createPublicClient, http } from "viem";
 * import { mainnet } from "viem/chains";
 *
 * const publicClient = createPublicClient({
 *   chain: mainnet,
 *   transport: http(),
 * });
 *
 * // Check if an address is a Safe
 * const contractAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f4d3e2";
 * const isSafe = await isSafeAccount(publicClient, contractAddress);
 *
 * if (isSafe) {
 *   console.log("This appears to be a Safe contract!");
 * } else {
 *   console.log("This does not appear to be a Safe contract.");
 * }
 * ```
 */
async function isSafeAccount(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	address: Address,
	options?: Readonly<{
		block?: PicosafeRpcBlockIdentifier;
	}>,
): Promise<boolean> {
	try {
		const { block = "latest" } = options || {};

		const sentinelSlot = computeOwnersMappingSlot(SENTINEL_NODE);

		const [[firstOwner], [storageValue]] = await Promise.all([
			getOwners(provider, { safeAddress: address }, { block }),
			getStorageAt(
				provider,
				{ safeAddress: address, slot: sentinelSlot },
				{ block },
			),
		]);

		if (!firstOwner || !storageValue) {
			return false;
		}

		// Convert storage value to address (remove padding)
		// Storage values are 32 bytes (64 hex chars + "0x"), addresses are 20 bytes (40 hex chars)
		const storageAddress = `0x${storageValue.slice(-40)}`; // Extract last 20 bytes as address

		// Verify that owners[SENTINEL_NODE] points to the first owner
		return firstOwner.toLowerCase() === storageAddress.toLowerCase();
	} catch {
		return false;
	}
}

export type { SafeContracts };
export { V141_ADDRESSES, SUPPORTED_SAFE_VERSIONS, isSafeAccount };
