import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBuild } from '#lib/server/db.ts';
import { coverage } from '#lib/server/inventory.ts';
import { colors } from '#lib/server/rebrickable.ts';
import { wantedListXml } from '#lib/server/buildinfo.ts';
import { PALETTE_BY_ID } from '#lib/bricks.ts';

/** BrickLink wanted list: the frozen order list if ordered, otherwise what's missing now. */
export const GET: RequestHandler = async ({ params }) => {
	const b = getBuild(params.id);
	if (!b) error(404, 'Bouwwerk niet gevonden');
	const all = await colors();
	const lines = b.order_list ? b.order_list.filter((l) => !l.received) : coverage(b.bricks, b.id).missing;
	const xml = wantedListXml(lines, (c) => all.get(c)?.bl ?? PALETTE_BY_ID.get(c)?.bl ?? 0);
	return new Response(xml, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'content-disposition': `attachment; filename="bouwboot-${b.id}.xml"`
		}
	});
};
