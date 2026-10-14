// Builds registry-snapshot.json from vet402's registry.json (the frozen copy of
// Robinhood's own asset list). Run it when vet402 refreshes its registry:
//
//   bun make-snapshot.ts <path to vet402/packages/rwa/registry.json>
//
// Only the fields the check needs are kept. The keccak256 of the source file is
// written into the snapshot so the copy can be traced back to the exact file.
import { readFileSync, writeFileSync } from 'node:fs'
import { keccak256 } from 'viem'

type SourceToken = { symbol: string; name: string; token: string; feed: string | null; factory_log: { block: number } | null }
type Source = { taken_at: string; chain_id: number; sources: { tokens: string; tokens_page: string }; tokens: SourceToken[] }

const path = process.argv[2]
if (!path) throw new Error('usage: bun make-snapshot.ts <registry.json>')
const bytes = readFileSync(path)
const src = JSON.parse(bytes.toString('utf8')) as Source

const snapshot = {
	about:
		'Robinhood Stock Tokens on Robinhood Chain (4663), reduced from the registry.json of vet402 (github.com/kzmttkc/vet402, packages/rwa). The list is a point-in-time copy. A token listed after list_taken_at is not in it.',
	list_taken_at: src.taken_at,
	extracted_at: new Date().toISOString(),
	chain_id: src.chain_id,
	source: src.sources.tokens_page,
	source_api: src.sources.tokens,
	source_file: 'packages/rwa/registry.json',
	source_file_keccak256: keccak256(new Uint8Array(bytes)),
	count: src.tokens.length,
	usdg: {
		token: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
		symbol: 'USDG',
		name: 'Global Dollar',
	},
	// deployed_block: the block of the factory's TokenDeployed log that names the token.
	tokens: src.tokens.map((t) => ({
		token: t.token.toLowerCase(),
		symbol: t.symbol,
		name: t.name,
		feed: t.feed ? t.feed.toLowerCase() : null,
		deployed_block: t.factory_log ? t.factory_log.block : null,
	})),
}
writeFileSync(new URL('./registry-snapshot.json', import.meta.url), `${JSON.stringify(snapshot, null, 1)}\n`)
console.log(`${snapshot.count} tokens, source keccak256 ${snapshot.source_file_keccak256}`)
