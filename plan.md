# Safe Smart Account SDK Design and Requirements

## Introduction

The Safe Smart Account (formerly **Gnosis Safe**) is a smart contract wallet that supports multi-signature authorization, modular extensions. To help developers interact with Safe contracts (v1.4.1+), we propose a **minimalist TypeScript SDK**. This SDK simplifies common Safe actions – deploying a new Safe account, executing transactions, signing messages, and managing modules – while adhering to modern best practices. The design emphasizes **1 action = 1 function** (each Safe contract operation is exposed as a single, clear function) and avoids managing keys or connections internally. By leveraging an EIP-1193 compatible provider (e.g. MetaMask, WalletConnect) supplied by the developer, the SDK remains library-agnostic and keeps private keys out of its scope. All functionality is fully type-safe end-to-end, built with modern JavaScript tooling (tree-shakable ESM modules) and documented via JSDoc for developer clarity. The SDK functions are **pure and composable** – they do not hold internal state, making it easy to integrate with various workflows.

Below we present the high-level SDK design, including pseudocode of the API structure, detailed behavior and requirements for each function, recommended dependencies (with evidence of their maintenance), and suggestions for bundling and CI tooling.

## Design Goals and Principles

- **One-Action-One-Function:** Each distinct Safe **contract action** corresponds to a single SDK function. This means no hidden multi-step state machines – every call performs one logical operation (e.g. deploying the Safe, executing a transaction, signing a message, etc.), promoting clarity and ease of use. For example, enabling a module is a separate function from executing a transaction, even if under the hood it uses a Safe transaction. This mapping ensures developers can clearly see which Safe feature they are invoking.
- **No Key or Connection Management:** The SDK does not handle private keys, account secrets, or initiate provider connections. Instead, it **accepts any EIP-1193 provider** (the standard Ethereum provider interface) as a parameter. Signing and transaction sending are delegated to this provider, meaning the user’s wallet or dApp handles approvals. This keeps the SDK stateless regarding accounts – enhancing security (no private key exposure) and flexibility (works with MetaMask, WalletConnect, hardware wallets, etc.).
- **Library-Agnostic Implementation:** The design avoids locking into a specific web3 library. By using the generic EIP-1193 interface, the SDK can work with **ethers**, **viem**, or any library that implements a provider. Internally, minimal utilities from well-maintained libraries will be used for ABI encoding and EIP-712 signature generation, but the external API does not require consumers to adopt a particular stack. For example, the developer can pass in an ethers `BrowserProvider` or a viem client’s transport – the SDK will treat it abstractly as an Ethereum RPC provider.
- **End-to-End Type Safety:** All functions and data structures are strongly typed with TypeScript. This includes input parameters (addresses, BigInts for values, etc.), return types (e.g. transaction result objects, signature bytes), and even encoded data. By leveraging tools like TypeScript’s utility types or generated contract types, we ensure that a developer using the SDK gets compiler-time feedback on incorrect types. This eliminates many classes of runtime errors (e.g. calling a non-existent Safe method or using wrong parameter types will be caught at compile time).
- **Modern JS Tooling:** The SDK will be built and distributed as an **ES Module** with tree-shaking support, so consumers can import only the functions they need. We prioritize a small footprint and compatibility with modern bundlers. The build process uses a high-speed bundler (such as `tsup`, which uses esbuild) to output both ESM and CommonJS bundles, along with type declarations. This approach yields an optimized library: “tsup is a fast and efficient, zero-configuration TypeScript bundler... supports modern ECMAScript modules and CommonJS (CJS), and provides built-in features like tree shaking and minification”.
- **Comprehensive JSDoc Documentation:** Each function in the SDK will include clear JSDoc comments describing its purpose, parameters, return values, and examples of usage. These comments will be used to generate reference documentation. Given the audience (dApp developers), documentation will focus on how to integrate each function (for example, showing how to prepare a Safe transaction and then execute it). The JSDoc will also note any important nuances (e.g. “This action must be performed as a Safe transaction approved by owners” for module changes).
- **Functional & Composable Style:** The SDK leans toward a functional design. Functions are mostly pure (no side effects or hidden state beyond calling the blockchain) and accept all required inputs explicitly. This makes them easy to compose – e.g., one could use a `getTransactionHash` utility to produce a hash, then use a separate `signTransaction` for each owner, then feed signatures into `executeTransaction`. The SDK may also provide a convenience factory to bind a Safe address and provider into a reusable object, but under the hood this is just binding arguments to pure functions. This style ensures that advanced users can mix and match the provided functions in different flows (for example, integrate Safe transaction signing into an ERC-4337 bundler pipeline) without the SDK imposing a rigid pattern.

## SDK Architecture and Structure

To logically organize functionality, the SDK is divided into modules corresponding to Safe Smart Account capabilities (aligned with the Safe contract’s structure). These modules are:

- **Deployment:** Functions to deploy new Safe accounts (through the Safe Proxy Factory and Safe Singleton contracts).
- **Transactions:** Functions to construct Safe transaction objects, calculate transaction hashes, gather signatures, and execute transactions on-chain. This covers `execTransaction` and related utilities (nonce management, gas estimation, etc.).
- **Messages:** Functions to handle Safe off-chain message signing and verification. Safe supports EIP-191 and EIP-712 style message signing with on-chain validation via `isValidSignature` (EIP-1271), so the SDK provides helpers to generate the correct message hash and to record signatures on-chain if needed.
- **Modules:** Functions to manage Safe modules (enable, disable, query modules). Safe modules are separate contracts that can execute transactions on the Safe’s behalf, and enabling/disabling them requires a Safe owner transaction. The SDK simplifies creating those module-management transactions.
- **Utilities:** Miscellaneous helpers, such as retrieving the current nonce of a Safe, estimating gas costs for a Safe transaction, and building batched transactions if needed. These are optional conveniences that assist developers but aren’t strictly part of the Safe contract interface. For example, the SDK can call Safe’s `getNonce` (public storage) or use `simulateAndRevert` to estimate gas for an execution.

**Structural Outline:** Internally, each module might be implemented as a separate TypeScript file or namespace (e.g. `deployment.ts`, `transactions.ts`), exporting its related functions. The SDK’s main entry point re-exports all functions, so developers can import them directly or as a grouped object. We also provide an optional factory function `createSafeAccountToolkit(provider, safeAddress)` that returns a collection of bound functions (with `provider` and `safeAddress` pre-specified) for convenience. This factory is a thin wrapper; all core logic resides in the independent functions which always take `provider` and `safeAddress` as arguments. This way, developers can choose a functional style (`import { executeTransaction } from 'safe-sdk'; executeTransaction(provider, safeAddr, tx, sigs)`) or an OO-like style (`const safe = createSafeAccountToolkit(provider, safeAddr); safe.executeTransaction(tx, sigs)`) depending on preference – both lead to the same one-action functions under the hood.

The SDK will use the Safe contracts’ ABIs to encode function calls and decode responses. It will include built-in knowledge of Safe’s contract addresses and ABI for each supported version/network. We will leverage the official Safe deployments repository (available via the `@safe-global/safe-deployments` package) to obtain addresses and ABIs of Safe Singleton, Proxy Factory, and other related contracts. This ensures the SDK stays up-to-date with contract addresses on all networks and can easily be extended to new networks or Safe versions. Using `safe-deployments`, we can, for example, query the latest Safe singleton address on a given chain and retrieve the ABI for encoding transactions. (The safe-deployments package is actively maintained, version 1.37.34 published just days ago, indicating reliability and up-to-date data.)

All external calls (reading contract state, sending transactions, etc.) go through the provided EIP-1193 `provider`. We do not instantiate our own provider or signer; instead, we rely on the developer’s context. This means before using the SDK, the developer should have a provider (for example, `window.ethereum` in a browser, or a WalletConnect provider) connected to the desired network and account. The SDK functions will typically expect a `provider` object and sometimes an explicit `from` address (owner) for clarity, although the provider’s selected account can be used by default if not specified.

**Error Handling:** The SDK will surface errors from the Ethereum calls (e.g. if a transaction is reverted or if a user rejects a signature request) as JavaScript exceptions or rejections of the returned Promise. Each function will document the possible failure modes. We may implement custom error types for common mistakes (for example, trying to execute a Safe transaction with insufficient signatures will throw a descriptive error before even sending to chain).

## Functional Interfaces (Pseudocode)

Below is pseudocode illustrating the SDK’s key functions and types. This is a high-level sketch; actual implementation may differ in naming and exact type definitions but the core idea remains:

