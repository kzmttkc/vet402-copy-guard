// What the README (scripts/readme-numbers.mjs) and the page (scripts/build-page.mjs) say about
// the groups of wallets, how a token reached a wallet, the selection and the recheck's times.
// Both read it from here, so the two cannot drift apart. It only reads and counts. It never
// fills in a number that the ledger, selection.json or a saved run does not give.
//
// The fields it reads (docs/walk/FIELDS.md has the meaning of every ledger field):
//
//   totals.by_group.<selected | observed_other_token_buyers | demo>
//     wallets, decisions, opened, declined
//     followed_purchases_usd   { count, sum, median, min, max }   the wallets' own purchases copy-guard followed
//     same_size                { size_usd, count, put_in_usd, result_usd }   copy-guard's positions at the one size
//     top_wallet               { wallet, opened }   the wallet with the most positions in the group
//     ticker_copy_opened, ticker_copy_in_other_tokens
//   When totals.by_group is missing (a ledger written before it), the same numbers are counted
//   from rows[], copy_guard_positions[] and totals.by_cohort, and `source` says so.
//
//   rows[].main.arrival      purchase | purchase_off_venue | rotation | liquidity | swapped_unpaid | received | out
//   totals.stock_moves, totals.other_tokens.by_arrival   the same kinds, counted per incoming token
//
//   selection.json  routers[] { address, name }   routers a venue's transfer may pass through
//                   counts.via_router              candidate transfers that came through one of them
//
//   docs/verify/verify-quick-runs.txt, docs/verify/verify-five-runs.txt, docs/verify/verify-offline-runs.txt
//     one line per run: "run N (HH:MM:SSZ): exit X, S s, <last lines>"
//     a saved .txt may start with three header lines ($ command, node -v, UTC). skipSavedHeader drops them.

export const GROUP_KEYS = ['selected', 'observed_other_token_buyers', 'demo']

/** Drop the three-line saved-output header: `$ command`, `node -v`, UTC timestamp. */
export function skipSavedHeader(text) {
	const lines = String(text ?? '').split('\n')
	if (lines[0]?.startsWith('$ ') && lines.length >= 3) return lines.slice(3).join('\n')
	return String(text ?? '')
}
const FROM_COHORT = { top_buyers: 'selected', selected: 'selected', same_ticker_buyers: 'observed_other_token_buyers', observed_other_token_buyers: 'observed_other_token_buyers', watched: 'demo', demo: 'demo' }
export const groupOf = (cohort) => FROM_COHORT[cohort] ?? cohort

// `name` heads a table row, `of` sits inside a sentence. The observed group is named by the ticker
// of the token it was chosen for, read from selection.json.
export function groupWords(key, selection) {
	const ticker = selection?.same_ticker_buyers?.ticker
	const other = ticker ? `the other ${ticker}` : 'a token under a listed ticker at another address'
	return {
		selected: { name: 'Selected: the largest buyers', of: 'the selected wallets' },
		observed_other_token_buyers: { name: `Observed: buyers of ${other}`, of: `the wallets observed buying ${other}` },
		demo: { name: 'Demo wallet', of: 'the demo wallet' },
	}[key] ?? { name: key, of: key }
}

// How a token can reach a wallet: the kind, its words, what it means. copy-guard opens only on a
// purchase at an official venue (rule V1). A ticker copy opens on any purchase.
export const ARRIVALS = [
	['purchase', 'bought at an official venue', 'The wallet paid, and the Uniswap v4 PoolManager or an official v3 pool put the token out.'],
	['purchase_off_venue', 'bought outside the official venues', 'The wallet paid for it, and no official venue put it out. copy-guard does not follow this, because rule V1 asks for an official venue. A ticker copy follows it.'],
	['rotation', 'swapped for another Stock Token', 'Another Stock Token left the wallet in the same transaction.'],
	['liquidity', 'part of a liquidity operation', 'A liquidity log is in the transaction.'],
	['swapped_unpaid', 'swapped in, not paid by the wallet', 'An official venue put it out, and the payment did not leave this wallet.'],
	['received', 'sent to the wallet', 'No official venue put it out and the wallet paid nothing for it: a transfer, an airdrop or a bridge delivery.'],
	['out', 'left the wallet', 'A sale or a transfer out.'],
]

