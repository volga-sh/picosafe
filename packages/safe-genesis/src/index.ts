import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Get the absolute path to the genesis.json file containing pre-deployed Safe Smart Account v1.5.0 contracts.
 *
 * This genesis file includes all necessary Safe contracts at their canonical addresses:
 * - SafeProxyFactory: 0x14F2982D601c9458F93bd70B218933A6f8165e7b
 * - Safe: 0xFf51A5898e281Db6DfC7855790607438dF2ca44b
 * - SafeL2: 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e
 * - CompatibilityFallbackHandler: 0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4
 * - TokenCallbackHandler: 0x54e86d004d71a8D2112ec75FaCE57D730b0433F3
 * - MultiSend: 0x218543288004CD07832472D464648173c77D7eB7
 * - MultiSendCallOnly: 0xA83c336B20401Af773B6219BA5027174338D1836
 * - CreateCall: 0x2Ef5ECfbea521449E4De05EDB1ce63B75eDA90B4
 * - SignMessageLib: 0x4FfeF8222648872B3dE295Ba1e49110E61f5b5aa
 * - SafeMigration: 0x6439e7ABD8Bb915A5263094784C5CF561c4172AC
 * - SafeToL2Setup: 0x900C7589200010D6C6eCaaE5B06EBe653bc2D82a
 * - SimulateTxAccessor: 0x07EfA797c55B5DdE3698d876b277aBb6B893654C
 *
 * @returns The absolute path to the genesis.json file
 * @example
 * ```typescript
 * import { getSafeGenesisPath } from "@volga/safe-genesis";
 * import { startAnvil } from "@volga/anvil-manager";
 *
 * const anvil = await startAnvil({
 *   genesisPath: getSafeGenesisPath()
 * });
 * ```
 */
function getSafeGenesisPath(): string {
	return join(__dirname, "genesis.json");
}

export { getSafeGenesisPath };
