import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, getBuild } from '#lib/server/db.ts';
import { buildInfo } from '#lib/server/buildinfo.ts';

/** Ticks off delivered order lines and adds them to the stock. */
export const POST: RequestHandler = async ({ params, request }) => {
	const { lines } = (await request.json()) as { lines: number[] };
	const b = getBuild(params.id);
	if (!b || !b.order_list) error(404, 'Geen bestelling gevonden');
	const now = Date.now();
	const ins = db.prepare('INSERT INTO stock (part, color, qty, source, added_at) VALUES (?, ?, ?, ?, ?)');
	db.transaction(() => {
		for (const i of lines) {
			const l = b.order_list![i];
			if (!l || l.received) continue;
			ins.run(l.part, l.color, l.qty, 'order:' + b.id, now);
			l.received = true;
		}
		const all = b.order_list!.every((l) => l.received);
		db.prepare('UPDATE builds SET order_list = ?, order_status = ? WHERE id = ?').run(
			JSON.stringify(b.order_list),
			all ? 'binnen' : 'besteld',
			b.id
		);
	})();
	return json(await buildInfo(b.id));
};
