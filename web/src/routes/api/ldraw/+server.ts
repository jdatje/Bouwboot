import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ldrawAvailable, partMesh } from '#lib/server/ldraw.ts';

/** GET /api/ldraw?ids=3001,3039,4624c01 → { parts: { id: mesh|null }, available } */
export const GET: RequestHandler = async ({ url }) => {
	const ids = (url.searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
	const parts: Record<string, unknown> = {};
	for (const id of ids) parts[id] = partMesh(id);
	return json(
		{ parts, available: ldrawAvailable() },
		{ headers: { 'cache-control': ldrawAvailable() ? 'public, max-age=604800' : 'no-store' } }
	);
};
