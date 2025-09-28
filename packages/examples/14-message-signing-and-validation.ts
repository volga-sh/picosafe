import {
	calculateSafeMessageHash,
	encodeSafeSignaturesBytes,
	isValidERC1271Signature,
	validateSignaturesForSafe,
} from "@volga/picosafe";
import { keccak256, toHex } from "viem";
import { withExampleScene } from "./example-scene.js";

/**
 * Example: Message Signing and EIP-1271 Validation with Safe
 *
 * This example demonstrates the complete flow of:
 * 1. Signing arbitrary messages with a Safe using EIP-712
 * 2. Validating signatures via EIP-1271 standard
 *
 * Use cases:
 * - Sign in to dApps without transactions
 * - Prove ownership of a Safe to services
 * - Create off-chain authorizations
 * - Validate signatures from contract wallets
 */

await withExampleScene(
	async (scene) => {
		const { publicClient, safes, accounts } = scene;

		const message = "Hello from Safe!";

		// For the bytes32 version of isValidSignature (current EIP-1271 spec),
		// we need to hash the message first if it's longer than 32 bytes
		const messageHash = keccak256(toHex(message));

		// Calculate the Safe's EIP-712 hash for this message hash
		// The Safe treats the 32-byte hash as the "message" to sign
		const chainId = await publicClient.getChainId();
		const safeMessageHash = calculateSafeMessageHash(
			safes.multiOwner,
			BigInt(chainId),
			{ message: messageHash },
		);

		console.log(`Original message: "${message}"`);
		console.log(`Message hash: ${messageHash}`);
		console.log(`Safe message hash (EIP-712): ${safeMessageHash}`);

		// Step 1: Sign the message with Safe owners
		// We use the account's sign method to sign the hash directly without prefix
		const signature1 = await accounts.owner1.sign({ hash: safeMessageHash });
		const signature2 = await accounts.owner2.sign({ hash: safeMessageHash });

		// Combine signatures in Safe format
		const encodedSignatures = encodeSafeSignaturesBytes([
			{
				signer: accounts.owner1.address,
				data: signature1,
			},
			{
				signer: accounts.owner2.address,
				data: signature2,
			},
		]);

		console.log("\n✓ Message signed by 2 owners");

		// Step 2: Validate signatures via EIP-1271
		// This validates that the Safe contract accepts the signature
		const eip1271Result = await isValidERC1271Signature(
			publicClient,
			{
				signer: safes.multiOwner,
				data: encodedSignatures,
				dynamic: true,
			},
			{ dataHash: messageHash },
		);

		console.log(
			`\n✓ EIP-1271 validation: ${eip1271Result.valid ? "VALID" : "INVALID"}`,
		);

		// Step 3: Full Safe signature validation
		// This additionally verifies that signers are owners and meet threshold
		const safeValidation = await validateSignaturesForSafe(
			publicClient,
			safes.multiOwner,
			{
				signatures: [
					{
						signer: accounts.owner1.address,
						data: signature1,
					},
					{
						signer: accounts.owner2.address,
						data: signature2,
					},
				],
				dataHash: safeMessageHash,
			},
		);

		console.log(
			`✓ Safe signature validation: ${
				safeValidation.valid ? "VALID" : "INVALID"
			}`,
		);
		console.log(
			`  Valid signatures: ${
				safeValidation.results.filter((r) => r.valid).length
			}/${safeValidation.results.length}`,
		);
		console.log(`  Threshold met: ${safeValidation.valid}`);

		console.log("\nTo verify via EIP-1271, dApps call:");
		console.log(
			"isValidSignature(messageHash, signatures) on the Safe contract",
		);
		console.log(
			"\nThis enables off-chain signature validation without transactions.",
		);
	},
	{
		setFallbackHandlerOnSafe: "multiOwner",
	},
);
