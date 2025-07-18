import type { Address, Hex } from "viem";
import { encodeFunctionData, hashMessage, recoverAddress } from "viem";
import {
	PARSED_ERC_1271_ABI_CURRENT,
	PARSED_ERC_1271_ABI_LEGACY,
	PARSED_SAFE_ABI,
} from "./abis";
import { getSignatureTypeVByte } from "./safe-signatures";
import type {
	DynamicSignature,
	EIP1193ProviderWithRequestFn,
	PicosafeSignature,
	StaticSignature,
} from "./types";
import { SignatureTypeVByte } from "./types";

type SignatureValidationResult<T> = Readonly<{
	valid: boolean;
	error?: Error;
	validatedSigner?: Address;
	signature: T;
}>;

/**
 * Validates an ECDSA signature by recovering the signer address
 *
 * Performs signature recovery using the provided signature data and data hash,
 * then compares the recovered address against the expected signer. This is used
 * for standard Ethereum ECDSA signatures (both EIP-712 and eth_sign types).
 *
 * The function does not verify that the signer is a Safe owner - it only validates
 * the cryptographic signature itself. For full Safe signature validation including
 * owner checks, use `validateSignaturesForSafe` from safe-signatures.ts.
 *
 * @param signature - The signature object containing signer address and signature data
 * @param signature.signer - The expected signer address to validate against
 * @param signature.data - The 65-byte ECDSA signature (r + s + v)
 * @param dataHash - The hash of the data that was signed
 * @returns Promise resolving to validation result with recovered signer
 * @returns result.valid - True if recovered signer matches expected signer
 * @returns result.validatedSigner - The address recovered from the signature
 * @returns result.signature - The original signature object
 * @returns result.error - Error if the signature is invalid
 * @throws {Error} If the signature is invalid (invalid r or s values)
 * @example
 * ```typescript
 * import { isValidECDSASignature, calculateSafeTransactionHash } from "picosafe";
 * import { encodeFunctionData } from "viem";
 *
 * // Validate an EIP-712 signature for a Safe transaction
 * const txHash = await calculateSafeTransactionHash(provider, safeAddress, safeTx);
 * const signature = {
 *   signer: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fA8e",
 *   data: "0x" + "a".repeat(64) + "1b" // r (32) + s (32) + v=27
 * };
 *
 * const result = await isValidECDSASignature(signature, txHash);
 * console.log('Valid:', result.valid);
 * console.log('Recovered signer:', result.validatedSigner);
 * ```
 */
async function isValidECDSASignature(
	signature: Readonly<StaticSignature>,
	dataHash: Hex,
): Promise<SignatureValidationResult<StaticSignature>> {
	let capturedError: Error | undefined;
	let recoveredSigner: Address | undefined;
	try {
		recoveredSigner = await recoverAddress({
			hash: dataHash,
			signature: signature.data,
		});
	} catch (err) {
		if (err instanceof Error) capturedError = err;
		else
			capturedError = new Error(
				`Unknown error while calling recoverAddress: ${err}`,
			);
	}

	return {
		valid: capturedError === undefined && recoveredSigner === signature.signer,
		validatedSigner: recoveredSigner,
		signature,
		error: capturedError,
	};
}

// ERC-1271 magic values
const MAGIC_VALUE_BYTES32 = "0x1626ba7e" as const; // bytes4(keccak256("isValidSignature(bytes32,bytes)"))
const MAGIC_VALUE_BYTES = "0x20c13b0b" as const; // bytes4(keccak256("isValidSignature(bytes,bytes)"))

