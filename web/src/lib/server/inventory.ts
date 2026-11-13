import { db, type BuildRow } from './db';
import { countParts, LIBRARY, stockKey, type Brick, type PartCount } from '#lib/bricks.ts';

const key = (part: string, color: number) => `${part}/${color}`;

export type StockLine = {
	part: string;
	color: number;
	owned: number;
	lost: number;
	reserved: number;
	available: number;
};

/** Per part+colour: owned, lost ("kwijt"), reserved (in assembled builds/sets) and available. */
export function stockTable(excludeBuild?: string, includeAssembled = false): Map<string, StockLine> {
	const m = new Map<string, StockLine>();
	const get = (part: string, color: number) => {
		const k = key(part, color);
		let l = m.get(k);
		if (!l) m.set(k, (l = { part, color, owned: 0, lost: 0, reserved: 0, available: 0 }));
		return l;
	};
	for (const r of db.prepare('SELECT part, color, SUM(qty) q FROM stock GROUP BY part, color').all() as any[])
		get(r.part, r.color).owned += r.q;
	for (const r of db.prepare('SELECT part, color, qty FROM lost').all() as any[])
		get(r.part, r.color).lost += r.qty;
	// assembled sets reserve all their parts
	for (const r of db
		.prepare(`SELECT s.part, s.color, SUM(s.qty) q FROM stock s JOIN sets t ON s.source = 'set:' || t.set_num
		          WHERE t.assembled = 1 GROUP BY s.part, s.color`)
		.all() as any[])
		get(r.part, r.color).reserved += r.q;
	// assembled builds reserve their bricks
	for (const b of db.prepare('SELECT id, bricks FROM builds WHERE assembled = 1').all() as BuildRow[]) {
		if (b.id === excludeBuild) continue;
		for (const p of countParts(JSON.parse(b.bricks))) get(p.part, p.color).reserved += p.qty;
	}
	for (const l of m.values()) l.available = Math.max(0, l.owned - l.lost - (includeAssembled ? 0 : l.reserved));
	return m;
}

export type Coverage = { have: number; total: number; missing: PartCount[] };

/** How much of a build we can make from available stock, and what is missing. */
export function coverage(bricks: Brick[], excludeBuild?: string): Coverage {
	const st = stockTable(excludeBuild);
	let have = 0;
	let total = 0;
	const missing: PartCount[] = [];
	for (const p of countParts(bricks)) {
		const av = st.get(key(p.part, p.color))?.available ?? 0;
		const h = Math.min(av, p.qty);
		have += h;
		total += p.qty;
		if (p.qty > h) missing.push({ ...p, qty: p.qty - h });
	}
	return { have, total, missing };
}

/** Available simple parts per size and colour (for "alleen mijn stenen"): "2x4" = brick, "p2x4" = plate. */
export function availableLibrary(includeAssembled = false): Map<string, Map<number, number>> {
	const res = new Map<string, Map<number, number>>();
	for (const l of stockTable(undefined, includeAssembled).values()) {
		const size = stockKey(l.part);
		if (!size || l.available <= 0) continue;
		if (!res.has(size)) res.set(size, new Map());
		res.get(size)!.set(l.color, l.available);
	}
	return res;
}

/**
 * Makes coloured bricks fit the available stock: a brick whose colour is used up gets the
 * closest-in-spirit alternative (the colour the model picked for most similar bricks), or stays
 * as it is and ends up in the shopping list.
 */
export function fitToStock(bricks: Brick[], prefer: (size: string, wanted: number, options: number[]) => number, includeAssembled = false) {
	const avail = availableLibrary(includeAssembled);
	for (const b of bricks) {
		const size = `${b.k === 't' ? 't' : b.k ?? (b.p ? 'p' : '')}${Math.min(b.h, b.w)}x${Math.max(b.h, b.w)}`;
		const colors = avail.get(size);
		if (!colors) continue;
		const left = colors.get(b.c!) ?? 0;
		if (left > 0) {
			colors.set(b.c!, left - 1);
			continue;
		}
		const options = [...colors.entries()].filter(([, q]) => q > 0).map(([c]) => c);
		if (!options.length) continue;
		const c = prefer(size, b.c!, options);
		b.c = c;
		colors.set(c, colors.get(c)! - 1);
	}
}

export function libraryParts(): string[] {
	return Object.values(LIBRARY);
}

/**
 * Which assembled builds/sets would have to be taken apart to get the parts this build still misses
 * from loose stock. Builds first (they are usually quicker to take apart), then sets.
 */
export function teardown(bricks: Brick[], excludeBuild?: string): string[] {
	const need = new Map(coverage(bricks, excludeBuild).missing.map((p) => [key(p.part, p.color), p.qty]));
	if (!need.size) return [];
	const sources: { name: string; parts: Map<string, number> }[] = [];
	for (const b of db.prepare('SELECT id, title, bricks FROM builds WHERE assembled = 1').all() as any[]) {
		if (b.id === excludeBuild) continue;
		sources.push({ name: b.title, parts: new Map(countParts(JSON.parse(b.bricks)).map((p) => [key(p.part, p.color), p.qty])) });
	}
	for (const t of db.prepare('SELECT set_num, name FROM sets WHERE assembled = 1').all() as any[]) {
		const parts = new Map<string, number>();
		for (const r of db.prepare("SELECT part, color, SUM(qty) q FROM stock WHERE source = 'set:' || ? GROUP BY part, color").all(t.set_num) as any[])
			parts.set(key(r.part, r.color), r.q);
		sources.push({ name: `${t.name} (${t.set_num.replace(/-1$/, '')})`, parts });
	}
	const used: string[] = [];
	for (const src of sources) {
		let helps = false;
		for (const [k, q] of src.parts) {
			const n = need.get(k) ?? 0;
			if (n <= 0) continue;
			helps = true;
			need.set(k, n - Math.min(n, q));
		}
		if (helps) used.push(src.name);
		if ([...need.values()].every((n) => n <= 0)) break;
	}
	return used;
}

/** Short stock summary for the idea generator: totals per colour and per kind of part. */
export function stockSummary(includeAssembled: boolean) {
	const byColor = new Map<number, number>();
	const byKind = new Map<string, number>();
	let total = 0;
	for (const [size, cols] of availableLibrary(includeAssembled)) {
		const kind = size.startsWith('s45') || size.startsWith('s33') ? 'roof slopes' : size.startsWith('t') ? 'tiles' : size.startsWith('p') ? 'plates' : 'bricks';
		for (const [c, q] of cols) {
			byColor.set(c, (byColor.get(c) ?? 0) + q);
			byKind.set(kind, (byKind.get(kind) ?? 0) + q);
			total += q;
		}
	}
	return { total, byColor, byKind };
}
