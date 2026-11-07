import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, getBuild } from '#lib/server/db.ts';
import { colorize } from '#lib/server/gemini.ts';
import { availableLibrary, fitToStock } from '#lib/server/inventory.ts';
import { colors as allColors } from '#lib/server/rebrickable.ts';
import { buildInfo } from '#lib/server/buildinfo.ts';
import { PALETTE, PALETTE_BY_ID, hexToRgb, nearestColor, type Color } from '#lib/bricks.ts';

export const POST: RequestHandler = async ({ params, request }) => {
	const { variation = 1 } = await request.json().catch(() => ({}));
	const b = getBuild(params.id);
	if (!b) error(404, 'Bouwwerk niet gevonden');
	let palette: Color[] = PALETTE;
	const all = await allColors();
	const col = (id: number) => PALETTE_BY_ID.get(id) ?? all.get(id);
	if (b.only_mine) {
		const lib = availableLibrary();
		palette = [...new Set([...lib.values()].flatMap((m) => [...m.keys()]))].map(col).filter(Boolean) as Color[];
		if (!palette.length) palette = PALETTE;
	}
	const bricks = b.bricks.map(({ c, ...rest }) => rest);
	const cols = await colorize(b.prompt, b.caption, bricks, palette, variation);
	bricks.forEach((x: any, i) => (x.c = cols[i]));
	if (b.only_mine)
		fitToStock(bricks, (_s, wanted, options) => {
			const w = col(wanted);
			const opts = options.map(col).filter(Boolean) as Color[];
			return w && opts.length ? nearestColor(hexToRgb(w.hex), opts).id : options[0];
		});
	db.prepare('UPDATE builds SET bricks = ? WHERE id = ?').run(JSON.stringify(bricks), b.id);
	return json(await buildInfo(b.id));
};
