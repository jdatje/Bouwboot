/**
 * All official LEGO parts (Rebrickable download, DATA_DIR/rebrickable), how common each one is in
 * official sets, and which of them the designer already knows ("taught"). Computed once and cached.
 */
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { LIBRARY, PLATES, SLOPES45, SLOPES33, TILES, PART_ALIASES } from '#lib/bricks.ts';
import SPECIALS from '#lib/specials.json';
import { db } from '#lib/server/db.ts';

const DIR = () => path.join(process.env.DATA_DIR || 'data', 'rebrickable');
const OUT = () => path.join(process.env.DATA_DIR || 'data', 'catalogue.v2.json');
const SKIP_CATEGORIES = new Set(['Stickers', 'Non-LEGO']);

export type CatPart = { part: string; name: string; cat: string; qty: number; sets: number; taught: boolean; parked?: string };

/**
 * Parts that don't fit Bouwboot's studs-on-top building are kept apart ("Apart"): they never go into the
 * normal to-do list or a "teach the next N" batch, only on a special request. Value = reason shown.
 */
const PARK_CATEGORIES: [RegExp, string][] = [
	[/^Technic/, 'Technic'], [/^Duplo|Quatro|Primo/i, 'Duplo'], [/^Minifig|^Minidoll/, 'Minifiguren'],
	[/^Belville|^Znap|^Clikits|^Modulex|^HO Scale|^Large Buildable|^Non-Buildable/, 'Andere bouwsystemen'],
	[/^Pneumatics|^Electronics|^Mechanical|^Gear Parts|^Magnets/, 'Techniek en elektronica'],
	[/^String|^Tubes and Hoses|^Projectiles|^Energy Effects|^Tools/, 'Overig'],
	[/^Animals|^Rock/, 'Figuren en vormstukken']
];
function parkReason(part: string, name: string, cat: string): string | undefined {
	for (const [re, why] of PARK_CATEGORIES) if (re.test(cat)) return why;
	if (/pr\d|pat\d|pb\d/.test(part) || /\bwith .*(Print|Pattern)\b/i.test(name)) return 'Bedrukt';
	return undefined;
}
type Catalogue = { parts: CatPart[]; total: number; taughtQty: number; built: number; rel?: Record<string, string[]> };

/** Parts the designer can place (its own brick/plate/slope/tile list + the special pieces). */
export function taughtParts(): Map<string, string> {
	const m = new Map<string, string>();
	for (const [tbl, label] of [[LIBRARY, 'Steen'], [PLATES, 'Plaat'], [SLOPES45, 'Dakpan 45°'], [SLOPES33, 'Dakpan 33°'], [TILES, 'Tegel']] as const)
		for (const [size, p] of Object.entries(tbl)) m.set(p, `${label} ${size}`);
	for (const [k, v] of Object.entries(SPECIALS)) {
		if (k.startsWith('_')) continue;
		for (const b of (v as any).buy) if (!m.has(b.p)) m.set(b.p, (v as any).name);
	}
	return m;
}

async function* csv(file: string): AsyncGenerator<string[]> {
	const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
	let first = true;
	for await (const line of rl) {
		if (first) { first = false; continue; }
		// names may be quoted and contain commas
		if (line.includes('"')) {
			const out: string[] = [];
			let cur = '', q = false;
			for (let i = 0; i < line.length; i++) {
				const ch = line[i];
				if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
				else if (ch === ',' && !q) { out.push(cur); cur = ''; }
				else cur += ch;
			}
			out.push(cur);
			yield out;
		} else yield line.split(',');
	}
}

let building: Promise<Catalogue | null> | null = null;
let current: Catalogue | null = null;

export function catalogueAvailable() {
	return existsSync(path.join(DIR(), 'inventory_parts.csv.gz'));
}

export function catalogue(): Promise<Catalogue | null> {
	const src = path.join(DIR(), 'inventory_parts.csv.gz');
	if (!existsSync(src)) return Promise.resolve(null);
	const srcTime = statSync(src).mtimeMs;
	if (current && current.built >= srcTime) return Promise.resolve(current);
	if (!current && existsSync(OUT())) {
		try {
			const c = JSON.parse(readFileSync(OUT(), 'utf8')) as Catalogue;
			if (c.built >= srcTime) {
				relCache = new Map(Object.entries(c.rel ?? {}));
				current = markTaught(c);
				return Promise.resolve(current);
			}
		} catch {}
	}
	building ??= build().then((c) => { building = null; if (c) current = c; return c; }, () => { building = null; return null; });
	return building;
}