/**
 * Validates a signature using EIP-1271 standard for contract signatures
 *
 * Calls the signer contract's `isValidSignature` function to validate the signature.
 * EIP-1271 allows contracts to act as signers by implementing signature validation logic.
 * This enables smart contract wallets, multisigs, and other contracts to sign Safe transactions.
 *
 * The function supports both variants of EIP-1271:
 * - `isValidSignature(bytes32,bytes)` - For validating a hash
 * - `isValidSignature(bytes,bytes)` - For validating raw data (used by Safe for transactions before V1.5.0)
 *
 * The signer contract must return the appropriate magic value to indicate a valid signature:
 * - `0x1626ba7e` for the bytes32 variant
 * - `0x20c13b0b` for the bytes variant
 *
 * @param provider - EIP-1193 provider to interact with the blockchain
 * @param signature - The dynamic signature object
 * @param signature.signer - The contract address that should validate the signature
 * @param signature.data - The signature data to be validated by the contract
 * @param signature.dynamic - Must be true to indicate this is a contract signature
 * @param validationData - Either the data hash or raw data to validate
 * @param validationData.dataHash - The hash of the data (for bytes32 variant)
 * @param validationData.data - The raw data (for bytes variant)
 * @returns Promise resolving to validation result
 * @returns result.valid - True if the contract returns the expected magic value
 * @returns result.validatedSigner - The signer address (same as input)
 * @returns result.signature - The original signature object
 * @returns result.error - Error if the contract call failed or returned wrong value
 * @example
 * ```typescript
 * import { isValidERC1271Signature } from "picosafe";
 *
 * // Validate a contract signature for a transaction hash
 * const contractSignature = {
 *   signer: "0x1234567890123456789012345678901234567890", // Smart wallet address
 *   data: "0x" + "a".repeat(130), // Contract-specific signature data
 *   dynamic: true
 * };
 *
 * const result = await isValidERC1271Signature(
 *   provider,
 *   contractSignature,
 *   { dataHash: transactionHash }
 * );
 *
 * if (result.valid) {
 *   console.log('Contract signature is valid');
 * } else {
 *   console.error('Invalid signature:', result.error);
 * }
 * ```
 * @example
 * ```typescript
 * import { isValidERC1271Signature, hashMessage } from "picosafe";
 *
 * // Validate a contract signature for a message
 * const message = "0x48656c6c6f20576f726c64"; // "Hello World" in hex
 * const messageHash = hashMessage(message);
 *
 * const result = await isValidERC1271Signature(
 *   provider,
 *   contractSignature,
 *   { data: message } // Pass raw data for message validation
 * );
 * ```
 * @see https://eips.ethereum.org/EIPS/eip-1271
 */
async function isValidERC1271Signature(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	signature: Readonly<DynamicSignature>,
	validationData: Readonly<{ data: Hex } | { dataHash: Hex }>,
): Promise<SignatureValidationResult<DynamicSignature>> {
	let calldata: Hex;
	let expectedMagic: Hex;

	if ("dataHash" in validationData) {
		calldata = encodeFunctionData({
			abi: PARSED_ERC_1271_ABI_CURRENT,
			functionName: "isValidSignature",
			args: [validationData.dataHash, signature.data],
		});
		expectedMagic = MAGIC_VALUE_BYTES32;
	} else {
		calldata = encodeFunctionData({
			abi: PARSED_ERC_1271_ABI_LEGACY,
			functionName: "isValidSignature",
			args: [validationData.data, signature.data],
		});
		expectedMagic = MAGIC_VALUE_BYTES;
	}

	let capturedError: Error | undefined;

	try {
		// fixed size byte sequences are right padded to 32 bytes
		// example returned magic value: 0x20c13b0b00000000000000000000000000000000000000000000000000000000
		const result = await provider
			.request({
				method: "eth_call",
				params: [{ to: signature.signer, data: calldata }, "latest"],
			})
			.then((res) => res.slice(0, 10));
		console.log(result, expectedMagic);
		if (result === expectedMagic) {
			return {
				valid: true,
				validatedSigner: signature.signer,
				signature,
			};
		}
	} catch (err) {
		if (err instanceof Error) capturedError = err;
		else
			capturedError = new Error(
				`Unknown error while calling isValidSignature: ${err}`,
			);
	}

	return {
		valid: false,
		validatedSigner: signature.signer,
		signature,
		error: capturedError,
	};
}

