import { getBuild, type Build } from './db';
import { coverage, teardown } from './inventory';
import { colors } from './rebrickable';
import { countParts, PALETTE_BY_ID } from '#lib/bricks.ts';

/** Build plus everything the result page needs: coverage of own stock and colour info. */
export async function buildInfo(id: string) {
	const b = getBuild(id);
	if (!b) return null;
	const cov = coverage(b.bricks, b.id);
	const all = await colors();
	const ids = new Set(countParts(b.bricks).map((p) => p.color));
	for (const l of b.order_list ?? []) ids.add(l.color);
	const colorInfo = Object.fromEntries(
		[...ids].map((id) => [id, PALETTE_BY_ID.get(id) ?? all.get(id) ?? { id, name: `Kleur ${id}`, hex: '#999999', bl: 0 }])
	);
	const { thumb, ...rest } = b as Build & { thumb?: string };
	return { build: rest as Build, coverage: cov, colors: colorInfo, teardown: cov.missing.length ? teardown(b.bricks, b.id) : [] };
}

export function wantedListXml(lines: { part: string; color: number; qty: number }[], bl: (c: number) => number): string {
	const items = lines
		.map(
			(l) =>
				`  <ITEM>\n    <ITEMTYPE>P</ITEMTYPE>\n    <ITEMID>${l.part}</ITEMID>\n    <COLOR>${bl(l.color)}</COLOR>\n    <MINQTY>${l.qty}</MINQTY>\n    <CONDITION>X</CONDITION>\n  </ITEM>`
		)
		.join('\n');
	return `<INVENTORY>\n${items}\n</INVENTORY>\n`;
}
