import { db } from './db';
import { PALETTE, type Color } from '#lib/bricks.ts';

const API = 'https://rebrickable.com/api/v3/lego';

async function rb(path: string): Promise<any> {
	const key = process.env.REBRICKABLE_API_KEY;
	if (!key) throw new Error('REBRICKABLE_API_KEY ontbreekt');
	for (let attempt = 0; attempt < 4; attempt++) {
		const res = await fetch(API + path, { headers: { authorization: `key ${key}` } });
		if (res.status === 429) {
			await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
			continue;
		}
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`Rebrickable ${res.status}`);
		return res.json();
	}
	throw new Error('Rebrickable: te veel verzoeken, probeer het zo nog eens');
}

export function normSetNum(s: string): string {
	s = s.trim();
	return /-\d+$/.test(s) ? s : s + '-1';
}

/** Adds a set and its full parts list (spares included) to the stock. */
export async function addSet(input: string) {
	const num = normSetNum(input);
	const set = await rb(`/sets/${encodeURIComponent(num)}/`);
	if (!set) throw new Error(`Set ${input} niet gevonden`);
	const parts: any[] = [];
	let url: string | null = `/sets/${encodeURIComponent(num)}/parts/?page_size=1000&inc_color_details=0`;
	while (url) {
		const page = await rb(url);
		parts.push(...page.results);
		url = page.next ? page.next.replace(API, '') : null;
	}
	const now = Date.now();
	const tx = db.transaction(() => {
		db.prepare('DELETE FROM stock WHERE source = ?').run('set:' + num);
		db.prepare(
			'INSERT OR REPLACE INTO sets (set_num, name, img, num_parts, assembled, added_at) VALUES (?, ?, ?, ?, 0, ?)'
		).run(num, set.name, set.set_img_url, set.num_parts, now);
		const ins = db.prepare('INSERT INTO stock (part, color, qty, source, added_at) VALUES (?, ?, ?, ?, ?)');
		const meta = db.prepare('INSERT OR IGNORE INTO parts (part, name, img) VALUES (?, ?, ?)');
		for (const p of parts) {
			ins.run(p.part.part_num, p.color.id, p.quantity, 'set:' + num, now);
			meta.run(p.part.part_num, p.part.name, p.part.part_img_url);
		}
	});
	tx();
	return { set_num: num, name: set.name, parts: parts.reduce((a, p) => a + p.quantity, 0) };
}

/** Name and picture of a part, fetched once and cached. */
export async function partMeta(part: string): Promise<{ name: string; img: string | null }> {
	const r = db.prepare('SELECT name, img FROM parts WHERE part = ?').get(part) as any;
	if (r?.name) return r;
	try {
		const p = await rb(`/parts/${encodeURIComponent(part)}/`);
		if (p) {
			db.prepare('INSERT OR REPLACE INTO parts (part, name, img) VALUES (?, ?, ?)').run(part, p.name, p.part_img_url);
			return { name: p.name, img: p.part_img_url };
		}
	} catch {}
	return { name: part, img: null };
}

/** All LEGO colours (Rebrickable id, BrickLink id, hex); synced once a week, palette as fallback. */
export async function colors(): Promise<Map<number, Color>> {
	const last = Number((db.prepare("SELECT v FROM kv WHERE k = 'colors_at'").get() as any)?.v ?? 0);
	if (Date.now() - last > 7 * 864e5 && process.env.REBRICKABLE_API_KEY) {
		try {
			const page = await rb('/colors/?page_size=1000');
			const ins = db.prepare('INSERT OR REPLACE INTO colors (id, name, hex, bl) VALUES (?, ?, ?, ?)');
			db.transaction(() => {
				for (const c of page.results) {
					const bl = c.external_ids?.BrickLink?.ext_ids?.[0] ?? null;
					ins.run(c.id, c.name, '#' + c.rgb, bl);
				}
				db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('colors_at', ?)").run(String(Date.now()));
			})();
		} catch {}
	}
	const m = new Map<number, Color>();
	for (const r of db.prepare('SELECT * FROM colors').all() as any[])
		m.set(r.id, { id: r.id, name: r.name, hex: r.hex, bl: r.bl });
	// Dutch names (and verified BrickLink ids where Rebrickable has them) for the palette colours
	for (const p of PALETTE) {
		const e = m.get(p.id);
		m.set(p.id, { ...p, bl: e?.bl ?? p.bl, hex: p.hex });
	}
	return m;
}