function markTaught(c: Catalogue): Catalogue {
	// the taught list changes with the code, so it is applied fresh rather than taken from the cache
	const taught = expandTaught();
	let tq = 0;
	for (const p of c.parts) {
		p.taught = taught.has(p.part);
		if (p.taught) tq += p.qty;
	}
	c.taughtQty = tq;
	return c;
}

let relCache: Map<string, string[]> | null = null;
function expandTaught(): Set<string> {
	const set = new Set<string>();
	for (const p of taughtParts().keys()) set.add(p);
	for (const [other, ours] of Object.entries(PART_ALIASES)) if (set.has(ours)) set.add(other);
	// mould variants and alternates of a taught part count as taught too
	if (relCache) for (const p of [...set]) for (const r of relCache.get(p) ?? []) set.add(r);
	return set;
}

async function build(): Promise<Catalogue | null> {
	const d = DIR();
	const cats = new Map<string, string>();
	for await (const r of csv(path.join(d, 'part_categories.csv.gz'))) cats.set(r[0], r[1]);
	const names = new Map<string, { name: string; cat: string }>();
	for await (const r of csv(path.join(d, 'parts.csv.gz'))) names.set(r[0], { name: r[1], cat: cats.get(r[2]) ?? '' });
	relCache = new Map();
	if (existsSync(path.join(d, 'part_relationships.csv.gz')))
		for await (const r of csv(path.join(d, 'part_relationships.csv.gz'))) {
			if (r[0] !== 'M' && r[0] !== 'A') continue;
			const add = (a: string, b: string) => { const l = relCache!.get(a) ?? []; l.push(b); relCache!.set(a, l); };
			add(r[1], r[2]);
			add(r[2], r[1]);
		}
	const qty = new Map<string, number>();
	const sets = new Map<string, Set<string>>();
	for await (const r of csv(path.join(d, 'inventory_parts.csv.gz'))) {
		if (r[4] === 'True' || r[4] === 't') continue; // spare parts
		const p = r[1];
		qty.set(p, (qty.get(p) ?? 0) + (Number(r[3]) || 0));
		let s = sets.get(p);
		if (!s) sets.set(p, (s = new Set()));
		if (s.size < 100000) s.add(r[0]);
	}
	const parts: CatPart[] = [];
	let total = 0;
	for (const [part, n] of names) {
		if (SKIP_CATEGORIES.has(n.cat)) continue;
		const q = qty.get(part) ?? 0;
		total += q;
		parts.push({ part, name: n.name, cat: n.cat, qty: q, sets: sets.get(part)?.size ?? 0, taught: false, parked: parkReason(part, n.name, n.cat) });
	}
	parts.sort((a, b) => b.qty - a.qty);
	const c: Catalogue = { parts, total, taughtQty: 0, built: Date.now(), rel: Object.fromEntries(relCache) };
	writeFileSync(OUT(), JSON.stringify(c));
	return markTaught(c);
}

/** Someone asked for a part to be taught next. */
export function requestPart(part: string) {
	db.exec('CREATE TABLE IF NOT EXISTS part_requests (part TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 1, at INTEGER NOT NULL)');
	db.prepare('INSERT INTO part_requests (part, n, at) VALUES (?, 1, ?) ON CONFLICT(part) DO UPDATE SET n = n + 1, at = excluded.at').run(part, Date.now());
}
/** A request taken back. */
export function unrequestPart(part: string) {
	db.exec('CREATE TABLE IF NOT EXISTS part_requests (part TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 1, at INTEGER NOT NULL)');
	db.prepare('DELETE FROM part_requests WHERE part = ?').run(part);
}
export function requestedParts(): Map<string, number> {
	db.exec('CREATE TABLE IF NOT EXISTS part_requests (part TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 1, at INTEGER NOT NULL)');
	return new Map((db.prepare('SELECT part, n FROM part_requests').all() as { part: string; n: number }[]).map((r) => [r.part, r.n]));
}