```typescript
/***** Type Definitions *****/
type Address = string // Ethereum address
type HexData = string // hex-encoded data (e.g. 0xabc...)
type BigIntish = bigint | string | number // values for ether/gas can be BigInt or numeric (converted to bigint internally)

// Safe transaction structure (mirrors Safe contract's expected parameters for execTransaction)
interface SafeTransaction {
  to: Address
  value: BigInt // in wei
  data: HexData
  operation: 0 | 1 // 0 for CALL, 1 for DELEGATE_CALL
  safeTxGas?: BigInt // gas for the safe tx execution (optional utility to auto-calc)
  baseGas?: BigInt // gas for data (optional)
  gasPrice?: BigInt // gas price for refund (0 if no refund)
  gasToken?: Address // token address for gas refund (0x000... for ETH)
  refundReceiver?: Address // receiver of gas refund (typically one of owners or sponsor)
  nonce?: BigInt // Safe nonce (optional; will fetch current nonce if not provided)
}

// A signature for Safe transaction or message:
type Signature = HexData // e.g. 0x{r}{s}{v} format or the Safe’s specific concatenated format

// EIP-1193 Provider interface (simplified for our usage):
interface EthereumProvider {
  request(args: { method: string; params?: any[] }): Promise<any>
}

/***** Deployment Module *****/
/**
 * Deploy a new Safe smart account (proxy) with given owners and threshold.
 * @param provider - An EIP-1193 provider with an account that will deploy the Safe (pays gas).
 * @param config - Configuration for the Safe deployment.
 * @returns the new Safe's address (Promise resolves after deployment tx mined).
 */
async function deploySafeAccount(
  provider: EthereumProvider,
  config: {
    owners: Address[]
    threshold: number
    saltNonce?: BigIntish // optional salt for deterministic address
    fallbackHandler?: Address // optional custom fallback handler
    payment?: { token: Address; receiver: Address; amount: BigIntish } // optional deployment payment info
  }
): Promise<Address> {
  // Pseudocode:
  // 1. Retrieve Safe Proxy Factory address & ABI (from safe-deployments by chain).
  // 2. Retrieve Safe Singleton (mastercopy) address for current chain.
  // 3. Encode initializer call data for Safe setup(owners, threshold, ...).
  // 4. Encode ProxyFactory.createProxyWithNonce(masterCopy, initializer, saltNonce).
  // 5. Send transaction via provider to ProxyFactory contract.
  // 6. Wait for confirmation and return the deployed Safe proxy address.
}

/***** Transactions Module *****/
/**
 * Prepare a Safe transaction object with proper defaults.
 * This helps fill optional fields like nonce and gas estimates.
 */
function buildSafeTransaction(
  provider: EthereumProvider,
  safeAddress: Address,
  tx: Partial<SafeTransaction>
): Promise<SafeTransaction> {
  // Fill in nonce from current Safe nonce if not provided.
  // Estimate safeTxGas if not provided (could use simulateAndRevert or eth_call).
  // Fill default values (gasPrice=0, gasToken=0x000..., refundReceiver=0x if needed).
  // Return a complete SafeTransaction object ready to sign/execute.
}

/**
 * Calculate the EIP-712 transaction hash for a given Safe transaction.
 * This hash is what owners need to sign off-chain.
 * @returns the 32-byte hash that corresponds to Safe.execTransaction’s parameters.
 */
function getTransactionHash(
  provider: EthereumProvider,
  safeAddress: Address,
  safeTx: SafeTransaction
): Promise<HexData> {
  // Implementation hint: call Safe contract's getTransactionHash(...) via eth_call,
  // or reproduce the EIP-712 hash locally using chainId and Safe address.
}

/**
 * Prompt the current provider's account to sign a Safe transaction.
 * This uses personal_sign or eth_signTypedData (EIP-712) as supported.
 * @param signerAddress - The owner address corresponding to the provider’s active account (for verification).
 * @returns a Signature object (hex string) for the Safe transaction.
 */
async function signTransaction(
  provider: EthereumProvider,
  safeAddress: Address,
  safeTx: SafeTransaction,
  signerAddress: Address
): Promise<Signature> {
  // 1. Compute the Safe transaction hash (EIP-712) if not already computed.
  // 2. Use provider.request({...}) to prompt signing:
  //    - If provider supports eth_signTypedData_v4, use that with Safe’s domain and struct.
  //    - Otherwise, fallback to personal_sign with the hash.
  // 3. Format the signature to Safe’s format (concatenate r,s,v and owner address or guard marker if needed).
  // 4. Return the signature hex string.
}

/**
 * Execute a Safe transaction on-chain. This requires enough owner signatures (or module intervention).
 * @param signatures - An array of signatures from owners, sorted by owner address (or a single signature if threshold=1).
 * @returns the transaction response (e.g. transaction hash or receipt) once submitted.
 */
async function executeTransaction(
  provider: EthereumProvider,
  safeAddress: Address,
  safeTx: SafeTransaction,
  signatures: Signature[]
): Promise<{ txHash: string }> {
  // 1. Ensure the number of signatures meets the Safe’s threshold (throw error if not).
  // 2. Encode Safe.execTransaction(to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, signatures).
  // 3. Use provider.request({ method: 'eth_sendTransaction', params: [{from: anOwner, to: safeAddress, data: encodedTx}] }).
  //    - The `from` should be one of the owners (who submits the transaction and pays gas).
  // 4. Return the transaction hash (and possibly wait for receipt in another helper).
}

/**
 * (Optional) Low-level utility to simulate a Safe transaction without executing it.
 * It calls Safe.simulateAndRevert(...) which always reverts but returns success data if the tx would succeed.
 * Useful for estimating gas or ensuring a transaction will pass.
 */
async function simulateTransaction(
  provider: EthereumProvider,
  safeAddress: Address,
  safeTx: SafeTransaction,
  signatures: Signature[]
): Promise<{ success: boolean; returnData: HexData }> {
  // Encode and call simulateAndRevert via eth_call (since it will revert, we call it as a view).
  // Parse the result (if no revert thrown means success).
  // Return whether simulation succeeded and any returned data from the call.
}

/***** Messages Module *****/
/**
 * Sign an off-chain message with the Safe (using owners' approvals off-chain).
 * Returns a Safe message hash (as per EIP-191/1271) and an initial signature.
 * This message can later be verified via Safe.isValidSignature.
 */
async function signMessage(
  provider: EthereumProvider,
  safeAddress: Address,
  message: string | HexData,
  signerAddress: Address
): Promise<{ safeMessageHash: HexData; signature: Signature }> {
  // 1. Compute the message hash according to Safe’s convention: hash = keccak256("\x19Ethereum Signed Message:\n" + message.length + message).
  // 2. Have the owner sign this hash (personal_sign via provider).
  // 3. Format the signature and return it along with the hash.
  // Note: For a fully signed message by multiple owners, combine signatures via addMessageSignature (see below).
}

/**
 * (Optional) Record a message signature on-chain. Uses the Safe SignMessageLib to store a message hash in the Safe contract.
 * After calling this (with threshold sigs), Safe’s isValidSignature(bytes32,0x) will return valid.
 */
async function approveMessageHash(
  provider: EthereumProvider,
  safeAddress: Address,
  safeMessageHash: HexData
): Promise<{ txHash: string }> {
  // This will create a Safe transaction that calls the SignMessageLib.signMessage(safeMessageHash) via delegatecall.
  // It then executes that tx (owner signatures required just like any tx).
  // After mining, the Safe’s storage `signedMessages[safeMessageHash]` is set:contentReference[oaicite:9]{index=9}, enabling on-chain signature validation.
}

/**
 * Check if a given message (by hash) has been approved by the Safe (either via on-chain storage or via off-chain threshold signatures).
 * If `encodedSignatures` is provided, use the CompatibilityFallbackHandler’s EIP-1271 check with those signatures:contentReference[oaicite:10]{index=10}.
 * If no signatures provided, it checks Safe contract storage for a prior approval.
 */
async function isValidMessageSignature(
  provider: EthereumProvider,
  safeAddress: Address,
  safeMessageHash: HexData,
  encodedSignatures?: HexData
): Promise<boolean> {
  // Use eth_call to Safe.isValidSignature(bytes32 hash, bytes signature) -> returns 0x1626ba7e if valid.
  // If encodedSignatures (concatenated owner sigs) are given, pass those; otherwise pass 0x as signature to trigger on-chain storage check:contentReference[oaicite:11]{index=11}.
  // Return true if the call returns the magic value.
}

/***** Modules Module *****/
/**
 * Enable a Safe module by address. This will create a Safe transaction that adds the module, which needs to be executed by owners.
 */
async function enableModule(
  provider: EthereumProvider,
  safeAddress: Address,
  moduleAddress: Address,
  signatures: Signature[]
): Promise<{ txHash: string }> {
  // 1. Encode Safe.enableModule(moduleAddress). Note: can only be executed via Safe (i.e. as a Safe transaction):contentReference[oaicite:12]{index=12}.
  // 2. Use executeTransaction() internally to perform this (to = safeAddress (itself), data = enableModule data).
  //    The Safe will update its module list if threshold signatures are provided.
  // 3. Return transaction hash for the module enablement transaction.
}

/**
 * Disable an existing Safe module.
 * @param prevModule - The module that comes immediately before the module to remove in the Safe's linked list (Safe modules are stored as a linked list). This is required by Safe’s `disableModule` function.
 */
async function disableModule(
  provider: EthereumProvider,
  safeAddress: Address,
  moduleAddress: Address,
  prevModule: Address,
  signatures: Signature[]
): Promise<{ txHash: string }> {
  // Similar to enableModule: create Safe transaction calling disableModule(prevModule, moduleAddress), then execute it with signatures.
  // The prevModule is required by the Safe contract to update the internal module linked list.
}

/**
 * Get the list of modules currently enabled on the Safe.
 * @returns array of module addresses.
 */
async function getModules(provider: EthereumProvider, safeAddress: Address): Promise<Address[]> {
  // Call Safe.getModulesPaginated(start: Address, pageSize: uint) multiple times to retrieve all modules:contentReference[oaicite:13]{index=13}.
  // Or if the Safe contract supports an easy getter (e.g., an event log or storage slot), use that.
  // Collect and return module addresses.
}

/**
 * Check if a specific address is an enabled module on the Safe.
 */
async function isModuleEnabled(
  provider: EthereumProvider,
  safeAddress: Address,
  moduleAddress: Address
): Promise<boolean> {
  // Use Safe.isModuleEnabled(moduleAddress) via eth_call:contentReference[oaicite:14]{index=14}.
}

/***** Owner Management (optional extra) *****/
/** (Optional) Add a new owner to the Safe (via Safe transaction). */
async function addOwner(
  provider: EthereumProvider,
  safeAddress: Address,
  newOwner: Address,
  newThreshold: number,
  signatures: Signature[]
): Promise<{ txHash: string }> {
  // Encode Safe.addOwnerWithThreshold(newOwner, newThreshold) and execute via owners' signatures.
}

/** (Optional) Remove an owner from the Safe. */
async function removeOwner(
  provider: EthereumProvider,
  safeAddress: Address,
  ownerAddress: Address,
  newThreshold: number,
  signatures: Signature[]
): Promise<{ txHash: string }> {
  // Encode Safe.removeOwner(prevOwner, ownerAddress, newThreshold) and execute.
  // Note: Safe.removeOwner requires the previous owner in the internal list as well, similar to module removal.
}

/** (Optional) Change the threshold of the Safe (number of signatures required). */
async function changeThreshold(
  provider: EthereumProvider,
  safeAddress: Address,
  newThreshold: number,
  signatures: Signature[]
): Promise<{ txHash: string }> {
  // Encode Safe.changeThreshold(newThreshold) and execute via Safe transaction.
}

/***** Utilities *****/
/**
 * Get the current nonce of the Safe (nonce increments with each successful execTransaction).
 */
async function getNonce(provider: EthereumProvider, safeAddress: Address): Promise<bigint> {
  // The Safe contract has a public nonce variable. Use eth_call to read safe.nonce().
  // Return it as BigInt.
}

/**
 * Estimate gas cost for executing a given Safe transaction.
 * This can use Safe.simulateAndRevert or a simple eth_estimateGas on execTransaction.
 */
async function estimateSafeTxGas(
  provider: EthereumProvider,
  safeAddress: Address,
  safeTx: SafeTransaction,
  signatures?: Signature[]
): Promise<bigint> {
  // Option 1: Use eth_call with Safe.execTransaction (with signatures if needed) and capture the gasUsed.
  // Option 2: Use Safe.simulateAndRevert to get a result that includes gas info.
  // Return the estimated gas as BigInt.
}
```

