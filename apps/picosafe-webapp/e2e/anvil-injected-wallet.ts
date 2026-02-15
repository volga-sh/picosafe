import type { Page } from "@playwright/test";

type RpcRequestParameters = {
	method: string;
	params?: Array<unknown>;
};

/**
 * Install a minimal EIP-1193 style injected wallet provider that forwards
 * RPC calls directly to Anvil.
 */
export async function installAnvilInjectedProvider(
	page: Page,
	rpcUrl: string,
): Promise<void> {
	await page.addInitScript(
		({ rpcUrl: configuredRpcUrl }) => {
			const callRpc = async (
				method: string,
				params: Array<unknown> = [],
			): Promise<unknown> => {
				const response = await fetch(configuredRpcUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method,
						params,
					}),
				});

				const payload = await response.json();
				if (payload?.error) {
					throw new Error(payload.error.message ?? "RPC error");
				}

				return payload.result;
			};

			const listenerMap = new Map<string, Set<(...args: unknown[]) => void>>();

			// @ts-expect-error - Injected provider shape used only for tests
			window.ethereum = {
				isMetaMask: true,
				isStatus: true,
				async request({
					method,
					params = [],
				}: RpcRequestParameters): Promise<unknown> {
					switch (method) {
						case "eth_requestAccounts":
							return callRpc("eth_accounts", params);
						case "eth_accounts":
							return callRpc("eth_accounts", params);
						case "eth_chainId":
							return callRpc("eth_chainId", params);
						case "net_version":
							return callRpc("eth_chainId", params).then((chainId) =>
								BigInt(String(chainId)).toString(10),
							);
						case "wallet_requestPermissions":
							return [
								{
									parentCapability: "eth_accounts",
									caveats: [],
								},
							];
						case "wallet_getPermissions":
							return [];
						case "wallet_switchEthereumChain":
						case "wallet_addEthereumChain":
							return null;
						default:
							return callRpc(method, params);
					}
				},
				on(eventName: string, callback: (...args: unknown[]) => void) {
					const listeners = listenerMap.get(eventName) ?? new Set();
					listeners.add(callback);
					listenerMap.set(eventName, listeners);
					return this as unknown;
				},
				removeListener(
					eventName: string,
					callback: (...args: unknown[]) => void,
				) {
					const listeners = listenerMap.get(eventName);
					if (!listeners) return this as unknown;

					listeners.delete(callback);
					return this as unknown;
				},
				removeAllListeners(eventName?: string) {
					if (eventName) {
						listenerMap.delete(eventName);
					} else {
						listenerMap.clear();
					}
					return this as unknown;
				},
			};
		},
		{
			rpcUrl,
		},
	);
}
