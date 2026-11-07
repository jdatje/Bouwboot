import { db, type BuildRow } from './db';
import { countParts, LIBRARY, PART_TO_SIZE, type Brick, type PartCount } from '#lib/bricks';

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
export function stockTable(excludeBuild?: string): Map<string, StockLine> {
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
	for (const l of m.values()) l.available = Math.max(0, l.owned - l.lost - l.reserved);
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

/** Available plain bricks per size and colour (for "alleen mijn stenen"). */
export function availableLibrary(): Map<string, Map<number, number>> {
	const res = new Map<string, Map<number, number>>();
	for (const l of stockTable().values()) {
		const size = PART_TO_SIZE[l.part];
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
export function fitToStock(bricks: Brick[], prefer: (size: string, wanted: number, options: number[]) => number) {
	const avail = availableLibrary();
	for (const b of bricks) {
		const size = `${Math.min(b.h, b.w)}x${Math.max(b.h, b.w)}`;
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
