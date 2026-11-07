import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db.ts';
import { partMeta } from '#lib/server/rebrickable.ts';

/** Manual correction: +/- a number of a part in a colour. */
export const POST: RequestHandler = async ({ request }) => {
	const { part, color, delta } = await request.json();
	if (!part || !Number.isInteger(color) || !Number.isInteger(delta) || delta === 0) error(400, 'Ongeldige invoer');
	if (delta > 0) {
		db.prepare('INSERT INTO stock (part, color, qty, source, added_at) VALUES (?, ?, ?, ?, ?)').run(String(part), color, delta, 'manual', Date.now());
		partMeta(String(part)).catch(() => {});
	} else {
		// remove from the most recent rows first, never below zero
		let left = -delta;
		const rows = db.prepare('SELECT id, qty FROM stock WHERE part = ? AND color = ? ORDER BY added_at DESC').all(String(part), color) as any[];
		db.transaction(() => {
			for (const r of rows) {
				if (left <= 0) break;
				const take = Math.min(left, r.qty);
				if (take === r.qty) db.prepare('DELETE FROM stock WHERE id = ?').run(r.id);
				else db.prepare('UPDATE stock SET qty = qty - ? WHERE id = ?').run(take, r.id);
				left -= take;
			}
		})();
	}
	return json({ ok: true });
};