/**
 * Validates a pre-approved hash signature by checking the Safe's approvedHashes mapping
 *
 * Safe contracts allow owners to pre-approve transaction hashes without providing a signature.
 * This is done by calling the Safe's `approveHash` function, which stores the approval on-chain.
 * During execution, a signature with v=1 indicates to check this mapping instead of validating
 * a cryptographic signature.
 *
 * Pre-approved signatures are useful for:
 * - Transactions initiated by the transaction sender (who is also an owner)
 * - Asynchronous approval flows where owners approve at different times
 * - Gas-efficient approvals that don't require signature verification
 *
 * The signature data for pre-approved hashes is formatted as:
 * - First 32 bytes: The owner address (padded to 32 bytes)
 * - Next 32 bytes: Unused (typically zeros)
 * - Last byte: 0x01 (signature type indicator)
 *
 * @param provider - EIP-1193 provider to interact with the blockchain
 * @param signature - The signature object with v=1 indicating pre-approval
 * @param signature.signer - The Safe contract address to check approvals on
 * @param signature.data - 65-byte signature with owner address and v=1
 * @param validationData - The validation data containing the hash to check
 * @param validationData.dataHash - The transaction or message hash to verify approval for
 * @returns Promise resolving to validation result
 * @returns result.valid - True if the hash is approved (non-zero value in mapping)
 * @returns result.validatedSigner - The signer address (Safe contract)
 * @returns result.signature - The original signature object
 * @returns result.error - Error if the contract call failed
 * @example
 * ```typescript
 * import { isValidApprovedHashSignature } from "picosafe";
 *
 * // Check if a transaction hash is pre-approved
 * const approvedSignature = {
 *   signer: safeAddress, // The Safe contract address
 *   data: "0x" +
 *     "000000000000000000000000" + ownerAddress.slice(2) + // Owner padded to 32 bytes
 *     "0000000000000000000000000000000000000000000000000000000000000000" + // Unused
 *     "01" // v=1 for approved hash
 * };
 *
 * const result = await isValidApprovedHashSignature(
 *   provider,
 *   approvedSignature,
 *   { dataHash: transactionHash }
 * );
 *
 * if (result.valid) {
 *   console.log('Transaction is pre-approved by owner');
 * }
 * ```
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L233
 */
async function isValidApprovedHashSignature(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	signature: Readonly<StaticSignature>,
	validationData: Readonly<{ dataHash: Hex }>,
): Promise<SignatureValidationResult<StaticSignature>> {
	const { dataHash } = validationData;

	const approvedHashesCalldata = encodeFunctionData({
		abi: PARSED_SAFE_ABI,
		functionName: "approvedHashes",
		args: [signature.signer, dataHash],
	});

	let approvedHash: Hex | undefined;
	let capturedError: Error | undefined;

	try {
		approvedHash = await provider.request({
			method: "eth_call",
			params: [
				{
					to: signature.signer,
					data: approvedHashesCalldata,
				},
			],
		});
	} catch (err) {
		if (err instanceof Error) {
			capturedError = err;
		} else {
			capturedError = new Error(
				`Unknown error while calling approvedHashes: ${err}`,
			);
		}
	}

	return {
		valid:
			approvedHash !== undefined &&
			approvedHash !==
				"0x0000000000000000000000000000000000000000000000000000000000000000",
		validatedSigner: signature.signer,
		signature,
		error: capturedError,
	};
}