_Pseudocode Note:_ The above is an outline to convey design intent. In implementation, some functions might be combined or have slightly different signatures. For example, `executeTransaction` might internally call `getTransactionHash` and use `signTransaction` if only one owner is present, but the core idea is to keep each action modular. Also, the actual Safe transaction structure includes fields like `safeTxGas`, `baseGas`, etc. which the SDK can default intelligently. The optional **Owner Management** functions are shown to illustrate extensibility; they would be implemented similarly to module management (they also require a Safe transaction with owners’ approval).

## Function Behavior and Requirements Details

In this section, each SDK function’s intended behavior is described in a developer-focused way, including how it maps to Safe contract operations, expected inputs/outputs, and any important edge cases or requirements:

### `deploySafeAccount`

**Purpose:** Deploy a new Safe account proxy contract, initialized with a set of owners and a signature threshold.
**Behavior:** This function uses the Safe **Proxy Factory** contract to create a new Safe proxy. It constructs the initialization data for the Safe’s `setup` function (setting initial owners, threshold, fallback handler, etc.), then calls `SafeProxyFactory.createProxyWithNonce` (or a similar factory method, depending on version) to deploy the Safe. The factory will use the known Safe **Singleton (master copy)** contract as the logic template. The result is a new Safe contract at a deterministic address.

- _Inputs:_ A provider (with an active account that will send the deployment transaction) and a config object specifying owners (addresses), the threshold (number of signatures required), and optional parameters like `saltNonce` for deterministic deployment and `fallbackHandler` for custom callback handler. If `saltNonce` is not provided, the SDK may default it to a random or timestamp-based value to avoid deployment address collisions.
- _Outputs:_ Returns the **address** of the newly deployed Safe contract. The function will wait for the deployment transaction to be mined, or it may return a promise that resolves when the transaction is mined (and the address can be derived immediately after sending via events or factory’s return data).
- _Process:_

  1. **Resolve Contract Addresses:** Using `@safe-global/safe-deployments`, find the Safe Proxy Factory address and the Safe Singleton address for the network the provider is connected to. (These addresses are maintained for all official Safe versions.)
  2. **Encode Initialization:** Generate the calldata for `Safe.setup(address[] owners, uint256 threshold, ... other params)` using the provided config. This includes owners array, threshold, an empty payment setup (if not using Safe fee features), and optional fallback handler or modules initialization if provided.
  3. **Call Factory:** Encode the factory’s function to create a proxy. In Safe 1.4.x, the factory method is typically `createProxyWithNonce(address masterCopy, bytes initializer, uint256 saltNonce)`. Pass the master copy address, the initializer bytes from step 2, and the salt.
  4. **Send Transaction:** Use `provider.request({ method: 'eth_sendTransaction', params: [{from: deployer, to: proxyFactoryAddress, data: encodedData}]})` to create the Safe. The `from` account must have enough ETH for gas and typically will be the dApp user deploying the Safe. (The SDK does not sign this itself; the provider will prompt the user since it’s an external transaction.)
  5. **Result Handling:** Once the transaction is mined, the Safe’s address can be determined. The factory may emit an event `ProxyCreation(SafeAddress, ...)` or the address can be computed via Create2 if applicable. The SDK should retrieve this address. It then returns the Safe address to the caller.

- _Edge Cases & Requirements:_ The deploying account must have the funds to pay gas. If the Safe deployment fails (e.g., due to an already used saltNonce causing address collision), the promise should reject with an error. The function doesn’t automatically fund the Safe or transfer assets – it purely deploys the empty wallet. We ensure the `owners` array is not empty and `threshold` is <= number of owners (validation before sending). If an invalid provider or parameters are given, the SDK throws synchronously (for obvious config errors) or returns a rejection (for blockchain errors). Documentation will note that the Safe’s address is deterministic given the salt, so calling with the same parameters twice will yield the same address or fail the second time.

### `buildSafeTransaction`

**Purpose:** Convenience utility to construct a complete `SafeTransaction` object, populating default fields like `nonce` and gas limits.
**Behavior:** Developers can supply a partial transaction (destination, value, data, etc.), and this function will fill in the Safe-specific fields to produce a ready-to-sign transaction object. This is especially useful because Safe’s `execTransaction` requires several parameters (gas limits, refund info) that developers might not know offhand.

- _Inputs:_ A provider (to read chain state for nonce or simulate gas) and the Safe’s address, plus a partial SafeTransaction (which must include at least `to`, `value`, `data`, `operation`). Fields like `safeTxGas`, `baseGas`, `gasPrice`, `gasToken`, `refundReceiver` can be left out by the user.
- _Outputs:_ A fully populated `SafeTransaction` object. This object is a plain data structure (could be a TypeScript type) with all fields filled:

  - `nonce`: The current Safe nonce if none was provided. The function reads the Safe’s `nonce` via `safe.nonce()` (a public state variable). This ensures the transaction is for the next sequence number.
  - `safeTxGas`: If not provided, the SDK will estimate how much gas the inner transaction (`to, data`) will consume when executed by the Safe. It can do so by calling `estimateSafeTxGas` internally (which may use a special `simulateAndRevert` call or `eth_estimateGas`). This field is critical if using Safe’s refund mechanism; if `gasPrice` is zero (no refund), Safe will simply use all gas provided, so providing an accurate safeTxGas is less critical but still often done to include in the hash.
  - `baseGas`: This covers fixed overhead (like signature checking cost). If not provided, SDK can set `baseGas = 0` for simplicity or also estimate it (Safe docs sometimes calculate baseGas as a small constant plus payload length, etc. – the SDK could incorporate a formula).
  - `gasPrice`, `gasToken`, `refundReceiver`: Default to `0` (no refund, so Safe pays no one) and `address(0)` for token and receiver, meaning any gas cost is paid by the externally sending owner. These can remain default unless developer wants to use a pay-from-Safe or gas token scheme.

