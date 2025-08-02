# @volga/safe-genesis

Genesis configuration for Anvil containing pre-deployed Safe Smart Account v1.4.1 contracts. This package provides a genesis file that can be used with Anvil to start a local blockchain with all necessary Safe contracts already deployed at their canonical addresses.

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

The genesis file includes the following Safe v1.4.1 contracts at their canonical addresses:

| Contract                     | Address                                      |
| ---------------------------- | -------------------------------------------- |
| SafeProxyFactory             | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` |
| Safe (Singleton)             | `0x41675C099F32341bf84BFc5382aF534df5C7461a` |
| SafeL2 (Singleton)           | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` |
| CompatibilityFallbackHandler | `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99` |
| MultiSend                    | `0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526` |
| MultiSendCallOnly            | `0x9641d764fc13c8B624c04430C7356C1C7C8102e2` |
| CreateCall                   | `0x9b35Af71d77eaf8d7e40252370304687390A1A52` |

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
      address: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
    })

    console.log("Safe contract deployed:", safeCode !== "0x")
  },
  {
    genesisPath: getSafeGenesisPath(),
  }
)
```
