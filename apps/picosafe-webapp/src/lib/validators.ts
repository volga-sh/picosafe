import { z } from "zod";

/**
 * Validates Ethereum addresses (0x followed by 40 hex characters)
 */
export const safeAddressSchema = z
	.string()
	.regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format");

/**
 * Validates chain ID as a positive integer
 */
export const chainIdSchema = z
	.number()
	.int()
	.positive("Chain ID must be a positive integer");

/**
 * Combined schema for Safe identification
 * Used for route search parameters and Safe lookups
 */
export const safeIdSchema = z.object({
	safe: safeAddressSchema,
	chainId: chainIdSchema,
});

export type SafeId = z.infer<typeof safeIdSchema>;