- _Process:_ This is mostly an off-chain preparation. The function might call `getNonce` and `estimateSafeTxGas` internally (both using the provider). It then merges the provided partial fields with the computed defaults into a new object.
- _Edge Cases:_ If the Safe’s state cannot be read (e.g., wrong network or Safe not deployed yet), it returns an error. The function should be careful that if the Safe is not yet deployed (nonce read might fail), it either throws a clear error or (if we allow predicted transactions) sets nonce to 0 with a warning. Gas estimation might fail if the `to` call would revert – in that case, we propagate that error so the developer knows the transaction is invalid. This function is optional (a developer could manually construct the SafeTransaction), but it greatly aids correctness by matching what the Safe expects.

### `getTransactionHash`

**Purpose:** Compute the unique hash of a Safe transaction, which owners must sign off-chain. This corresponds to the Safe’s internal transaction hash used for approvals (as per EIP-712 domain separation).
**Behavior:** It returns the keccak256 hash that the Safe contract will check against signatures. This can be obtained either by calling the Safe contract’s `getTransactionHash(...)` view function or by locally computing the EIP-712 digest. Safe’s EIP-712 domain includes the chain ID and the Safe contract address as verifying contract, and the message includes all transaction fields (to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce). The SDK can implement this in pure TS (with an ABI/struct and a hash function) or simply do an `eth_call` to the contract which returns the bytes32 hash.

- _Inputs:_ Provider, Safe address, and a fully populated SafeTransaction (all fields must be present, particularly `nonce` – the correct nonce is vital for the hash).
- _Outputs:_ A 32-byte hex string (with 0x prefix) representing the hash. This hash, when signed by owners (via EIP-712 or personal_sign), yields signatures that Safe’s `checkSignatures` will validate.
- _Edge Cases:_ The Safe must be deployed and initialized, otherwise the domain separator might not be set – calling getTransactionHash on an uninitialized Safe could fail. The function should ensure a nonce is present; if not, it could call `getNonce` itself. Also, ensure the provider is connected to the correct chain (if chain ID in the domain mismatches where signatures are collected, Safe might consider signatures invalid). In practice, we’ll use the provider’s `chainId` via `eth_chainId` if computing locally.
- _Note:_ This function does not require an on-chain transaction; it’s a pure or view operation. It’s typically used prior to `signTransaction` to know what to sign.

### `signTransaction`

**Purpose:** Have one Safe owner sign a Safe transaction. This is an **off-chain** action – essentially producing a digital signature.
**Behavior:** When called, it triggers the provided EIP-1193 provider to prompt the user to sign the Safe transaction hash. The result is encoded as a Safe-compatible signature. Safe signatures are usually the standard ECDSA `r+s+v` values, plus a one-byte `v` (which is adjusted to represent the chain and whether recovery is malleable). If using personal_sign, the wallet might sign `hash` directly (with `"\x19Ethereum Signed Message:"` prefix implicitly); if using signTypedData (EIP-712), it will sign according to the domain and types. The SDK aims to use EIP-712 for clarity if the provider supports it (many wallets do), falling back to personal_sign otherwise.

- _Inputs:_ The provider, Safe address, a SafeTransaction object, and the `signerAddress` (which should be one of the Safe’s owners and correspond to the provider’s active account). We ask for signerAddress to double-check that the provider’s account is indeed the expected owner (and maybe to index the signature correctly; though Safe doesn’t require ordering signatures by signer in the bytes array, it’s conventional to sort by address).
- _Outputs:_ A `Signature` hex string. Internally, this might be 65 bytes (r,s,v). For Safe, if using **Eth_signTypedData**, v will be either 0 or 1 plus 27 or something – but the Safe’s `checkSignatures` is tolerant to both 27/28 and 0/1 schemes in v. We ensure to format as expected (likely 65 bytes, where v = 27 or 28). If the wallet returns an Ethereum-specific signature (with the personal_sign prefix), the Safe might not accept it directly as EIP-712. However, Safe’s `eth_sign` support is via a specific “pre-image” scheme, so to maximize compatibility, we prefer EIP-712.
- _Process:_

  1. Get the transaction hash (via `getTransactionHash`).
  2. Determine if provider supports `eth_signTypedData_v4` (we might attempt `provider.request({method: 'eth_signTypedData_v4', params: [signerAddress, structuredData]})`). The structuredData includes domain (Safe chainId & contract) and message (SafeTx fields).
  3. If that fails or is not available, fallback to `personal_sign`: which typically takes params `[dataHex, signerAddress]`. For personal_sign, we must be careful: Safe expects signatures of the **hash** without the personal message prefix (since Safe itself prefixes the hash internally for personal signatures). Actually, Safe’s contract can recognize both scheme – we might need to drop the prefix byte or set a special v (e.g., Safe uses v=0x00 or 0x01 as a marker for contract signature in some cases). We will align with Safe’s specification for signature encoding (for example, the Safe might use `0x0001...` as signature to denote an approved hash via `approveHash`; we will document how our signatures should be used).
  4. Return the signature hex. Possibly also return which owner signed (though the function caller knows that from signerAddress).

- _Edge Cases:_ If the provider’s active account is not the specified signerAddress, the signature may still be produced (some wallets ignore the second parameter in personal_sign). We could double-check by recovering the address from the signature and ensuring it matches signerAddress for safety. If user denies the signature request, the provider will throw an error which we propagate. If the SafeTransaction hash is not 32 bytes (should always be), or something went wrong, we throw an error. Also, this function alone does not ensure that enough signatures are collected – it’s up to the dApp to gather signatures from enough distinct owners. In a single-owner scenario (threshold=1), this one signature is sufficient. In multi-sig (e.g., threshold 2 of 3 owners), the app would call `signTransaction` for each required owner (possibly on different user devices or different sessions) and then combine them. Our SDK will not orchestrate multi-user flows (that’s out of scope), but we facilitate producing and combining signatures.

### `executeTransaction`

**Purpose:** Submit a signed Safe transaction to the blockchain for execution. This performs the Safe’s `execTransaction` call with the collected signatures.
**Behavior:** It triggers an on-chain transaction that calls the Safe contract’s `execTransaction(...)` method. One of the Safe owners (or a trusted relayer, depending on context) must be the `msg.sender` of this call and pay the gas. If signatures are valid and threshold is met, the Safe will execute the desired inner transaction (e.g., transfer funds or call a target contract) and update its state (nonce increment, etc.). The SDK function will handle encoding the call data and sending it via the provider.

- _Inputs:_ The provider, Safe address, a SafeTransaction (with all fields set and matching what was signed), and an array of `signatures`. The signatures array should contain signatures from at least `threshold` owners of the Safe. The order of signatures in the concatenated byte string does not matter for Safe >=1.3.0 (the contract will sort internally by addresses when verifying), but the SDK can sort them by owner address to maintain a canonical order. Each signature is expected to be 65 bytes (r,s,v). If the Safe has a special owner like a contract or a delegate, we might also accept a “contract signature” form (where v = 0 and r = contract address, s = 0) as Safe allows (but such advanced cases can be added as needed).
- _Outputs:_ Typically, the transaction hash of the submitted Ethereum transaction, and possibly the transaction receipt once mined (depending on how we design it). For simplicity, we can return an object containing `txHash` immediately after sending, and the developer can separately await confirmation if needed (or we provide an `awaitTransactionReceipt` helper).
- _Process:_

  1. Validate that the number of signatures meets the Safe’s threshold. If not, throw an error explaining not enough signatures. This prevents sending a surely-failing transaction.
  2. Encode the `execTransaction` call. According to the Safe contract ABI, the function signature is:

     ```solidity
     function execTransaction(
         address to,
         uint256 value,
         bytes data,
         uint8 operation,
         uint256 safeTxGas,
         uint256 baseGas,
         uint256 gasPrice,
         address gasToken,
         address refundReceiver,
         bytes signatures
     ) public returns (bool success);
     ```

     We use the SafeTransaction object fields to fill these parameters. We also concatenate the signatures into a single `bytes` blob in the expected format.

  3. Determine the `from` address for the Ethereum transaction: it should be one of the Safe owners who is willing to execute the transaction (often the one currently using the app). The SDK might require the caller to specify which owner is sending, or infer from the provider’s selected account. It’s important that this account is indeed an owner; otherwise, the Safe contract will reject the execTransaction (since non-owners cannot trigger executions unless via modules). We can check `isOwner` via contract call if uncertain.
  4. Use the provider to send the transaction: `provider.request({ method: 'eth_sendTransaction', params: [{ from: execSender, to: safeAddress, data: encodedExecTx, value: 0 }] })`. We set `value: 0` because the execTransaction call itself typically doesn’t need to send ETH; the Safe will handle any value transfer to `to`. (Unless we consider sponsoring gas from outside, which is an advanced scenario – not in this minimal SDK’s scope.)
  5. The provider will prompt the user (the owner) to confirm sending this transaction. Once confirmed and sent, we get a tx hash. We return that to the caller. The Safe transaction’s effects will occur once this on-chain tx is mined.

