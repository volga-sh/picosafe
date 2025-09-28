# CLAUDE.md

This file provides comprehensive guidance to Claude Code (claude.ai/code) for efficiently working with the PicoSafe SDK codebase. It defines coding standards, workflow procedures, and architectural patterns to ensure consistent, high-quality contributions.

## Project Overview

PicoSafe is a minimalistic but advanced TypeScript SDK for Safe Smart Account contracts (v1.5.0+). The SDK follows a one-action-one-function principle, providing a simple API for Safe operations without managing keys or connections.

**Library Dependencies**: The SDK uses [Ox](https://oxlib.sh) as its core Ethereum library for ABI encoding, address manipulation, and cryptographic operations. Ox provides a minimal, type-safe API that aligns with PicoSafe's philosophy of simplicity and correctness.

## Key Commands

### Global Commands (Run from root directory)

These commands run across all packages or apply globally:

```bash
npm run build                       # Build all packages (currently builds @volga/picosafe)
npm run dev                         # Run development mode for all packages
npm run format                      # Format entire codebase with Biome
npm run check                       # Lint entire codebase with Biome
npm run check:write                 # Lint and fix entire codebase with Biome
npm run typecheck                   # TypeScript type checking for all packages
npm run test                        # Run tests for all packages
```

### Package-Specific Commands

Use the `-w` flag with the package name to run commands for a specific package:

```bash
# Development
npm run dev -w @volga/picosafe       # Watch mode development build for PicoSafe
npm run build -w @volga/picosafe     # Build the SDK (CJS and ESM)
npm run typecheck -w @volga/picosafe # TypeScript type checking for PicoSafe only

# Testing
npm run test -w @volga/picosafe     # Run tests with automated Anvil setup
npm run test:run -w @volga/picosafe # Run tests once (requires Anvil running separately)
npm run test:ui -w @volga/picosafe  # Run tests with Vitest UI
npm run coverage -w @volga/picosafe # Generate test coverage report

# Run specific test file
npm run test -w @volga/picosafe -- packages/picosafe/tests/deployment.test.ts
# Run specific test by pattern
npm run test -w @volga/picosafe -- -t "should deploy"
# Run tests matching file pattern
npm run test -w @volga/picosafe deployment
```

### Monorepo Structure

This is a monorepo managed with npm workspaces. The structure is:

```
picosafe/
├── packages/
│   ├── picosafe/        # Main SDK package (@volga/picosafe)
│   ├── anvil-manager/   # Anvil process management for tests and examples (@volga/anvil-manager)
│   ├── safe-genesis/    # Genesis configuration with pre-deployed Safe contracts (@volga/safe-genesis)
│   └── examples/        # Example applications
├── package.json         # Root package.json with workspace configuration
└── CLAUDE.md           # This file
```

## Architecture

The SDK is organized into functional modules in `packages/picosafe/src/` that handle various Safe operations:

- **Account deployment and management** - Deploy new Safe accounts with various configurations
- **Transaction building, signing, and execution** - Create and execute Safe transactions
- **Module and owner management** - Add, remove, and manage Safe owners and modules
- **Guard and fallback handler management** - Set guards and fallback handlers (dangerous operations)
- **Utility functions and type definitions** - Core types and helper functions
- **EIP-712 signing support** - Domain separator calculation and transaction hashing for signatures

Each module exports pure functions that accept an EIP-1193 provider as the first parameter and perform specific Safe operations.

### Utilities

The SDK includes utility modules in `packages/picosafe/src/utilities/` that provide common functionality for address handling, encoding, provider interactions, and transaction wrapping. These utilities are used internally by the main modules and can also be imported directly for specialized use cases.

### Safe Contracts Version

This SDK is built for and tested against Safe Smart Account contracts **v1.5.0**. When implementing features or resolving ambiguities about Safe behavior, always consult the official Solidity smart contract code at:

https://github.com/safe-global/safe-smart-account/tree/v1.5.0

The contracts serve as the authoritative source for:

- Function signatures and parameters
- Expected behavior and validation rules
- Error conditions and revert messages
- Event emissions and data structures
- Security requirements and constraints

### Module Organization

The SDK modules are organized by functionality:

- **Core Operations**: Deployment, transaction building/execution, and account state reading
- **Owner Management**: Functions for adding, removing, and swapping Safe owners
- **Module Management**: Enable and disable Safe modules
- **Advanced Features**: Guard and fallback handler management (marked with `UNSAFE_` prefix)
- **Batch Operations**: MultiSend support for batching multiple transactions
- **Signing**: EIP-712 domain separators and signature encoding/decoding
- **Infrastructure**: Type definitions, contract ABIs, and Safe contract addresses

## Development Guidelines

### Main Design Philosophy

The library follows a three-stage lifecycle for Safe interactions:

1. **Raw Intent**: Accept user-friendly configuration (e.g., deployment params, transaction data)
2. **Transaction Encoding**: Transform raw data into Ethereum-compatible format (e.g., encoded calldata)
3. **Blockchain Submission**: Return prepared transaction data for flexible execution

The SDK acts as a translation layer between developer intent and blockchain execution, without prescribing how transactions are sent. This design enables advanced patterns like batching multiple operations:

```typescript
// Example: Deploy 1000 Safes in a single transaction
// Note: This example uses viem for the provider, but any EIP-1193 provider works
const deployments = []
for (let i = 0; i < 1000; i++) {
  const deployment = await deploySafeAccount(walletClient, {
    owners: [walletClient.account.address],
    threshold: 1n,
    saltNonce: i,
  })
  deployments.push(deployment)
}

// Batch all deployments into one transaction
const batchTx = encodeMultiSend(deployments.map((d) => d.rawTransaction))
await executeSafeTransaction(walletClient, batchTx)
```

All SDK methods must follow this design principle, returning both raw transaction data and convenience execution methods.

### Core Principles

1. **Provider-Based**: All functions accept an EIP-1193 provider as the first parameter
2. **Pure Functions**: No internal state or side effects beyond blockchain interactions
3. **Type Safety**: Maintain strict TypeScript types for all parameters and returns
4. **Integration Testing**: Write comprehensive integration tests, not unit tests
5. **Error Handling**: Let provider errors bubble up, only wrap for clarity when needed
6. **Simplicity**: Keep implementations straightforward and avoid over-engineering
7. **Return checksummed addresses**: Any SDK function that returns Ethereum addresses **must** return them in their EIP-55 checksum form to ensure consistency and reduce typo-related bugs

### API Design Philosophy

Since this project is a library, our primary way of communicating with developers is through APIs, including elements such as function naming, abstractions, types, return values, and function parameters. We should spend time thinking about whether we've chosen the right concepts.

**North Star Metric**: By reading the function name, developers should be able to guess what would be happening in the implementation. This means:

- **Self-Descriptive Names**: Function names should clearly convey their purpose and effects
- **Intuitive Abstractions**: Choose concepts that align with developer expectations
- **Predictable Behavior**: Function behavior should match what the name suggests
- **Consistent Patterns**: Similar operations should follow similar naming conventions
- **Clear Parameter Names**: Parameters should be named to indicate their purpose and constraints

### Workflow Rules

These rules ensure systematic, reliable development with clear purpose and continuous verification:

1. **Lead with outcomes**: Restate the business/user goal before implementing - ensures alignment with actual needs
2. **Work incrementally**: Complete one coherent sub-task before moving to the next - reduces complexity and makes debugging easier
3. **Plan before acting**: Deep-read codebase and types; understand impacts before making changes - prevents unintended side effects
4. **Use TODO lists**: Track all tasks with TodoWrite tool—mark in_progress before starting - maintains focus and ensures nothing is forgotten
5. **Run checks frequently**: Execute `npm run check`, `npm run check:write` and `npm run test -w @volga/picosafe` after each change - catches issues immediately when they're easiest to fix
6. **Update tests immediately**: Add/modify tests alongside implementation changes - ensures code correctness and prevents regressions
7. **Surface edge cases**: Identify nulls, race conditions, extreme inputs upfront - builds robust code that handles real-world scenarios
8. **Ask clarifying questions**: Query ambiguities rather than making assumptions - prevents building the wrong solution
9. **Comments explain WHY**: Document reasoning, not implementation (except public APIs) - helps future maintainers understand decisions
10. **Cite authoritative sources**: Link to Safe docs, EIPs, or official references - provides context and ensures correctness

### Type Checking and Code Quality

When fixing type errors or making changes:

1. **Run TypeScript compiler**: Use `npm run typecheck -w @volga/picosafe` to check for type errors without building
2. **Check code style**: Run `npm run check` to identify linting issues
3. **Auto-fix formatting**: Use `npm run format` to automatically fix formatting issues
4. **Combined check**: Run `npm run check:write` for both linting and auto-fixing
5. **Test affected code**: Run specific tests with `npm run test -w @volga/picosafe <pattern>` (e.g., `npm run test -w @volga/picosafe utilities`)
6. **Fix incrementally**: Address type errors one at a time, testing after each fix

## Testing Approach

Tests are integration/e2e tests that run against a local Anvil blockchain:

1. **Recommended**: Use `npm run test -w @volga/picosafe` which automatically starts/stops Anvil
2. **Alternative**: Start Anvil manually, then run `npm run test:run -w @volga/picosafe`
3. Tests use real Safe contracts deployed on the local chain
4. Test files are in `packages/picosafe/tests/`
5. Test utilities are in `packages/picosafe/tests/fixtures/setup.ts`

The test suite covers all SDK functionality including deployment, transactions, signatures, modules, and error cases.

### Test Structure

- Each test file focuses on a specific module or functionality
- Tests run sequentially to avoid state conflicts
- Common test setup uses fixture utilities for creating test Safes
- Tests use real wallets with test ETH from Anvil's default accounts
- Test utilities provide helpers for random data generation and common operations

### Testing with Anvil

The PicoSafe package includes an automated Anvil setup for testing. When running tests:

- Tests automatically start and stop Anvil with pre-deployed Safe 1.5.0 contracts
- The setup is handled by `packages/picosafe/tests/setup-anvil.ts`
- Tests run in isolated Anvil instances to enable parallel execution
- Each test gets a clean blockchain state
- Pre-deployed contracts are provided by `@volga/safe-genesis` package

## Build Configuration

- **TypeScript**: Targets ES2022 with strict mode
- **Build Tool**: tsup (outputs both CJS and ESM)
- **Linting**: Biome with recommended rules
- **Testing**: Vitest with V8 coverage
- **Module Type**: ES modules ("type": "module" in package.json)

## Best Practices

### JSDoc Conventions

- **Always add missing JSDoc**: Every public function must have complete documentation
- **Include all relevant tags**: `@param`, `@returns`, `@throws`, `@example`, etc.
- **Write runnable examples**: Full, working code with imports—no ellipses or partial snippets
- **Base examples on tests**: Use actual test cases as examples when possible
- **Provider flexibility in examples**: Examples can use Viem, Ethers, or any EIP-1193 provider library for demonstration purposes
- **Maintain accuracy**: Update JSDoc when function behavior changes
- **Document edge cases**: Note any limitations, special behaviors, or requirements
- **Type descriptions**: Even with TypeScript types, describe what values mean
- **Reference Safe contracts**: For functions that call Safe smart contract methods, include a `@see` tag with a link to the specific function in the official Safe v1.5.0 contracts repository (e.g., `@see https://github.com/safe-global/safe-smart-account/blob/v1.5.0/contracts/base/OwnerManager.sol`)
- **Use @link for custom TypeScript types**: If JSDOC uses a custom typescript type, make sure it is included with a @link tag
- **Even internal functions should have JSDOC documentation, it can be a minimal one (without an example)**

### Export Conventions

- **Separate type exports**: Export types independently from implementations
- **Group exports at file end**: Place all export statements at the bottom for visibility
- **Named exports over default**: Use named exports for better refactoring and tree-shaking
- **Re-export from index**: Central `index.ts` should re-export all public APIs

### Testing Conventions

- **Real blockchain testing**: Use Anvil with actual Safe contracts—no mocks or stubs
- **Wait for Transaction Mining**: After sending a transaction, always use `await publicClient.waitForTransactionReceipt({ hash: txHash })` before asserting state changes. When a transaction is submitted, the node returns a hash immediately, but the transaction itself is not yet mined. Without waiting, test assertions can run against the old blockchain state, leading to flaky failures. Waiting for the receipt guarantees the transaction is mined and its state changes are applied, ensuring test reliability.
- **Self-contained tests**: Each test should be readable without external context
- **Explicit over DRY**: Repetition is acceptable for test clarity
- **Test real scenarios**: Focus on actual use cases rather than edge implementations
- **Descriptive test names**: Use full sentences describing expected behavior
- **Test utilities**: Test utilities provide functions for random data generation and common test operations

### Technical Debt Management

- **Document all workarounds**: Add clear comments explaining why and when to remove
- **Use TODO comments**: Format as `// TODO(category): description` for easy searching
- **Track in issues**: Create GitHub issues for significant technical debt
- **Include context**: Explain what proper solution would look like

### TypeScript Conventions

- **Strict type safety**: Enable all strict checks, no `any` types
- **Explicit return types**: Always declare function return types
- **Use `satisfies`**: For type-safe object literals with inference
- **Prefer `type`**: Use type aliases over interfaces for consistency
- **Separate type exports**: Export types independently from implementations
- **Avoid type assertions**: Use type guards instead of `as` casts
- **Generic constraints**: Use extends to constrain generic parameters

### Runtime Validation Philosophy

- **TypeScript-first**: Do not add runtime validation where TypeScript's static type checking is sufficient
- **Acceptable gaps**: If TypeScript cannot catch something but it doesn't put user funds at risk, we can leave it as is
- **Security exceptions**: Add runtime validation when:
  - User funds could be at risk
  - Actions could be potentially malicious or compromise Safe security
  - Operations involve dangerous functionality (delegatecalls, module management, etc.)
- **Examples**: Runtime checks are appropriate for validating external contract addresses, preventing dangerous module installations, or blocking malicious delegatecall targets

## Example Guidelines

Examples serve as both documentation and learning tools. They should showcase library capabilities while being clean, readable, and copy-paste friendly.

### Core Principles for Examples

1. **Focus on Library APIs**: Examples should highlight PicoSafe functions, not boilerplate setup
2. **Minimize Noise**: Remove excessive console.logs, decorative output, and verbose formatting
3. **Runnable but Readable**: Primary purpose is to be read and understood, secondary is execution
4. **Concise Output**: Only log essential information (addresses, transaction hashes, success confirmations)

### Structure Guidelines

#### Setup Abstraction

- **Use shared setup modules**: Extract repetitive client configuration to `setup.ts`
- **Comment non-library code**: Clearly indicate when code is standard Ethereum setup vs PicoSafe-specific
- **Type explicitly**: Add explicit type annotations to avoid complex type inference issues

Example setup module:

```typescript
export function setupClients(rpcUrl: string): {
  walletClient: WalletClient<Transport, Chain, Account>
  publicClient: PublicClient
} {
  // Standard Viem setup - not PicoSafe specific
  // Implementation details...
}
```

#### Helper Functions

- **Extract complex operations**: Move token deployments, verification logic, etc. to helper files
- **Keep focus on patterns**: Main example should show the library pattern, not auxiliary complexity
- **Proper TypeScript types**: Use correct Viem types like `WalletClient<Transport, Chain, Account>`

#### Console Output

- **Essential only**: Log only critical information
- **Single-line format**: Prefer concise single-line outputs over multi-line formatted blocks
- **Remove decorations**: No emojis, ASCII art, or excessive formatting unless specifically requested
- **Progress indicators**: Simple status messages like "Safe deployed at: 0x..." instead of verbose explanations

### Anti-patterns to Avoid

1. **Verbose console output blocks**:

   ```typescript
   // ❌ Avoid
   console.log("🎉 Safe account deployed successfully!")
   console.log(`   Block Number: ${receipt.blockNumber}`)
   console.log(`   Gas Used: ${receipt.gasUsed}`)

   // ✅ Prefer
   console.log("Safe deployed in block:", receipt.blockNumber)
   ```

2. **Inline complex operations**:

   ```typescript
   // ❌ Avoid - 30+ lines of token deployment in main flow

   // ✅ Prefer - Extract to helper
   const tokenAddress = await setupTestToken(walletClient, publicClient, safeAddress)
   ```

3. **Repetitive setup code**:

   ```typescript
   // ❌ Avoid - Same 15 lines of client setup in every example

   // ✅ Prefer - Shared setup
   const { walletClient, publicClient } = setupClients(rpcUrl)
   ```

## Common Patterns

### Provider Pattern

All SDK functions follow this pattern:

```typescript
async function doSomething(
  provider: EIP1193Provider,
  safeAccount: SafeAccount
  // ... other params
): Promise<ReturnType> {
  // Implementation
}
```

The only exceptions allowed are functions that do not interact with the blockchain (e.g., utility functions).

### Return Value Pattern

Functions typically return objects with:

- `rawTransaction`: Prepared transaction data for manual sending
- `send()`: Convenience method for direct execution
- Additional metadata relevant to the operation

This pattern is implemented using the `wrapEthereumTransaction` utility from `utilities/wrapEthereumTransaction.ts`, which standardizes the return format across all transaction-generating functions.

### Error Handling

- **Let errors bubble**: Don't catch provider/network errors
- **Wrap for clarity**: Only wrap when adding helpful context
- **Descriptive messages**: Include operation details in error messages
- **Input validation**: Fail fast with clear parameter errors

## Security Considerations

### Critical Safety Requirements

PicoSafe handles financial assets where mistakes can lead to irreversible loss of funds. Every change must be approached with extreme caution:

1. **Test Everything Meticulously**: All functionality must have comprehensive test coverage including edge cases, error conditions, and adversarial inputs
2. **Prevent Footguns**: Design APIs to make dangerous operations impossible or extremely explicit. Focus on operations allowed by Safe contracts but potentially dangerous:
   - **Delegatecalls**: Can execute arbitrary code with Safe's context, potentially draining funds
   - **Module Management**: Enabling malicious modules grants unrestricted Safe access
   - **Fallback Handlers**: Setting malicious handlers can compromise signature validation
   - **Guard Changes**: Malicious guards can block all transactions
3. **Explicit Danger Markers**: Use `UNSAFE_` prefix for any operation that could compromise Safe security (delegatecalls, low-level operations)
4. **Validate External Contracts**: When interacting with modules, handlers, or targets, consider adding warnings or validation where possible
5. **Fail-Safe Defaults**: When in doubt, operations should fail rather than proceed with potentially dangerous behavior

### Security Best Practices

1. **Transaction Safety**:

   - Always validate Safe transaction structure before execution

2. **State Consistency**:

   - Read current state before modifications
   - Verify expected state hasn't changed between read and write
   - Check Safe hasn't been migrated to incompatible version

3. **Error Messages**:
   - Provide clear, actionable error messages
   - Never expose sensitive information in errors
   - Include context about what validation failed
   - Guide users toward safe alternatives

### Testing Security

1. **Adversarial Testing**: Include tests that attempt malicious operations
2. **Fuzzing**: Test with random/extreme inputs to find edge cases
3. **Integration Testing**: Test full transaction flows, not just individual functions
4. **Regression Testing**: Add tests for any security issues discovered

### Code Review Checklist

Before any code changes:

- [ ] All new functions have comprehensive tests
- [ ] Edge cases are explicitly tested
- [ ] Error paths are tested
- [ ] No operations can brick a Safe
- [ ] Dangerous operations are clearly marked
- [ ] Input validation is comprehensive
- [ ] Documentation clearly states security implications

## Priority Reminders

1. **Always run `npm run check` after changes** - Catch issues early
2. **Test incrementally with `npm run test -w @volga/picosafe <pattern>`** - Verify as you go
3. **Check types with `npm run typecheck`** - Ensure type safety (runs for all packages)
4. **Update relevant tests immediately** - Keep coverage complete
5. **Use TodoWrite for multi-step tasks** - Track progress systematically
6. **Security first** - When in doubt, choose the safer option

## Developer Notes

- **Type Management**:
  - Keep the types in `types.ts`, unless it's only crucial for that particular file
- **Ox Library Usage**:
  - Use Ox directly for all Ethereum utilities (addresses, ABI encoding, hashing, etc.)
  - Avoid creating wrapper functions that simply call Ox functions 1:1
  - Import Ox utilities as needed: `import { Address, AbiFunction, Hash } from "ox"`
- **Provider Examples**:
  - Examples and tests can use any provider library (Viem, Ethers, etc.)
  - Always note that any EIP-1193 provider is compatible

## Contextual Notes

- Use context7 mcp server for up-to-date documentation

## CLAUDE.md Guidelines

This section defines what information should be included in CLAUDE.md to ensure it remains a stable, valuable reference that doesn't require constant updates.

### What to Include

- **Architectural Decisions**: Core design patterns, module organization, and fundamental SDK principles
- **Development Workflows**: Established procedures for coding, testing, and quality assurance
- **Security Requirements**: Critical safety considerations and review checklists
- **Coding Standards**: TypeScript conventions, JSDoc requirements, and export patterns
- **Testing Philosophy**: Integration testing approach and best practices
- **Command Reference**: Essential npm scripts and their purposes

### What NOT to Include

- **Implementation Details**: Specific function signatures or internal logic that changes frequently
- **Feature Lists**: Detailed feature documentation belongs in README or API docs
- **Version-Specific Information**: Dependency versions or changelog entries
- **Temporary Notes**: Work-in-progress items or short-term TODOs
- **External Links**: URLs to third-party services that may change or become outdated

### Maintenance Principles

1. **Stability Over Completeness**: Prefer enduring guidelines over exhaustive documentation
2. **Process Over Product**: Document how to work with the codebase, not what's in it
3. **Principles Over Specifics**: Focus on overarching concepts rather than implementation details
4. **Timeless Information**: Include only content that will remain relevant across versions