const lc = (s) => String(s ?? '').toLowerCase()
const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x))
const two = (n) => (n === null ? null : n.toFixed(2))
const median = (xs) => {
	if (!xs.length) return null
	const s = [...xs].sort((a, b) => a - b)
	const m = Math.floor(s.length / 2)
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** One entry per group, in GROUP_KEYS order, each with the same fields whatever the ledger's version. */
export function groupsOf(L, selection = null) {
	const t = L.totals
	const given = t.by_group
	const size = t.same_size?.size_usd ?? L.limits?.size?.reduced_usd ?? null
	const out = []
	for (const key of GROUP_KEYS) {
		let g
		if (given) {
			const x = given[key]
			if (!x) continue
			const f = x.followed_purchases_usd ?? null
			const ss = x.same_size ?? null
			const opened = num(x.opened ?? x.copy_guard_opened) ?? 0
			const top = x.top_wallet ?? null
			g = {
				key,
				wallets: num(x.wallets) ?? 0,
				decisions: num(x.decisions) ?? 0,
				opened,
				declined: num(x.declined ?? x.none) ?? 0,
				followed: f && num(f.count) ? { count: num(f.count), sum: f.sum, median: f.median, min: f.min, max: f.max } : null,
				same_size: ss && num(ss.count) ? { size_usd: ss.size_usd ?? size, count: num(ss.count), put_in_usd: ss.put_in_usd, result_usd: ss.result_usd } : null,
				top_wallet: top && opened ? { wallet: lc(top.wallet), opened: num(top.opened) } : null,
				ticker_copy_opened: num(x.ticker_copy_opened),
				ticker_copy_in_other_tokens: num(x.ticker_copy_in_other_tokens),
				source: 'by_group',
			}
		} else {
			const rows = L.rows.filter((r) => groupOf(r.cohort) === key)
			if (!rows.length) continue
			const pos = new Map(L.copy_guard_positions.map((p) => [p.n, p]))
			const followed = rows.filter((r) => r.copy_guard.opened)
			const usd = followed.map((r) => num(r.move_usd)).filter((v) => v !== null)
			const mine = followed.map((r) => pos.get(r.n)).filter(Boolean)
			const per = new Map()
			for (const r of followed) per.set(lc(r.wallet), (per.get(lc(r.wallet)) ?? 0) + 1)
			const [topW, topN] = [...per.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0] ?? []
			const bc = t.by_cohort ? Object.entries(t.by_cohort).find(([k]) => groupOf(k) === key)?.[1] : null
			g = {
				key,
				wallets: new Set(rows.map((r) => lc(r.wallet))).size,
				decisions: rows.length,
				opened: followed.length,
				declined: rows.filter((r) => r.tier === 'NONE').length,
				followed: usd.length ? { count: usd.length, sum: two(usd.reduce((a, b) => a + b, 0)), median: two(median(usd)), min: two(Math.min(...usd)), max: two(Math.max(...usd)) } : null,
				// every copy-guard position is at the reduced size in a walk with no FULL row, so these are the positions at the one size
				same_size: mine.length && mine.every((p) => p.notional_usd === size && p.result_usd !== null) ? { size_usd: size, count: mine.length, put_in_usd: two(mine.length * Number(size)), result_usd: two(mine.reduce((a, p) => a + Number(p.result_usd), 0)) } : null,
				top_wallet: topW ? { wallet: topW, opened: topN } : null,
				ticker_copy_opened: bc?.ticker_copy_opened ?? rows.filter((r) => r.blind_copy.opened).length,
				ticker_copy_in_other_tokens: bc?.ticker_copy_in_other_tokens ?? null,
				source: 'rows',
			}
		}
		Object.assign(g, groupWords(key, selection))
		g.top_share_pct = g.top_wallet && g.opened ? Math.round((100 * g.top_wallet.opened) / g.opened) : null
		out.push(g)
	}
	return out
}

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`
const plural = (n, one, many) => `${n} ${Number(n) === 1 ? one : many}`
const thousands = (s) => {
	const [i, d] = String(s).split('.')
	return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${d !== undefined ? `.${d}` : ''}`
}
export const usdWords = (s) => `${thousands(s)} USD`
export const usdRange = (f) => (f.count === 1 || f.min === f.max ? usdWords(f.median) : `${thousands(f.min)} to ${usdWords(f.max)}`)

/** What the observed group bought, from selection.json: "a token with the ticker SPY". */
export function observedToken(selection) {
	const s = selection?.same_ticker_buyers
	return s?.ticker ? `a token with the ticker ${s.ticker} at an address the issuer did not list` : 'a token under a listed ticker at an address the issuer did not list'
}

/** One sentence per group that opened anything: how much of it is one wallet. */
export function concentration(groups) {
	return groups
		.filter((g) => g.opened && g.top_wallet)
		.map((g) => {
			if (g.top_wallet.opened === g.opened) return g.opened === 1 ? `The one position copy-guard opened for ${g.of} follows ${short(g.top_wallet.wallet)}.` : `All ${g.opened} positions copy-guard opened for ${g.of} follow one wallet, ${short(g.top_wallet.wallet)}, so that group's result is one wallet's result.`
			return `Of the ${g.opened} positions copy-guard opened for ${g.of}, the busiest wallet, ${short(g.top_wallet.wallet)}, has ${g.top_wallet.opened} (${g.top_share_pct}%).`
		})
		.join(' ')
}