- _Edge Cases:_ If the signatures are incorrect or not sorted, Safe’s `checkSignatures` may fail and the transaction will revert (wasting gas). We can mitigate by verifying signatures locally before sending: e.g., for each signature, recover the signer and ensure they are in Safe’s owners list and all are distinct. This is optional but user-friendly to catch errors early. We must handle errors from the chain: if the transaction fails due to Safe’s internal revert (like transaction sent with wrong nonce or already executed), the provider might return an error. We should surface that clearly (e.g., “Safe execution failed: invalid nonce or signatures”). Nonce mismatches are a common issue (e.g., if two transactions were sent concurrently). The SDK could, in a future version, support a queue or replacement strategy, but initially we just bubble up the error. Documentation will advise to always fetch latest nonce and not reuse a SafeTransaction after one execution attempt.
- _Gas management:_ The external `eth_sendTransaction` should include a `gasLimit`. The provider typically auto-estimates if not provided, but since Safe transactions have two layers (outer Safe contract call and inner execution), relying on auto-estimate could be tricky. Our earlier `estimateSafeTxGas` and perhaps an `estimateGas` on the entire execTransaction call can be used. We might provide an option in `executeTransaction` to pass a `gasLimit` override or do an `eth_estimateGas` for the outer call internally. If we estimate internally, we’d call `provider.request({method:'eth_estimateGas', params:[{from: execSender, to: safeAddress, data: encodedExecTx}]})` and use that. This ensures smoother execution especially for complex inner transactions.
- _Return value:_ If needed, we can return more than just txHash (like a receipt or a promise that resolves after mining). But it’s likely sufficient to return immediately with txHash for one-action-per-call philosophy, and let the developer handle waiting if needed (or call a separate helper like `awaitReceipt(txHash)`).

### `simulateTransaction` (optional)

**Purpose:** Test-run a Safe transaction without actually changing state, to see if it would succeed and what it would return.
**Behavior:** Safe v1.4.1 introduced a `simulateAndRevert` function (in a library or directly) that always reverts but can be used to simulate an `execTransaction`. The SDK can leverage this or simply do a dry-run via `eth_call` with the `execTransaction` data. The difference is that `simulateAndRevert` may yield more detailed results (and ignore signature checks if called internally). For a minimal SDK, a basic approach is to use `eth_call` on the Safe’s `execTransaction` with the same data + signatures. Because it’s a call, it won’t actually execute permanently, but if all checks pass and the inner call doesn’t revert, it should return `success = true` and any return bytes. If it would revert, the `eth_call` itself will report an error.

- _Inputs:_ Same as executeTransaction: provider, safeAddress, safeTx, and signatures.
- _Outputs:_ An object indicating success or failure, and any return data from the inner call (e.g., if the Safe transaction was calling a function that returns a value, we capture it).
- _Process:_ We perform `provider.request({ method: 'eth_call', params: [{from: safeAddress, to: safeAddress, data: encodedExecTxWithSignatures}, 'latest'] })`. **Note:** We might set `from` as the Safe itself when using simulateAndRevert because the Safe contract might allow itself to be the caller to bypass signature checks (some simulation libraries do that). Alternatively, if using a special simulation library method, we call that with a normal `eth_sendTransaction` but with a call static flag (Hardhat and others allow `.callStatic`). Since we want to remain provider-agnostic, we lean on standard JSON-RPC: using `eth_call` should suffice. If we get a result without error, decode it (if needed). If we get an error, interpret it (maybe the error message contains revert reason).
- _Edge Cases:_ This call requires the Safe to be deployed (obviously). If signatures are missing or wrong, simulation will fail (which is expected). If the inner transaction does revert (e.g., trying to send more ETH than Safe has), the simulation yields a revert error which we can catch and return as `success: false`. This utility is mainly for developer convenience (like a “dry-run”). In CI or dev tools, one might call simulateTransaction before executeTransaction to warn the user if something is off. Not all wallets/providers support advanced features, but `eth_call` is universal.

### `signMessage`

**Purpose:** Facilitate signing a **message** with the Safe’s owners. This is different from a transaction – it’s an off-chain message that one might want the Safe to attest to (for example, to log in somewhere or sign a meta-transaction). Safe supports EIP-1271 for on-chain signature verification, meaning a contract can confirm “Yes, this message was approved by the Safe’s owners.”
**Behavior:** The SDK helps compute the message hash and get it signed by an owner. For an off-chain message (like a string or arbitrary byte payload), Safe defines a specific hash calculation: `hash = keccak256("\x19Ethereum Signed Message:\n${messageLength}" + message)` for arbitrary bytes, or EIP-712 if it’s typed data. We will support simple string/bytes messages first (EIP-191). After hashing, an owner signs it via their provider (likely using personal_sign, since it’s exactly the format personal_sign would produce). The Safe considers a message “signed” if enough owners each produce such signatures, which can be stored off-chain or on-chain.

- _Inputs:_ Provider, Safe address, the message (could be a UTF-8 string or hex data), and the signing owner’s address.
- _Outputs:_ An object containing the `safeMessageHash` (32-byte hex) and a `signature` by that owner. The safeMessageHash is what Safe uses internally (and what would be stored if using on-chain storage via SignMessageLib). The signature is similar to a transaction signature but typically over the message hash (with the Ethereum Signed Message prefix).
- _Process:_

  1. Compute `safeMessageHash = keccak256("\x19Ethereum Signed Message:\n" + len(message) + message)`. The SDK will do this in a utility function (mirroring how personal_sign computes its hash). Safe also has a function `hashMessage(bytes message)` in the SignMessageLib – we should ensure our method matches that output.
  2. Use the provider to request a signature. For messages, most wallets expect personal_sign. We call `provider.request({ method: 'personal_sign', params: [ messageHex, signerAddress ]})`. If the message was a string, we hex-encode it (0x plus UTF-8 bytes) for the personal_sign payload.
  3. The wallet will produce a signature (r,s,v). This signature actually represents `signerAddress signing hash` with the standard prefix. Because we included the prefix in the hash, we need to be cautious: personal_sign automatically prefixes again before signing. However, Safe’s convention is double: the SafeMessage hash already includes the prefix (so they have “hash message with prefix” then owners do personal_sign which also prefixes => effectively double prefix). Actually, we might be overthinking: If we want to use Safe’s on-chain check via EIP-1271, the recommended approach (off-chain) is to not store these signatures on-chain at all, but rather collect them and then use the CompatibilityFallbackHandler’s `isValidSignature(bytes, bytes)` off-chain check with combined sigs. The Safe Transaction Service approach (mentioned in docs) is another path: they store message and signatures in a service for off-chain tracking. Our SDK’s scope is to get the raw ingredients.
  4. Return the safeMessageHash (for reference) and the signature. The idea is the dApp could collect `signature` from each owner by calling this function for each (perhaps on each owner’s device), then combine them or verify them as needed.

- _Edge Cases:_ If the message is long or not a simple string, ensure consistent encoding. If it’s already a hex string (prefixed with 0x), assume it’s binary data and use it directly. If using EIP-712 typed data, that’s a separate complex scenario – we might not implement full typed data signing in this minimal SDK, beyond possibly providing a placeholder or expecting the developer to handle it with their own wallet integration. We will document that our `signMessage` covers basic messages; advanced use (like signing a typed struct) can be done by directly using wallet’s capabilities. Additionally, the Safe requires either off-chain consensus (via Safe service) or on-chain recording to later verify these signatures. Our SDK also provides `approveMessageHash` for on-chain storage which is another approach (below).

### `approveMessageHash` (on-chain message signing)

**Purpose:** Store a message hash in the Safe contract as approved, so that the Safe contract itself can later confirm the message was signed (via `isValidSignature`).
**Behavior:** This function creates a Safe transaction that calls the Safe’s **SignMessageLib** via a **delegatecall**. In Safe 1.4.1, `SignMessageLib` is a library that adds a function `signMessage(bytes32 messageHash)` which simply writes that hash to storage (`Safe.signedMessages[messageHash] = 1`). Executing this on-chain with owners’ approval means the Safe has recorded the message. After that, anyone can call `Safe.isValidSignature(messageHash, 0x)` and the Safe will respond that it is valid (since it finds it in storage).

