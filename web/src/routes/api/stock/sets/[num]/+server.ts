import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db.ts';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const { assembled } = await request.json();
	db.prepare('UPDATE sets SET assembled = ? WHERE set_num = ?').run(assembled ? 1 : 0, params.num);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	db.transaction(() => {
		db.prepare('DELETE FROM stock WHERE source = ?').run('set:' + params.num);
		db.prepare('DELETE FROM sets WHERE set_num = ?').run(params.num);
	})();
	return json({ ok: true });
};