/** What copy-guard's positions followed, group by group. */
export function followedSentence(groups) {
	const parts = groups
		.filter((g) => g.opened)
		.map((g) => {
			const f = g.followed
			const what = `${plural(g.opened, 'position', 'positions')} following ${g.of}`
			if (!f) return `${what}, on purchases whose size was not measured`
			if (f.count === 1) return `${what}, on a purchase of ${usdWords(f.median)}`
			return `${what}, on purchases of ${usdRange(f)} (median ${usdWords(f.median)})`
		})
	if (!parts.length) return ''
	return `copy-guard opened ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`}.`
}

/** The groups in one or two sentences for the top of the README and the page. A group that is
 * mostly one wallet says so in the same sentence. */
export function groupsBrief(groups) {
	const open = groups.filter((g) => g.opened)
	if (!open.length) return ''
	const one = (g) => {
		const f = g.followed && g.followed.count > 1 ? `purchases of ${usdRange(g.followed)} by ` : ''
		const by = f ? 'by one wallet' : 'one wallet'
		const top = g.top_wallet && g.top_share_pct >= 50 ? `, ${g.top_wallet.opened === g.opened ? 'all of them' : `${g.top_wallet.opened} of them`} ${by}, ${short(g.top_wallet.wallet)}` : ''
		return `${g.opened} follow ${f}${g.of}${top}`
	}
	return `The practice positions copy-guard did open come from ${plural(open.length, 'group', 'groups')}, counted apart. ${open.map((g) => `${one(g).replace(/^./, (c) => c.toUpperCase())}.`).join(' ')}`
}

/** How the selected wallets were ranked. The router clause appears only when selection.json lists routers. */
export function selectionSentence(selection, groups) {
	const sel = groups.find((g) => g.key === 'selected')
	const days = selection?.window?.days
	const routers = Array.isArray(selection?.routers) ? selection.routers : []
	const via = selection?.counts?.via_router
	const names = routers.map((r) => r.name || short(lc(r.address ?? r.router ?? '')))
	const list = names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
	const how = routers.length
		? `by what they received of Stock Tokens from the official venues, directly or through ${routers.length === 1 ? `one router (${list})` : `one of ${routers.length} routers (${list})`}, largest first`
		: 'by what the official venues sent them of Stock Tokens, largest first'
	return [
		`${sel ? `The ${plural(sel.wallets, 'selected wallet', 'selected wallets')}` : 'The selected wallets'} were ranked ${how}${days ? `, over ${days} days` : ''}, and picked by that rule, not by hand.`,
		routers.length && via !== undefined && via !== null ? `${thousands(via)} of the transfers counted came through a router.` : '',
	]
		.filter(Boolean)
		.join(' ')
}

/** Moves by how the token arrived: Stock Tokens and other tokens from the totals, the books from the rows. */
export function arrivalsOf(L) {
	const t = L.totals
	const stock = t.stock_moves ?? {}
	const other = t.other_tokens?.by_arrival ?? {}
	return ARRIVALS.map(([key, label, means]) => {
		const rows = L.rows.filter((r) => r.main?.arrival === key)
		return {
			key,
			label,
			means,
			known: key in stock || key in other,
			stock: stock[key] ?? 0,
			other: other[key] ?? 0,
			copy_guard_opened: rows.filter((r) => r.copy_guard.opened).length,
			ticker_copy_opened: rows.filter((r) => r.blind_copy.opened).length,
		}
	}).filter((a) => a.known || a.stock || a.other || a.copy_guard_opened || a.ticker_copy_opened)
}

/** The recheck's times from the saved runs, and the heading they allow. */
export function verifyTimes(readIf, verifySource) {
	const runs = (text) => [...skipSavedHeader(text).matchAll(/^run \d+ \((\S+)\): exit (\d+), (\d+) s, (.*)$/gm)].map((m) => ({ exit: Number(m[2]), s: Number(m[3]), tail: m[4] }))
	const span = (text) => {
		const r = runs(text)
		if (!r.length) return null
		const xs = r.map((x) => x.s)
		const body = skipSavedHeader(text)
		return { runs: r.length, min: Math.min(...xs), max: Math.max(...xs), all_match: r.every((x) => x.exit === 0 && /RESULT: MATCH/.test(x.tail)), day: body.match(/on (\d{4}-\d{2}-\d{2})/)?.[1] ?? null }
	}
	const quickText = readIf('docs/verify/verify-quick-runs.txt')
	const quick = span(quickText)
	const full = span(readIf('docs/verify/verify-five-runs.txt'))
	const offline = span(readIf('docs/verify/verify-offline-runs.txt'))
	const hasQuick = Boolean(quick) || /['"]--quick['"]/.test(verifySource ?? '')
	// The heading promises the slowest saved quick run, rounded up to a multiple of five.
	const promise = quick ? Math.max(5, Math.ceil(quick.max / 5) * 5) : null
	return {
		quick,
		full,
		offline,
		hasQuick,
		quickOutput: readIf('docs/verify/verify-quick-output.txt'),
		offlineOutput: readIf('docs/verify/verify-offline.txt'),
		heading: 'Verify it yourself with one command',
		promise,
	}
}

export const secondsWords = (x) => (x ? (x.min === x.max ? `${x.min} s` : `${x.min} to ${x.max} s`) : null)
export const slug = (heading) => heading.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')
