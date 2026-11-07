import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, type BuildRow } from '#lib/server/db.ts';

export const GET: RequestHandler = async () => {
	const rows = db
		.prepare('SELECT id, title, prompt, bricks, assembled, order_status, created_at, thumb FROM builds WHERE saved = 1 ORDER BY created_at DESC')
		.all() as BuildRow[];
	return json(rows.map((r) => ({ ...r, bricks: JSON.parse(r.bricks) })));
};
