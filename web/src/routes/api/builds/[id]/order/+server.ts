import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, getBuild } from '#lib/server/db.ts';
import { coverage } from '#lib/server/inventory.ts';
import { buildInfo } from '#lib/server/buildinfo.ts';

/** Marks the build as ordered ("besteld") and freezes the shopping list. */
export const POST: RequestHandler = async ({ params }) => {
	const b = getBuild(params.id);
	if (!b) error(404, 'Bouwwerk niet gevonden');
	const { missing } = coverage(b.bricks, b.id);
	const lines = missing.map((m) => ({ ...m, received: false }));
	db.prepare("UPDATE builds SET order_status = ?, order_list = ?, saved = 1 WHERE id = ?").run(
		lines.length ? 'besteld' : null,
		JSON.stringify(lines),
		b.id
	);
	return json(await buildInfo(b.id));
};

/** Cancels the order. */
export const DELETE: RequestHandler = async ({ params }) => {
	db.prepare("UPDATE builds SET order_status = NULL, order_list = NULL WHERE id = ? AND order_status = 'besteld'").run(params.id);
	return json(await buildInfo(params.id));
};
