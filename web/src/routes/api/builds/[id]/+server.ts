import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db.ts';
import { buildInfo } from '#lib/server/buildinfo.ts';

export const GET: RequestHandler = async ({ params }) => {
	const info = await buildInfo(params.id);
	if (!info) error(404, 'Bouwwerk niet gevonden');
	return json(info);
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	for (const k of ['saved', 'assembled'] as const)
		if (k in body) db.prepare(`UPDATE builds SET ${k} = ? WHERE id = ?`).run(body[k] ? 1 : 0, params.id);
	if (typeof body.thumb === 'string' && body.thumb.startsWith('data:image/') && body.thumb.length < 400_000)
		db.prepare('UPDATE builds SET thumb = ? WHERE id = ?').run(body.thumb, params.id);
	if (typeof body.title === 'string')
		db.prepare('UPDATE builds SET title = ? WHERE id = ?').run(body.title.slice(0, 60), params.id);
	return json(await buildInfo(params.id));
};

export const DELETE: RequestHandler = async ({ params }) => {
	db.prepare('DELETE FROM builds WHERE id = ?').run(params.id);
	return json({ ok: true });
};
