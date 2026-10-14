// Robinhood Chain as viem sees it, and the three ERC-20 calls the paying path makes.
import { parseAbi } from 'viem'
import { RPC } from './chain'
import { CHAIN_ID } from './x402'

export const chain = {
	id: CHAIN_ID,
	name: 'Robinhood Chain',
	nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
	rpcUrls: { default: { http: [RPC] } },
} as const

export const erc20 = parseAbi([
	'function balanceOf(address) view returns (uint256)',
	'function allowance(address,address) view returns (uint256)',
	'function approve(address,uint256) returns (bool)',
])