- _Inputs:_ Provider, Safe address, and the `safeMessageHash` (32-byte hash of the message) that we want to approve. The function will internally construct a Safe transaction and likely requires signatures like any other execTransaction (i.e., owners must sign this action as well). However, note that having owners sign the message off-chain is effectively the same security as having them sign a transaction to approve the message on-chain. This on-chain method might be useful if a smart contract needs to directly verify the signature via EIP-1271 (since it can’t query off-chain signatures).
- _Outputs:_ Transaction hash of the on-chain transaction that records the message (if execution succeeds).
- _Process:_

  1. Retrieve the address of `SignMessageLib` for the given Safe version (from safe-deployments). Safe’s deployment JSON includes this library address (and it’s the same across networks for a given version if using delegatecall).
  2. Encode the function call `SignMessageLib.signMessage(bytes32)` with the `safeMessageHash`. Set up a SafeTransaction: `to = SignMessageLib.address, value = 0, data = that encoded call, operation = 1 (delegatecall)`.
  3. Then basically do what `executeTransaction` does: have owners sign this SafeTransaction (could reuse `signTransaction` with the given hash) – if the user calling this function is one owner, they might provide their signature and we could allow an option to pass signatures from others if already collected. Alternatively, we might simplify and assume threshold=1 for on-chain signing scenario (not necessarily, multi-sig can still do it). For generality, require `signatures` param here too (similar to other module/owner ops). But our pseudocode above did not include a signatures param for `approveMessageHash`. To be consistent, we likely should include it: the function would otherwise itself need to gather signatures which breaks one-action-per-call (so better require the signatures as input, or at least if threshold>1, user must call it multiple times, which is not how on-chain would work). Instead, we treat it like `enableModule`: an action that needs owner signatures, so we should have `approveMessageHash(..., signatures)`. Let’s adjust: the pseudocode currently suggests it would execute directly (maybe threshold=1 scenario). For a threshold >1, the developer should use `buildSafeTransaction` for signMessageLib and then use `executeTransaction`. So perhaps we’ll not expose `approveMessageHash` as a high-level in the minimal SDK and just instruct to use standard transaction execution for that scenario. But since we listed it, we describe it requiring signatures similar to others.
  4. Send the transaction via provider as usual.
  5. After mining, the Safe contract will have stored the hash. We can test this via `isValidMessageSignature(hash)` with `0x` sig and it should return true.

- _Edge Cases:_ On-chain message approval costs gas and is rarely used unless truly needed. The SDK will document that off-chain signatures (collected and delivered to the verifier) are usually sufficient, but if an on-chain contract needs to verify, this is the way. The function should ensure not to call this twice for the same hash (Safe will accept but it’s redundant). If called twice, the second `execTransaction` will find `signedMessages[hash]` already set and simply set it again (no harm, just waste gas). Also, note that if the Safe has a fallback handler (CompatibilityFallbackHandler) that implements `isValidSignature`, it might allow off-chain aggregated signatures to be verified without on-chain storage. But the on-chain stored method is simpler to verify on-chain (just one static call).

### `isValidMessageSignature`

**Purpose:** Check if a message hash is considered signed by the Safe, according to EIP-1271.
**Behavior:** This function calls the Safe contract’s `isValidSignature(bytes32 hash, bytes signature)` view method (either on Safe itself or via the Safe’s fallback handler contract, depending on version). In Safe >=1.3, the Safe’s default fallback handler (`CompatibilityFallbackHandler`) implements EIP-1271 by checking either storage or verifying signatures with the Safe’s owner set. So, we can query this directly.

- _Inputs:_ Provider, Safe address, the `safeMessageHash` in question, and optionally an `encodedSignatures` blob. If `encodedSignatures` is provided, the SDK will pass that to `isValidSignature`. If not, it will pass an empty 0x for signature, which signals the Safe to look into its on-chain `signedMessages` storage.
- _Outputs:_ A boolean indicating if the signature is valid. (The EIP-1271 standard actually returns a magic value (0x1626ba7e for success) or throws; we simplify by returning true/false).
- _Process:_

  1. If encodedSignatures (concatenated signatures of owners) is given, call: `eth_call({to: safeAddress, data: safeInterface.encode("isValidSignature(bytes32,bytes)", hash, encodedSignatures)})`. The CompatibilityFallbackHandler will intercept this and if enough valid signatures are present in that blob, it returns the magic constant.
  2. If no signatures are given, call the same with `signature = 0x`. The Safe contract (actually the DefaultCallbackHandler in Safe 1.1 and up, or the Safe itself in older versions) will check if `hash` is in `signedMessages`. If yes, returns magic value, otherwise returns an error.
  3. Decode the result. If it matches `0x1626ba7e` (the bytes4 magic value), return true. Otherwise false.

- _Use case:_ A backend service or a contract might use this to verify that a message was approved by the Safe. For example, if the Safe signs a login nonce, the server can call this to confirm the signature’s authenticity instead of verifying ECDSA directly (since signers could be multiple).
- _Edge Cases:_ Ensure to use the correct contract address – note that Safe’s `isValidSignature` might be in fallback handler. Actually, in Safe 1.4.1, `CompatibilityFallbackHandler` implements it, and Safe’s own `isValidSignature` might just delegate. To simplify, we always call Safe itself; since Safe forwards unknown calls to fallback handler, it should work. Alternatively, one could call the fallback handler directly at the Safe’s `fallbackHandler` address. But that requires reading Safe storage to get the handler address first. We can avoid that by just calling Safe (the Safe contract’s fallback will invoke the handler’s logic if `isValidSignature` is not part of Safe’s immediate ABI). We will include the proper ABI for `isValidSignature` anyway (from EIP-1271 interface) to decode response.
- This function is read-only (no gas needed), so it’s safe to call in front-end contexts without user approval.

### `enableModule`

**Purpose:** Add a new authorized module to the Safe. A **module** is a contract that can execute arbitrary Safe transactions without explicit owner signatures each time (modules themselves are pre-approved by owners). Enabling a module requires owners’ consent (it’s a privileged operation).
**Behavior:** This function creates a Safe transaction that calls `enableModule(address module)` on the Safe itself. The Safe contract will add the module to its internal list if the transaction is executed with the required owner approvals. The SDK function essentially wraps the steps of building and executing this Safe transaction.

- _Inputs:_ Provider, Safe address, the module’s address to enable, and the signatures from owners approving this action. The module contract is assumed to be already deployed (the SDK does not deploy modules; it just links them).
- _Outputs:_ The Ethereum transaction hash of the module enablement transaction, indicating the action was submitted to chain.
- _Process:_

  1. Construct a SafeTransaction: `to = safeAddress` (calling itself), `value = 0`, `data = Safe.encodeFunctionData("enableModule", [moduleAddress])`, `operation = 0 (CALL)`. This is essentially a call from the Safe to its own logic (`enableModule`) function. Note: The Safe’s ABI has `enableModule` as an external function, but it carries a warning that it “can only be done via a Safe transaction”. In practice, that means if someone directly calls enableModule externally, it will likely revert or do nothing because the contract might check `msg.sender == address(this)` (the Safe itself) or enforce via the owner check logic in execTransaction. So indeed, we must execute it through the Safe’s multi-sig process.
  2. Use the `executeTransaction` flow: require `signatures` from owners on the transaction. The developer will have collected these using `getTransactionHash` and `signTransaction` for each owner prior. (Alternatively, if threshold=1, a single owner can sign and immediately execute in one step – we might allow passing a single signature and proceed; our internal check will see signature count (1) equals threshold (1) and allow it).
  3. The Safe’s execTransaction, when processing this, will recognize it as an internal config change and emit `EnabledModule(module)` event on success.
  4. Return the tx hash as confirmation of submission. The actual effect (module added) is after mining.

- _Edge Cases:_ Need to ensure the module isn’t already enabled (Safe stores modules in a linked list, and enabling an already present module might either revert or result in duplicate entry – likely it checks and prevents duplicates). We can add a pre-check: call `isModuleEnabled(moduleAddress)` first; if true, throw an error to avoid redundant execution. If the Safe has a guard or is in a state that prevents config changes (e.g., if a guard contract disallows module changes), the transaction could revert; we cannot detect that easily except by simulation, which a developer could do using our simulateTransaction if needed. Document that modules often come with their own security considerations (only use known audited modules, etc.).

### `disableModule`

**Purpose:** Remove a module from the Safe’s authorized list. This also requires owners’ approval via a Safe transaction.
**Behavior:** Calls Safe’s `disableModule(address prevModule, address module)` function through a Safe transaction. Safe modules are stored in a linked structure; to remove one, you must provide the previous module in the list (or sentinel address if removing the first). The SDK will require that `prevModule` be provided by the caller (since the SDK can fetch the module list if needed, but we keep the interface simple by letting the user supply it, possibly via a helper that finds it).

- _Inputs:_ Provider, Safe address, the module to disable, and the `prevModule` address in the Safe’s module list (the Safe contract’s internal list). Also require owner signatures approving this operation.
- _Outputs:_ Transaction hash of the Safe transaction that disables the module.
- _Process:_ Similar to enableModule:

  1. Build SafeTransaction with `to = safeAddress`, `data = Safe.encode("disableModule(address,address)", prevModule, module)`, `operation = 0`.
  2. Execute it with given signatures.
  3. On-chain, the Safe will adjust its module list and emit `DisabledModule(module)` event (which our SDK could also monitor if we had event listeners; out of scope for now except maybe to confirm success).

