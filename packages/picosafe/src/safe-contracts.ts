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
        | "TokenCallbackHandler"
        | "MultiSend"
        | "MultiSendCallOnly"
        | "CreateCall"
        | "SignMessageLib"
        | "SafeMigration"
        | "SafeToL2Setup"
        | "SimulateTxAccessor";

/**
 * Supported Safe contract versions by PicoSafe SDK.
 * The SDK is tested and compatible with these specific versions.
 */
const SUPPORTED_SAFE_VERSIONS = ["1.5.0"] as const;

const V150_ADDRESSES = {
        SafeProxyFactory: "0x14F2982D601c9458F93bd70B218933A6f8165e7b",
        Safe: "0xFf51A5898e281Db6DfC7855790607438dF2ca44b",
        SafeL2: "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e",
        CompatibilityFallbackHandler: "0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4",
        TokenCallbackHandler: "0x54e86d004d71a8D2112ec75FaCE57D730b0433F3",
        MultiSend: "0x218543288004CD07832472D464648173c77D7eB7",
        MultiSendCallOnly: "0xA83c336B20401Af773B6219BA5027174338D1836",
        CreateCall: "0x2Ef5ECfbea521449E4De05EDB1ce63B75eDA90B4",
        SignMessageLib: "0x4FfeF8222648872B3dE295Ba1e49110E61f5b5aa",
        SafeMigration: "0x6439e7ABD8Bb915A5263094784C5CF561c4172AC",
        SafeToL2Setup: "0x900C7589200010D6C6eCaaE5B06EBe653bc2D82a",
        SimulateTxAccessor: "0x07EfA797c55B5DdE3698d876b277aBb6B893654C",
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
export { V150_ADDRESSES, SUPPORTED_SAFE_VERSIONS, isSafeAccount };
