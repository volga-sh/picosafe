/**
 * Captures errors from async operations and returns them in a tuple format
 *
 * This utility function provides a consistent error handling pattern for async
 * operations by returning results in a [result, error] tuple format. This allows
 * for graceful error handling without throwing exceptions, making it easier to
 * handle failures in validation functions and other operations where errors are
 * expected and should be handled gracefully.
 *
 * The function ensures that all errors are properly wrapped as Error instances,
 * converting non-Error thrown values into proper Error objects with descriptive
 * messages.
 * @internal
 *
 * @param operation - The async operation to execute
 * @param errorMessage - A descriptive message to prepend to non-Error thrown values
 * @returns A tuple of [result, error] where either result or error will be undefined
 * @example
 * ```typescript
 * const [result, error] = await captureError(
 *   () => provider.request({ method: "eth_call", params: [...] }),
 *   "Failed to call contract"
 * );
 *
 * if (error) {
 *   console.error("Operation failed:", error.message);
 *   return { valid: false, error };
 * }
 *
 * // Use result safely knowing it's defined
 * console.log("Success:", result);
 * ```
 */
async function captureError<T>(
	operation: () => Promise<T>,
	errorMessage: string,
): Promise<[T | undefined, Error | undefined]> {
	try {
		const result = await operation();
		return [result, undefined];
	} catch (err) {
		const error =
			err instanceof Error ? err : new Error(`${errorMessage}: ${err}`);
		return [undefined, error];
	}
}

export { captureError };