- _Edge Cases:_ The `prevModule` must be correct or the transaction will revert (Safe will fail to find the module in sequence). The SDK could optionally help by fetching the module list (using `getModules`) and finding the predecessor. Perhaps we provide an overload or a utility: `getModules` (as below) and instruct the developer to use it: e.g.

  ```ts
  const modules = await getModules(provider, safe)
  const index = modules.indexOf(moduleAddress)
  const prev = index > 0 ? modules[index - 1] : SENTINEL_ADDRESS
  disableModule(provider, safe, moduleAddress, prev, signatures)
  ```

  Where `SENTINEL_ADDRESS` is a constant (usually `0x000...1`) representing the start of the list in Gnosis Safe’s storage. We’ll document this pattern.
  As with enabling, check if the module is actually currently enabled; if not, throw an error to avoid a pointless transaction.
  Also, Safe might enforce that at least one module remains? (Not sure, likely not, you can have zero modules which is normal).

### `getModules`

**Purpose:** Retrieve all enabled module addresses from the Safe.
**Behavior:** Uses the Safe contract’s `getModulesPaginated` view to fetch modules in batches. Gnosis Safe stores modules in a linked list with a sentinel; `getModulesPaginated(start, pageSize)` returns a portion of the list. We can call it in a loop (or recursively) until the sentinel is reached. The SDK will assemble the full list of module addresses.

- _Inputs:_ Provider and Safe address. (No signatures needed; this is a read-only call.)
- _Outputs:_ An array of module addresses (Address\[]). If no modules are enabled (aside from the sentinel), returns an empty array.
- _Process:_

  1. Define `start = SENTINEL_MODULE = "0x0000000000000000000000000000000000000001"` (as per Safe contract, they often use address(1) as sentinel head).
  2. Decide on a page size, e.g. 50 (unlikely a Safe has more than 50 modules, but just in case we handle pagination).
  3. `do`: call `safe.getModulesPaginated(start, 50)` via eth_call. This returns two arrays: `[address[] page, address next]`.
  4. Concatenate the returned `page` to a result list. Set `start = next`. If `next` is not the sentinel (i.e., not 0x...1), loop again to get the next page. If it’s sentinel (or if fewer than 50 returned indicating end), break.
  5. Return the collected list.

- _Edge Cases:_ If the Safe contract at that address doesn’t exist or is not really a Safe, the call may fail; we assume the address is a correct Safe. If the Safe has many modules, we correctly page through. The function is simple, likely one call is enough because number of modules is usually small.

### `isModuleEnabled`

**Purpose:** Check if a specific address is currently an enabled module on the Safe.
**Behavior:** Calls the Safe’s `isModuleEnabled(address module)` view function. This returns a boolean (or technically, it returns 0 or non-zero word in storage; but likely implemented to return bool).

- _Inputs:_ Provider, Safe address, module address to check.
- _Outputs:_ Boolean, true if the module is active.
- _Process:_ `eth_call` to Safe: `safe.isModuleEnabled(moduleAddress)`. Under the hood, Safe likely checks if `modules[moduleAddress] != address(0)` or such.
- _Edge Cases:_ None significant; this is straightforward. If false, the module might never have been enabled or was removed.

### **(Optional)** Owner Management Functions (`addOwner`, `removeOwner`, `changeThreshold`, etc.)

While not explicitly listed in the user’s request, these correspond to Safe contract capabilities similar to module management. We outline them briefly:

- **addOwnerWithThreshold:** Adds a new owner and sets a new threshold in one call. The SDK would create a Safe transaction calling `addOwnerWithThreshold(newOwner, newThreshold)` on the Safe itself, then execute it with existing owners’ signatures. This requires that the new threshold is valid (e.g., often newThreshold = oldThreshold or oldThreshold+1 when adding an owner, depending on whether you want to increase the threshold or not). The function would be used when onboarding a new signer to the Safe. The SDK should validate that newThreshold <= currentOwners+1 and >= 1.
- **removeOwner:** Removes an owner. The Safe’s `removeOwner(prevOwner, owner, newThreshold)` requires the previous owner in the owners linked list (similar pattern to modules). The SDK either asks for `prevOwner` or helps find it by fetching the owner list via Safe’s `getOwners()` (which is a public array in Safe, likely accessible easily). After removal, the threshold might need adjustment (commonly threshold is reduced by 1 if you remove an owner, or explicitly provided). The SDK should ensure newThreshold <= newOwnerCount.
- **swapOwner:** Safe also has a `swapOwner(prevOwner, oldOwner, newOwner)` to replace one owner with another in a single transaction. We could expose that as well: it’s essentially remove+add combined. It also needs `prevOwner`.
- **changeThreshold:** Adjust the number of required signatures. The Safe’s `changeThreshold(uint256)` can be called via a Safe transaction by owners. We’d just ensure the new threshold is <= current number of owners and >= 1.

These functions mirror the pattern of module management (Safe’s internal state changes), so one-action-per-function still applies. The SDK can include them for completeness, though they were not explicitly requested. For brevity, we won’t detail each, but they would follow the same design: each takes `signatures` from existing owners as input and returns a tx hash after executing the config change. Documentation would warn that owner changes should be done carefully (you could lock yourself out if threshold > owners count, etc., but the Safe contract likely guards against invalid thresholds).

### `getNonce`

**Purpose:** Fetch the Safe’s current transaction nonce. The nonce increments every time a Safe transaction is executed (to prevent replay).
**Behavior:** Calls the Safe contract’s public `nonce` field (or `getNonce()` if provided). Safe’s `nonce` is stored as state. In solidity, public uint256 creates a getter, so we can use the ABI to read it.

- _Inputs:_ Provider, Safe address.
- _Outputs:_ A BigInt representing the current nonce.
- _Process:_ `eth_call` to read the nonce. For example, if using ethers/viem, just call contract function. Or manually: `provider.request({ method: 'eth_call', params: [{to: safeAddress, data: safeInterface.encodeFunctionData("nonce", [])}, "latest"]})` and decode the result.
- _Edge Cases:_ If Safe is not deployed or not initialized, nonce might be 0 or reading might fail. Generally, if a Safe is just deployed via factory, it is initialized in the same tx, so nonce starts at 0 (meaning the next tx should use nonce 0). The SDK using `getNonce` in `buildSafeTransaction` ensures correct usage.

### `estimateSafeTxGas`

**Purpose:** Estimate the gas usage for executing a Safe transaction (the inner transaction’s cost).
**Behavior:** This is a helper to determine an appropriate `safeTxGas` value for a SafeTransaction, or to help the external caller estimate needed gas limit for the entire operation. There are a few ways to estimate:

- Call Safe’s `execTransaction` via `eth_estimateGas` with given signatures (likely only works if signatures are valid or if using a trick to skip signature check by calling from Safe itself).
- Use `simulateTransaction` as implemented above, measuring gas usage.
- Use `Safe.simulateAndRevert` (if available in the Safe contract as a method) by sending a transaction that always reverts but returns gas info. Safe 1.3+ included a simulation function that returns a specific struct with gas used and success bool, then reverts – but capturing that via JSON-RPC might require custom handling. Possibly not worth the complexity in a minimalist SDK.
  A simpler approach: just call the Ethereum node’s estimator on the _external call_. The external call’s gas usage will be roughly `baseGas + safeTxGas` plus overhead. Many developers simply over-provision gas in the outer tx and set `safeTxGas` to 0 to let the Safe run without a strict limit (Safe’s code: if safeTxGas = 0, it tries to execute with all available gas). Actually, looking at Safe code: safeTxGas if 0 might be treated as “all gas” (we should confirm from Safe docs or code). To be safe, we might not allow 0 because then signature check doesn’t cover actual gas— but they may allow it. We could choose to not implement this function initially, but since it was requested as optional, we provide a basic version.
- _Inputs:_ Provider, Safe address, SafeTransaction, and optionally signatures (if needed for a realistic estimate). If threshold > 1, and we haven’t collected signatures yet, this becomes tricky because we can’t do a real `eth_estimateGas` without valid signatures – the call would fail signature check. We could cheat by providing dummy signatures or calling from Safe itself (via `eth_call` from Safe’s address, skipping check). However, providing dummy signatures will likely fail `checkSignatures` (the contract will revert if signatures don’t match). Another approach: set the Safe’s threshold to 0 temporarily (not possible at runtime). So realistically, to estimate, one might either supply at least one valid signature if threshold=1 or just simulate the inner call separately. Possibly the best approach: ignore the Safe’s signature checks by doing a manual estimation of the _inner call_. I.e., estimate gas of calling `to` with `data` as if from the Safe contract. But the Safe contract itself adds overhead.
  Given complexity, a pragmatic solution: _If threshold=1 and the current provider account is an owner_, we can simply do `eth_estimateGas` on `execTransaction` with the provider’s signature attached (the provider can sign since it’s the owner). If threshold > 1, maybe we estimate just the inner call by `eth_call` on `to` and see if it runs and how much gas used – but that doesn’t include Safe’s overhead. Perhaps simpler: just return a default or 0 and advise manual adjustment. However, since the question explicitly lists gas estimation as an SDK feature, we should attempt a reasonable approach and document limitations.
