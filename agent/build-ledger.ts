// Rebuild docs/ledger.json from the saved walk, without walking again.
//
//   bun agent/build-ledger.ts
//
// The trails and the feed values in docs/walk/ are the evidence. The ledger is derived
// from them, so it can be rebuilt at any time and must come out the same. The Merkle
// root does not change, because the trails do not change.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildLedger } from './ledger'
import type { TrailV2 } from './trail'

const REPO = join(import.meta.dir, '..')
const trails = readFileSync(join(REPO, 'docs/walk/trails.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrailV2)
const feeds = JSON.parse(readFileSync(join(REPO, 'docs/walk/feeds.json'), 'utf8'))
const before = JSON.parse(readFileSync(join(REPO, 'docs/ledger.json'), 'utf8'))
const ledger = buildLedger(trails, feeds, before.mark_block)
if (ledger.root !== before.root) throw new Error(`the trails give root ${ledger.root}, the ledger on disk says ${before.root}`)
writeFileSync(join(REPO, 'docs/ledger.json'), `${JSON.stringify(ledger, null, 1)}\n`)
console.log(`docs/ledger.json rebuilt from ${trails.length} trails, root ${ledger.root} unchanged`)
