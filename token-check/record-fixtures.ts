// Records the RPC exchanges of one run per payload into fixtures/<name>.json.
// It runs the workflow's own readChain(), so the fixtures hold exactly the
// requests the workflow sends and the raw answers of the public RPC.
//
//   bun record-fixtures.ts [name ...]      (names of payloads/*.json, default: all)
//
// One request at a time, half a second apart. A 429, a 5xx or a rate-limited
// item is waited out and asked again, so a fixture holds clean answers only.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fromUtf8, utf8 } from '../rwa-verify/verify'
import config from './config.json'
import { readChain } from './workflow'

const PAUSE_MS = 500
const dir = new URL('.', import.meta.url).pathname
const names = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(`${dir}payloads`).map((f) => f.replace(/\.json$/, '')).sort()

type Exchange = { request: unknown; status: number; response: unknown }

function post(url: string, body: string): { status: number; text: string } {
	for (let attempt = 0; ; attempt++) {
		Bun.sleepSync(PAUSE_MS + attempt * 2000)
		const p = Bun.spawnSync(['curl', '-sL', '-m', '30', '-w', '\n%{http_code}', '-H', 'content-type: application/json', '--data-binary', '@-', url], {
			stdin: utf8(body),
		})
		const out = p.stdout.toString('utf8')
		const cut = out.lastIndexOf('\n')
		const status = Number(out.slice(cut + 1))
		const text = out.slice(0, cut)
		const limited = status === 429 || status >= 500 || status === 0 || /too many requests|rate limit/i.test(text)
		if (!limited || attempt >= 4) return { status, text }
		console.error(`  rate limited (HTTP ${status}), waiting`)
	}
}

for (const name of names) {
	const payload = JSON.parse(readFileSync(`${dir}payloads/${name}.json`, 'utf8')) as { tx: string; wallet: string; block?: number }
	const exchanges: Exchange[] = []
	const requester = {
		sendRequest: (req: { url: string; body: string }) => ({
			result: () => {
				const body = fromUtf8(Uint8Array.from(Buffer.from(req.body, 'base64')))
				const { status, text } = post(req.url, body)
				let response: unknown = text
				try {
					response = JSON.parse(text)
				} catch {}
				exchanges.push({ request: JSON.parse(body), status, response })
				return { statusCode: status, headers: {}, body: utf8(text) }
			},
		}),
	}
	const read = JSON.parse(readChain(requester as never, config.robinhoodRpc, payload.tx.toLowerCase(), payload.wallet.toLowerCase(), payload.block ?? 0))
	const fixture = {
		about: 'Raw JSON-RPC exchanges of one token-check run, recorded by record-fixtures.ts. State reads are `latest` at recorded_at.',
		rpc: config.robinhoodRpc,
		recorded_at: new Date().toISOString(),
		payload,
		exchanges,
	}
	writeFileSync(`${dir}fixtures/${name}.json`, `${JSON.stringify(fixture, null, 1)}\n`)
	console.log(`${name}: ${exchanges.length} requests, block ${read.block}, ${read.tokens.length} tokens`)
}
