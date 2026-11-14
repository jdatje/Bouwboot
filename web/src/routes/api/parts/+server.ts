import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { catalogue, requestPart, requestedParts, taughtParts } from '#lib/server/catalogue.ts';
import { ldrawAvailable } from '#lib/server/ldraw.ts';

/** GET ?q=&filter=all|taught|todo&page= → parts sorted by how common they are, with totals. */
export const GET: RequestHandler = async ({ url }) => {
	const c = await catalogue();
	if (!c) return json({ ready: false, taught: taughtParts().size });
	const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
	const filter = url.searchParams.get('filter') ?? 'all';
	const page = Math.max(0, Number(url.searchParams.get('page')) || 0);
	const req = requestedParts();
	let list = c.parts;
	if (filter === 'taught') list = list.filter((p) => p.taught);
	else if (filter === 'todo') list = list.filter((p) => !p.taught);
	if (q) list = list.filter((p) => p.part.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.cat.toLowerCase().includes(q));
	const per = 50;
	return json({
		ready: true,
		ldraw: ldrawAvailable(),
		totalParts: c.parts.length,
		taughtParts: c.parts.filter((p) => p.taught).length,
		coverage: c.total ? c.taughtQty / c.total : 0,
		count: list.length,
		page,
		items: list.slice(page * per, page * per + per).map((p) => ({ ...p, requested: req.get(p.part) ?? 0 }))
	});
};

/** POST {part}: ask for this part to be taught next. */
export const POST: RequestHandler = async ({ request }) => {
	const { part } = await request.json();
	if (typeof part === 'string' && /^[\w.-]{1,40}$/.test(part)) requestPart(part);
	return json({ ok: true });
};
