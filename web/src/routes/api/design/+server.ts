import type { RequestHandler } from './$types';
import { db, newId } from '#lib/server/db.ts';
import { generate } from '#lib/server/gpu.ts';
import { colorize, toCaption } from '#lib/server/gemini.ts';
import { availableLibrary, fitToStock } from '#lib/server/inventory.ts';
import { PALETTE, PALETTE_BY_ID, hexToRgb, nearestColor, parseBrick, type Brick, type Color } from '#lib/bricks.ts';
import { colors as allColors } from '#lib/server/rebrickable.ts';

/**
 * Streams a new design as server-sent events:
 * caption → brick/rollback (live) → colors → saved, or error.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { prompt, onlyMine = false, variation = 0 } = await request.json();
	const text = String(prompt ?? '').trim().slice(0, 300);
	const enc = new TextEncoder();
	const abort = new AbortController();
	request.signal.addEventListener('abort', () => abort.abort());

	const stream = new ReadableStream({
		async start(ctrl) {
			const send = (o: object) => {
				try { ctrl.enqueue(enc.encode('data: ' + JSON.stringify(o) + '\n\n')); } catch {}
			};
			try {
				if (!text) throw new Error('Typ eerst wat je wilt bouwen');
				let allowed: string[] | null = null;
				let palette: Color[] = PALETTE;
				if (onlyMine) {
					const lib = availableLibrary();
					allowed = [...lib.keys()];
					if (!allowed.length) throw new Error('Je magazijn heeft nog geen losse stenen (2x4, 1x2, ...). Voeg eerst sets of een scan toe.');
					const owned = new Set([...lib.values()].flatMap((m) => [...m.keys()]));
					const all = await allColors();
					palette = [...owned].map((id) => PALETTE_BY_ID.get(id) ?? all.get(id)).filter(Boolean) as Color[];
				}
				const { caption, title } = await toCaption(text, variation);
				send({ type: 'caption', caption, title });

				const seed = Math.floor(Math.random() * 1e9);
				let bricks: Brick[] = [];
				for await (const ev of generate(caption, seed, allowed, abort.signal)) {
					if (ev.type === 'brick' || ev.type === 'rollback') send(ev);
					if (ev.type === 'error') throw new Error('Het ontwerpen ging mis: ' + ev.message);
					if (ev.type === 'done') bricks = ev.bricks.map(parseBrick).filter(Boolean) as Brick[];
				}
				if (bricks.length < 3) throw new Error('Het model kwam niet tot een bouwwerk. Probeer het nog eens of omschrijf het anders.');
				send({ type: 'final', bricks });

				let cols: number[];
				try {
					cols = await colorize(text, caption, bricks, palette);
				} catch {
					cols = bricks.map(() => palette[0].id);
				}
				bricks.forEach((b, i) => (b.c = cols[i]));
				if (onlyMine) {
					const all = await allColors();
					const col = (id: number) => PALETTE_BY_ID.get(id) ?? all.get(id);
					fitToStock(bricks, (_s, wanted, options) => {
						const w = col(wanted);
						const opts = options.map(col).filter(Boolean) as Color[];
						return w && opts.length ? nearestColor(hexToRgb(w.hex), opts).id : options[0];
					});
				}
				send({ type: 'colors', colors: bricks.map((b) => b.c) });

				const id = newId();
				db.prepare(
					'INSERT INTO builds (id, prompt, title, caption, seed, only_mine, bricks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
				).run(id, text, title, caption, seed, onlyMine ? 1 : 0, JSON.stringify(bricks), Date.now());
				send({ type: 'saved', id });
			} catch (e: any) {
				if (!abort.signal.aborted) send({ type: 'error', message: e?.message ?? String(e) });
			}
			try { ctrl.close(); } catch {}
		},
		cancel() {
			abort.abort();
		}
	});
	return new Response(stream, {
		headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' }
	});
};
