import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db.ts';
import { stockTable } from '#lib/server/inventory.ts';
import { colors } from '#lib/server/rebrickable.ts';
import { PALETTE_BY_ID, partInfo, partLabel } from '#lib/bricks.ts';

export const GET: RequestHandler = async () => {
	const all = await colors();
	const meta = new Map((db.prepare('SELECT part, name, img FROM parts').all() as any[]).map((r) => [r.part, r]));
	const lines = [...stockTable().values()]
		.filter((l) => l.owned > 0)
		.map((l) => {
			const c = PALETTE_BY_ID.get(l.color) ?? all.get(l.color);
			const info = partInfo(l.part);
			return {
				...l,
				size: info?.size ?? null,
				plate: info?.plate ?? false,
				kind: info?.kind ?? null,
				name: info ? partLabel(l.part) : meta.get(l.part)?.name ?? l.part,
				img: meta.get(l.part)?.img ?? null,
				colorName: c?.name ?? `Kleur ${l.color}`,
				hex: c?.hex ?? '#999999'
			};
		})
		.sort((a, b) => Number(!!b.size) - Number(!!a.size) || b.owned - a.owned);
	const sets = db.prepare('SELECT * FROM sets ORDER BY added_at DESC').all();
	return json({ lines, sets });
};
