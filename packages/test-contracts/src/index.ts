import { parseAbi } from "viem";
import TestERC20Json from "../artifacts/contracts/TestERC20.sol/TestERC20.json";
import TestGuardJson from "../artifacts/contracts/TestGuard.sol/TestGuard.json";

/**
 * TestERC20 ABI
 *
 * Standard ERC20 ABI with additional mint function for testing.
 * Defined as const array for proper viem type inference.
 *
 * Why not import ABI from JSON artifacts?
 * The main reason is TypeScript's type inference limitations with JSON imports.
 * When importing ABIs from JSON, TypeScript cannot infer literal types or provide
 * full type safety, autocomplete, and parameter checking for viem. Inline ABI
 * definitions with `as const` enable viem to leverage TypeScript's type system for:
 * - Function name autocomplete
 * - Parameter type checking
 * - Return type inference
 *
 * Note: The contract bytecode is still imported from the JSON artifact,
 * as type inference is not required for bytecode.
 */
const TEST_ERC20_ABI = [
	// Constructor
	"constructor()",

	// Standard ERC20 functions
	"function name() view returns (string)",
	"function symbol() view returns (string)",
	"function decimals() view returns (uint8)",
	"function totalSupply() view returns (uint256)",
	"function balanceOf(address owner) view returns (uint256)",
	"function allowance(address owner, address spender) view returns (uint256)",
	"function approve(address spender, uint256 amount) returns (bool)",
	"function transfer(address to, uint256 amount) returns (bool)",
	"function transferFrom(address from, address to, uint256 amount) returns (bool)",

	// Additional test function
	"function mint(address to, uint256 amount)",

	// EIP-2612 Permit
	"function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
	"function nonces(address owner) view returns (uint256)",
	"function DOMAIN_SEPARATOR() view returns (bytes32)",

	// Events
	"event Transfer(address indexed from, address indexed to, uint256 amount)",
	"event Approval(address indexed owner, address indexed spender, uint256 amount)",
] as const;

// Export the parsed ABI for use with viem
export const TestERC20Abi = parseAbi(TEST_ERC20_ABI);

export const TestERC20Bytecode = TestERC20Json.bytecode as `0x${string}`;

/**
 * TestGuard ABI
 *
 * Simple test guard contract that implements the ITransactionGuard interface.
 * Allows all transactions and tracks execution count for testing purposes.
 * This guard is for demonstration only and should not be used in production.
 */
const TEST_GUARD_ABI = ["constructor()"] as const;

// Export the parsed ABI for use with viem
export const TestGuardAbi = parseAbi(TEST_GUARD_ABI);

export const TestGuardBytecode = TestGuardJson.bytecode as `0x${string}`;
