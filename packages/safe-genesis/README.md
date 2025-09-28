# @volga/safe-genesis

Genesis configuration for Anvil containing pre-deployed Safe Smart Account v1.5.0 contracts. This package provides a genesis file that can be used with Anvil to start a local blockchain with all necessary Safe contracts already deployed at their canonical addresses.

## Installation

```bash
npm install @volga/safe-genesis
```

## Usage

The package exports a function that returns the absolute path to the genesis.json file:

```typescript
import { getSafeGenesisPath } from "@volga/safe-genesis"
import { startAnvil } from "@volga/anvil-manager"

// Start Anvil with pre-deployed Safe contracts
const anvil = await startAnvil({
  genesisPath: getSafeGenesisPath(),
})
```

### CommonJS Usage

The package supports CommonJS as well:

```javascript
const { getSafeGenesisPath } = require("@volga/safe-genesis")
```

## Pre-deployed Contracts

The genesis file includes the following Safe v1.5.0 contracts at their canonical addresses:

| Contract                     | Address                                      |
| ---------------------------- | -------------------------------------------- |
| SafeProxyFactory             | `0x14F2982D601c9458F93bd70B218933A6f8165e7b` |
| Safe (Singleton)             | `0xFf51A5898e281Db6DfC7855790607438dF2ca44b` |
| SafeL2 (Singleton)           | `0xEdd160fEBBD92E350D4D398fb636302fccd67C7e` |
| CompatibilityFallbackHandler | `0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4` |
| TokenCallbackHandler         | `0x54e86d004d71a8D2112ec75FaCE57D730b0433F3` |
| MultiSend                    | `0x218543288004CD07832472D464648173c77D7eB7` |
| MultiSendCallOnly            | `0xA83c336B20401Af773B6219BA5027174338D1836` |
| CreateCall                   | `0x2Ef5ECfbea521449E4De05EDB1ce63B75eDA90B4` |
| SignMessageLib               | `0x4FfeF8222648872B3dE295Ba1e49110E61f5b5aa` |
| SafeMigration                | `0x6439e7ABD8Bb915A5263094784C5CF561c4172AC` |
| SafeToL2Setup                | `0x900C7589200010D6C6eCaaE5B06EBe653bc2D82a` |
| SimulateTxAccessor           | `0x07EfA797c55B5DdE3698d876b277aBb6B893654C` |

## Benefits

Using this genesis configuration provides several benefits:

1. **Faster test execution**: No need to deploy Safe contracts in each test
2. **Consistent addresses**: Contracts are always at the same addresses
3. **Reduced complexity**: Simplifies test setup and example code
4. **Production parity**: Uses the exact same bytecode as mainnet deployments

## Example with withAnvil

```typescript
import { withAnvil } from "@volga/anvil-manager"
import { getSafeGenesisPath } from "@volga/safe-genesis"
import { createPublicClient, http } from "viem"
import { anvil } from "viem/chains"

await withAnvil(
  async (instance) => {
    const client = createPublicClient({
      chain: anvil,
      transport: http(instance.rpcUrl),
    })

    // Safe contracts are already deployed and ready to use
    const safeCode = await client.getCode({
      address: "0xFf51A5898e281Db6DfC7855790607438dF2ca44b",
    })

    console.log("Safe contract deployed:", safeCode !== "0x")
  },
  {
    genesisPath: getSafeGenesisPath(),
  }
)
```
