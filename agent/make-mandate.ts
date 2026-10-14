// Write the mandate the principal signs, and a signed sample for the tests.
//
//   bun agent/make-mandate.ts            writes mandate/mandate.json and mandate/mandate.message.txt
//   bun agent/make-mandate.ts --sample   also writes mandate/sample/ (principal: a testnet-only key, signed here)
//
// The mandate names agent/rules.ts, agent/rules-v2.ts and limits.json by hash. Run this
// again after any of them changes, and the principal signs again: the old signature
// stops matching, which is the point.
//
// The real mandate is never signed by this script. The principal (PRINCIPAL below, not the
// vet402 wallet that is paid) signs the one line in mandate/mandate.message.txt with their own
// key, as an EIP-191 personal message, and puts the signature in mandate/mandate.sig:
//   cast wallet sign --private-key "$(cat <principal key file>)" "$(cat mandate/mandate.message.txt)" > mandate/mandate.sig The sample is signed with the testnet-only key in
// $BLI_TESTNET_KEY_FILE (default ~/.vet402/bli-testnet.key), which is read and never printed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getAddress, type Hex, keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { limitsKeccak, parseLimits } from './limits'
import { type Mandate, mandateKeccak, mandateMessage, mandateSigner } from './mandate'
import { MAY_NOT_ACT } from './mandate-text'
import { PAY_TO } from './rules'
import { RULES_V2 } from './rules-v2'

const REPO = join(import.meta.dir, '..')
const read = (p: string) => readFileSync(join(REPO, p))
const VALID_FROM = process.env.MANDATE_VALID_FROM ?? '2026-10-14T00:00:00Z'
const VALID_UNTIL = process.env.MANDATE_VALID_UNTIL ?? '2026-12-31T23:59:59Z'
const paymentKey = getAddress(readFileSync(process.env.BLI_AGENT_ADDRESS_FILE ?? join(homedir(), '.vet402/bli-agent.address'), 'utf8').trim())

function mandate(principal: string, title: string): Mandate {
	return {
		mandate_version: 1,
		title,
		principal: getAddress(principal),
		agent: { name: 'vet402 copy-guard', payment_key: paymentKey },
		scope: {
			practice_only: true,
			may: [
				'read public chain data and vet402 /rwa records',
				'pay for evidence over x402 in USDG on Robinhood Chain, within the limits named below',
				'record practice trades and write the hash of each reasoning trail onchain',
			],
			may_not: [
				'place a real trade',
				`pay any address other than ${getAddress(PAY_TO)}`,
				'move any asset other than the USDG it pays for evidence',
				// The same sentence the rules implement (agent/rules-v2.ts), fixed by a test in agent/v2.test.ts.
				MAY_NOT_ACT,
			],
		},
		rules: { id: RULES_V2.id, version: RULES_V2.version, source_keccak: keccak256(read('agent/rules.ts')), limits_rules_keccak: keccak256(read('agent/rules-v2.ts')) },
		limits_keccak: limitsKeccak(parseLimits(JSON.parse(read('limits.json').toString('utf8')))),
		chain_id: 4663,
		valid_from: VALID_FROM,
		valid_until: VALID_UNTIL,
	}
}

function write(dir: string, m: Mandate) {
	mkdirSync(join(REPO, dir), { recursive: true })
	writeFileSync(join(REPO, dir, 'mandate.json'), `${JSON.stringify(m, null, 2)}\n`)
	// No newline at the end: the text in this file is exactly the text that is signed.
	writeFileSync(join(REPO, dir, 'mandate.message.txt'), mandateMessage(m))
	console.log(`${dir}/mandate.json  keccak256 ${mandateKeccak(m)}  principal ${m.principal}`)
}

/**
 * The principal: the person the agent acts for. A key of its own, kept apart from the vet402 wallet
 * that receives the evidence payments (PAY_TO), so that the one who authorizes and the one who is
 * paid are not the same address. The principal signs mandate/mandate.message.txt with that key.
 */
export const PRINCIPAL = '0x2FFbAeAD3Acb0f99c851A5CE683B5E578C7eAE9e'

write('mandate', mandate(PRINCIPAL, 'vet402 copy-guard practice mandate'))

if (process.argv.includes('--sample')) {
	const keyFile = process.env.BLI_TESTNET_KEY_FILE ?? join(homedir(), '.vet402/bli-testnet.key')
	const account = privateKeyToAccount(readFileSync(keyFile, 'utf8').trim() as Hex)
	const m = mandate(account.address, 'SAMPLE. vet402 copy-guard practice mandate signed with a testnet-only key. Not the real principal.')
	write('mandate/sample', m)
	const signature = await account.signMessage({ message: mandateMessage(m) })
	writeFileSync(join(REPO, 'mandate/sample/mandate.sig'), `${signature}\n`)
	const back = mandateSigner(m, signature)
	if (back !== account.address.toLowerCase()) throw new Error('the sample signature does not recover to the sample principal')
	console.log(`mandate/sample/mandate.sig  recovers to ${back}`)
}
