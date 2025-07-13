import { parseAbi } from "viem";

const SAFE_PROXY_FACTORY_ABI = [
	"function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
] as const;

const SAFE_ABI = [
	"function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
	"function getNonce() view returns (uint256)",
	"function getThreshold() view returns (uint256)",
	"function getOwners() view returns (address[])",
	"function isOwner(address owner) view returns (bool)",
	"function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 nonce) view returns (bytes32)",
	"function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
	"function domainSeparator() view returns (bytes32)",
	"function getMessageHash(bytes message) view returns (bytes32)",
	"function isValidSignature(bytes32 _dataHash, bytes _signature) view returns (bytes4)",
	"function approvedHashes(address, bytes32) view returns (uint256)",
	"event SafeSetup(address indexed initiator, address[] owners, uint256 threshold, address initializer, address fallbackHandler)",
] as const;

const PARSED_SAFE_PROXY_FACTORY_ABI = parseAbi(SAFE_PROXY_FACTORY_ABI);
const PARSED_SAFE_ABI = parseAbi(SAFE_ABI);

export {
	SAFE_PROXY_FACTORY_ABI,
	SAFE_ABI,
	PARSED_SAFE_PROXY_FACTORY_ABI,
	PARSED_SAFE_ABI,
};