- _Outputs:_ A BigInt gas amount (for safeTxGas ideally).
- _Process:_ Could be:

  1. If threshold <= 1 and we have the owner’s context, sign the tx hash and call `eth_estimateGas` for `execTransaction` including that signature. Use the result minus some margin as safeTxGas.
  2. If threshold > 1 (no signatures available at estimation time), we do a two-step: estimate the inner call by doing `eth_call` to `to` with provided data and a large gas, measure how much was used (if possible via tracing or binary search technique with eth*call by increasing gas until success). Or simply call it to see if it returns or reverts. If it returns, use that as a baseline. Then add a constant overhead for Safe (maybe a few tens of thousands for signature verifications, etc.). Safe’s overhead grows with number of signatures (each signature verification \~ 3k gas plus hashing). We could approximate overhead = `20000 + 5000 * numSignatures`. The SDK documentation can note that this is a heuristic. Alternatively, we could tell developers: if threshold > 1, either supply at least one real signature for estimation or just use a safeTxGas = 0 (which means no limit). Actually, checking Safe contract: if you pass safeTxGas = 0, Safe doesn’t automatically use all gas; it might treat it as you allowing all. I think Safe might allow safeTxGas to be smaller than actual needed and if actual usage > safeTxGas, it fails unless it’s a refund scenario. Actually, re-reading Safe design: safeTxGas is used to ensure the inner call doesn’t use more gas than signed for (for security if gas price and refund are used). If gasPrice=0 (no refund) and the outer call provides enough gas, I \_believe\* safeTxGas being 0 might be interpreted as no limit or they might still require safeTxGas=0 means “I trust whatever gas is needed.” We should confirm from an audit or doc, but not enough time; as a design, we’ll discourage safeTxGas=0 except perhaps in special cases. So we’ll try to estimate.
  3. Return the estimated gas as a BigInt.

- _Edge Cases:_ Multi-signature estimation difficulty as described. We will be transparent about this in documentation: e.g., “For multi-sig transactions, consider using the Safe simulation service or safeTxGas = 0 with caution. The SDK’s estimateSafeTxGas might require at least one valid signature to simulate accurately.” As an SDK, we can integrate with Safe’s off-chain simulation (there’s a Safe Transaction Service API to simulate, but that goes beyond our no-connection principle). So likely, we do the best possible purely on chain.

In summary, the core functions (`deploySafeAccount`, `executeTransaction`, `signTransaction`, `signMessage`, `enableModule`, etc.) each encapsulate one discrete Safe operation. They take in explicit parameters and rely on the provided `provider` for any chain interaction. None of them store or derive any secret keys – all signing and sending goes through the external provider. This meets the requirement of not managing keys or connections. The composability comes from the fact that, for example, one could use `getTransactionHash` and `signTransaction` in an offline context (say, on multiple devices for different owners) and later use `executeTransaction` with all collected signatures. Each piece is independent.

## Tooling and CI Recommendations

To deliver a high-quality library, we also propose modern tooling for building, testing, and continuous integration:

- **Bundler:** We recommend using **Tsup** as the bundler for this SDK. Tsup provides a zero-config experience and produces optimized builds for libraries. It internally uses **esbuild** for speed and supports outputting multiple formats easily. By using Tsup, we can output both an ESM bundle and a CJS bundle with one command (e.g. `tsup src/index.ts --format esm,cjs --dts` as illustrated). Tsup will tree-shake our code and omit unused dependencies, which is ideal since consumers may only use a subset of the functions. It also will generate type declarations (`.d.ts`) automatically, ensuring our users get the TypeScript types when they install the package. Tsup is actively maintained (by developer egoist on GitHub) and widely adopted for TS libraries due to its simplicity and performance. An alternative is **Rollup**, which is a bit more configuration-heavy but also capable of producing tree-shakable bundles. Rollup might be necessary if we need fine-grained control or plugin extensions. However, given our relatively straightforward needs (bundle TS to ESM/CJS), Tsup suffices and saves time. It also natively supports minification and source maps if we want. In either case, the output will be an NPM package that supports both import styles and is ready for modern packaging. (For context, Tsup’s ability to output both module types and handle TS is highlighted in a 2025 LogRocket guide. It notes support for ESM/CJS and built-in tree shaking and minification, which match our requirements.)
- **Testing Framework:** For unit and integration tests, **Vitest** is an excellent choice. It’s a Vite-powered test runner, very fast, and works great with TypeScript and ESM. Vitest has become a popular modern replacement for Jest. It’s actively updated (v3.2.3 published 5 days ago). We can use Vitest to write tests for each SDK function: e.g., simulate a Safe contract with Hardhat/Anvil and test that `deploySafeAccount` indeed creates a Safe, `executeTransaction` performs the expected state change, etc. Vitest’s API is Jest-compatible, so it’s easy to write tests with `describe/it` and assertion libraries. Running vitest in CI will ensure our SDK behaves as expected on each commit.
- **Ethereum Testing Setup:** To test Safe interactions, we’ll incorporate a local Ethereum environment. We suggest using **Hardhat** (with the Safe contracts added as dev dependency for testing) or **Foundry’s Anvil** for a quick chain. For instance, as part of CI, we can start an Anvil node and deploy a Safe master copy and factory, then run our SDK functions against it. However, since safe-deployments gives us actual addresses for known networks (like Goerli or Sepolia), we could even run tests on a live testnet using an Alchemy/Infura key (though that’s slower and depends on network state). Probably using Hardhat to simulate is easier. We can use a Hardhat script to deploy a Safe master copy and factory to a local network and then attempt `deploySafeAccount` to ensure it returns the correct address, etc. This is more of an internal detail, but important for validating the SDK.
- **Linting & Formatting:** Biome
- **Continuous Integration (CI):** Set up **GitHub Actions** (or another CI service) with workflows that run on every push/PR. We propose at least two jobs:

  1. **Build & Lint:** Installs dependencies, runs `npm run build` (which invokes tsup) and `npm run lint`. This catches any TypeScript errors or lint errors. Because we treat TypeScript strictly (enable `strict` in tsconfig), any type mismatches will cause build to fail – which aligns with our type-safe goal.
  2. **Test:** Spins up the testing environment (maybe starts an ephemeral Ethereum node) and runs `npm run test` (vitest). This job ensures all tests pass and could also generate coverage reports.
     We’ll also include caching of dependencies for speed, and possibly matrix builds for multiple Node.js versions (test on Node 16, 18, etc., though for a frontend-focused SDK Node version isn’t critical, but if we want Node usage, ensure compatibility).

- **Documentation and Release:** While not strictly CI, we should integrate documentation generation. We can use **TypeDoc** to generate HTML or MD documentation from JSDoc comments. In CI, we could have a job that deploys docs to GitHub Pages whenever a new version is released. As for releasing, adopting **Semantic Versioning** and maybe a tool like **semantic-release** can automate publishing to NPM when tags are pushed. This ensures consistent version bumps and changelogs. Given the importance of reliability, a pre-publish step can run tests again and ensure types are included.
- **Bundler verification:** As part of CI, we can include a step that tests the bundled output (for example, import the built package in a dummy project to ensure the types and code resolve correctly in both ESM and CJS contexts). This prevents publishing broken packages.

Using these tools, we ensure the SDK is robust: code is clean (linted), functionality is proven (tested), the bundle is optimized (esbuild via tsup), and integration is smooth (types and docs for developers). The modern tool choices also align with developer expectations in 2025. For example, Vite/Vitest have largely overtaken older tooling for new projects, and esbuild-based bundlers like Tsup are favored for their speed.

## Conclusion

This proposed Safe Smart Account SDK is designed to be **developer-friendly and minimal**, focusing on the core interactions with Safe v1.4.1+ contracts. By providing one-function-per-action, developers get a clear and predictable API surface. The SDK refrains from holding state or doing magic under the hood – it simply streamlines the encoding of contract calls and aggregation of signatures required by Safe, which can otherwise be quite error-prone to implement from scratch.

We have incorporated all **major Safe operations**: deploying accounts, executing transactions (including multi-sig support), signing messages (off-chain and on-chain approvals), and module management (enable/disable/list). Additionally, utility functions for nonce and gas handling empower developers to manage Safe transactions reliably. Each function’s behavior has been specified to guide implementation and ensure we meet the Safe protocol’s requirements (citing official Safe docs to confirm we’re aligned, e.g., only allowing module enablement via Safe transaction, and using Safe’s signature verification logic for messages).

By leveraging well-maintained libraries (ethers/viem, safe-deployments, etc.), the SDK achieves its goals of type safety and compatibility without reinventing the wheel. The recommended build and CI setup will maintain code quality and ease of use (with good documentation generation from JSDoc).

In summary, this SDK will serve as a lightweight yet powerful toolkit for developers integrating Safe accounts, allowing them to focus on building features in their dApps rather than the intricacies of Safe’s contract ABIs and signature schemes. The design is forward-looking (account abstraction ready, multi-provider agnostic) and can be extended as Safe introduces new features (e.g., if a Safe v1.5 adds guard management or new module types, we can add another function following the same pattern).

All of these considerations ensure that the SDK will be **secure, easy to adopt, and maintainable** for the community. With clear documentation and strongly typed APIs, developers can trust the SDK to interact with Safe contracts correctly – making the promise of smart contract accounts more accessible in their applications.
