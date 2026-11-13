import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { gemini } from '#lib/server/gemini.ts';
import { stockSummary } from '#lib/server/inventory.ts';
import { COLOR_NAMES } from '#lib/server/direct.ts';
import { PALETTE_BY_ID } from '#lib/bricks.ts';
import { clampPieces } from '#lib/size.ts';

/** GET: how much is in stock (for the slider's maximum). */
export const GET: RequestHandler = async ({ url }) => {
	const s = stockSummary(url.searchParams.get('ib') === '1');
	return json({ total: s.total });
};

/** POST {pieces, withAssembled}: three ideas Gemini thinks fit the bricks we have. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const withAssembled = !!body.withAssembled;
	const s = stockSummary(withAssembled);
	if (s.total < 20) return json({ total: s.total, ideas: [] });
	const pieces = Math.min(clampPieces(Number(body.pieces) || 200), s.total);
	const name = (id: number) => COLOR_NAMES.find(([, i]) => i === id)?.[0] ?? PALETTE_BY_ID.get(id)?.name ?? `colour ${id}`;
	const colors = [...s.byColor.entries()].sort((a, b) => b[1] - a[1]).map(([c, q]) => `${name(c)} ${q}`).join(', ');
	const kinds = [...s.byKind.entries()].map(([k, q]) => `${q} ${k}`).join(', ');
	const avoid = Array.isArray(body.avoid) ? body.avoid.slice(0, 12).join(', ') : '';
	const res = await gemini<{ ideas: { title: string; prompt: string; why: string }[] }>(
		[{
			text: `A child wants to build something from the LEGO pieces the family has at home.
Available: ${s.total} pieces (${kinds}). By colour: ${colors}.
The model will use about ${pieces} pieces.
Suggest 3 different things to build that suit THESE colours and amounts well (for example lots of red and
grey suggests a fire engine or a castle; lots of green suggests a crocodile or a tree). Fun for kids,
recognisable, and simple enough for blocky bricks. Mix categories (vehicle, animal, building, other).
${avoid ? `Do not suggest these again: ${avoid}.` : ''}
Write in Dutch: "title" 1-4 words; "prompt" one short sentence describing what to build and its main colours
(it goes straight into the designer); "why" one short sentence for the child on why it fits their bricks.`
		}],
		{
			type: 'object',
			properties: {
				ideas: {
					type: 'array',
					items: { type: 'object', properties: { title: { type: 'string' }, prompt: { type: 'string' }, why: { type: 'string' } }, required: ['title', 'prompt', 'why'] }
				}
			},
			required: ['ideas']
		},
		1.0
	);
	return json({ total: s.total, pieces, ideas: (res.ideas ?? []).slice(0, 3) });
};
