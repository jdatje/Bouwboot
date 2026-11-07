import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db.ts';
import { partMeta } from '#lib/server/rebrickable.ts';

/** Confirmed scan results go into the stock in one go. */
export const POST: RequestHandler = async ({ request }) => {
	const { items } = (await request.json()) as { items: { part: string; color: number; qty: number }[] };
	const now = Date.now();
	const ins = db.prepare('INSERT INTO stock (part, color, qty, source, added_at) VALUES (?, ?, ?, ?, ?)');
	let n = 0;
	db.transaction(() => {
		for (const it of items ?? []) {
			if (!it.part || !Number.isInteger(it.color) || !(it.qty > 0)) continue;
			ins.run(String(it.part), it.color, Math.floor(it.qty), 'scan', now);
			n += it.qty;
		}
	})();
	for (const p of new Set((items ?? []).map((i) => i.part))) partMeta(p).catch(() => {});
	return json({ ok: true, added: n });
};