/**
 * Validates a Safe signature based on its type (ECDSA, EIP-1271, or pre-approved)
 *
 * This is the main signature validation function that determines the signature type
 * from the v-byte and routes to the appropriate validation method. It handles all
 * Safe-supported signature types:
 *
 * - **ECDSA signatures** (v=27,28,31,32): Standard Ethereum signatures validated via ecrecover
 *   - EIP-712 (v=27,28): Direct signature of the Safe transaction hash
 *   - eth_sign (v=31,32): Signature of "\x19Ethereum Signed Message:\n32" + hash
 * - **Contract signatures** (v=0): EIP-1271 signatures validated by calling the signer contract
 * - **Pre-approved hashes** (v=1): On-chain approvals checked via Safe's approvedHashes
 *
 * This function only validates the signature itself - it does not check if the signer
 * is a Safe owner. For complete validation including owner checks, use
 * `validateSignaturesForSafe` from safe-signatures.ts.
 *
 * @param provider - EIP-1193 provider to interact with the blockchain
 * @param signature - The signature to validate (static or dynamic)
 * @param validationData - Data needed for validation
 * @param validationData.data - The original data that was signed
 * @param validationData.dataHash - The hash of the data
 * @returns Promise resolving to validation result
 * @returns result.valid - True if the signature is cryptographically valid
 * @returns result.validatedSigner - The recovered or validated signer address
 * @returns result.signature - The original signature object
 * @returns result.error - Error details if validation failed (optional)
 * @throws {Error} If the signature has an invalid type byte
 * @example
 * ```typescript
 * import { validateSignature, calculateSafeTransactionHash } from "picosafe";
 *
 * // Validate an EIP-712 signature
 * const txHash = await calculateSafeTransactionHash(provider, safeAddress, safeTx);
 * const signature = {
 *   signer: expectedSigner,
 *   data: signatureData // 65 bytes with v=27 or 28
 * };
 *
 * const result = await validateSignature(provider, signature, {
 *   data: encodedTxData,
 *   dataHash: txHash
 * });
 *
 * if (result.valid && result.validatedSigner === expectedSigner) {
 *   console.log('Signature is valid');
 * }
 * ```
 * @example
 * ```typescript
 * import { validateSignature } from "picosafe";
 *
 * // Validate a contract signature (EIP-1271)
 * const contractSig = {
 *   signer: smartWalletAddress,
 *   data: contractSignatureData,
 *   dynamic: true
 * };
 *
 * const result = await validateSignature(provider, contractSig, {
 *   data: originalData,
 *   dataHash: dataHash
 * });
 * ```
 * @see {@link SignatureTypeVByte} for all supported signature types
 * @see https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol#L284
 */
async function validateSignature(
	provider: Readonly<EIP1193ProviderWithRequestFn>,
	signature: Readonly<PicosafeSignature>,
	validationData: Readonly<{ data: Hex; dataHash: Hex }>,
): Promise<SignatureValidationResult<PicosafeSignature>> {
	if ("dynamic" in signature && signature.dynamic) {
		return await isValidERC1271Signature(provider, signature, validationData);
	}

	const vByte = getSignatureTypeVByte(signature.data);
	switch (vByte) {
		case SignatureTypeVByte.EIP712_RECID_1:
		case SignatureTypeVByte.EIP712_RECID_2: {
			const recoveredSigner = await recoverAddress({
				hash: validationData.dataHash,
				signature: signature.data,
			});

			return {
				valid: recoveredSigner === signature.signer,
				validatedSigner: recoveredSigner,
				signature,
			};
		}
		case SignatureTypeVByte.ETH_SIGN_RECID_1:
		case SignatureTypeVByte.ETH_SIGN_RECID_2: {
			const recoveredSigner = await recoverAddress({
				hash: hashMessage(validationData.dataHash),
				signature: signature.data,
			});

			return {
				valid: recoveredSigner === signature.signer,
				validatedSigner: recoveredSigner,
				signature,
			};
		}
		case SignatureTypeVByte.APPROVED_HASH:
			return await isValidApprovedHashSignature(
				provider,
				signature,
				validationData,
			);
		default:
			throw new Error("Invalid signature type");
	}
}

export type { SignatureValidationResult };
export {
	isValidECDSASignature,
	isValidERC1271Signature,
	isValidApprovedHashSignature,
	validateSignature,
};
