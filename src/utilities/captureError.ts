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
