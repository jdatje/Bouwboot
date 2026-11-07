import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db.ts';

/** "Kwijt": mark pieces as missing (delta > 0) or found again (delta < 0). */
export const POST: RequestHandler = async ({ request }) => {
	const { part, color, delta } = await request.json();
	if (!part || !Number.isInteger(color) || !Number.isInteger(delta)) error(400, 'Ongeldige invoer');
	const owned = (db.prepare('SELECT COALESCE(SUM(qty),0) q FROM stock WHERE part = ? AND color = ?').get(part, color) as any).q;
	const cur = (db.prepare('SELECT qty FROM lost WHERE part = ? AND color = ?').get(part, color) as any)?.qty ?? 0;
	const next = Math.max(0, Math.min(owned, cur + delta));
	if (next === 0) db.prepare('DELETE FROM lost WHERE part = ? AND color = ?').run(part, color);
	else db.prepare('INSERT OR REPLACE INTO lost (part, color, qty) VALUES (?, ?, ?)').run(part, color, next);
	return json({ ok: true, lost: next });
};
