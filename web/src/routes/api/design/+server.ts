import type { RequestHandler } from './$types';
import sharp from 'sharp';
import { db, newId } from '#lib/server/db.ts';
import { generate, shape } from '#lib/server/gpu.ts';
import { colorize, drawToy, toCaption } from '#lib/server/gemini.ts';
import { availableLibrary, fitToStock } from '#lib/server/inventory.ts';
import { PALETTE, PALETTE_BY_ID, hexToRgb, nearestColor, parseBrick, type Brick, type Color } from '#lib/bricks.ts';
import { colors as allColors } from '#lib/server/rebrickable.ts';

type Engine = '3d' | 'brickgpt';
const DEFAULT_ENGINE: Engine = (process.env.DEFAULT_ENGINE as Engine) || '3d';

/**
 * Streams a new design as server-sent events:
 * caption → [sketch] → brick/rollback (live) → final → colors → saved, or error.
 * Two engines: '3d' (Gemini draws a toy → TripoSR 3D shape → bricks) and 'brickgpt' (text → bricks).
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const text = String(body.prompt ?? '').trim().slice(0, 300);
	const onlyMine = !!body.onlyMine;
	const variation = Number(body.variation ?? 0) || 0;
	const engine: Engine = body.engine === 'brickgpt' || body.engine === '3d' ? body.engine : DEFAULT_ENGINE;
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
				const all = await allColors();
				const col = (id: number) => PALETTE_BY_ID.get(id) ?? all.get(id);
				if (onlyMine) {
					const lib = availableLibrary();
					allowed = [...lib.keys()];
					if (!allowed.length) throw new Error('Je magazijn heeft nog geen losse stenen (2x4, 1x2, ...). Voeg eerst sets of een scan toe.');
					const owned = new Set([...lib.values()].flatMap((m) => [...m.keys()]));
					palette = [...owned].map(col).filter(Boolean) as Color[];
				}

				let bricks: Brick[] = [];
				let caption = '';
				let title = '';
				let sketch: string | null = null;
				const seed = Math.floor(Math.random() * 1e9);

				if (engine === '3d') {
					const [cap, img] = await Promise.all([toCaption(text, 0), drawToy(text, variation)]);
					caption = cap.caption;
					title = cap.title;
					send({ type: 'caption', caption, title });
					const small = await sharp(Buffer.from(img.data, 'base64')).resize(320, 320, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
					sketch = 'data:image/jpeg;base64,' + small.toString('base64');
					send({ type: 'sketch', image: sketch });
					const shaped = await shape(img.data, palette.map((c) => ({ id: c.id, hex: c.hex })), allowed, abort.signal);
					if (shaped.length < 3) throw new Error('Van deze tekening kon ik geen bouwwerk maken. Probeer het nog eens.');
					// stream the bricks layer by layer so the build animation still plays
					const delay = Math.max(8, Math.min(60, 9000 / shaped.length));
					for (const b of shaped) {
						send({ type: 'brick', b: `${b.h}x${b.w} (${b.x},${b.y},${b.z})` });
						await new Promise((r) => setTimeout(r, delay));
					}
					bricks = shaped.map((b) => ({ ...b }));
					send({ type: 'final', bricks: bricks.map(({ c, ...r }) => r) });
				} else {
					const cap = await toCaption(text, variation);
					caption = cap.caption;
					title = cap.title;
					send({ type: 'caption', caption, title });
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
				}

				if (onlyMine)
					fitToStock(bricks, (_s, wanted, options) => {
						const w = col(wanted);
						const opts = options.map(col).filter(Boolean) as Color[];
						return w && opts.length ? nearestColor(hexToRgb(w.hex), opts).id : options[0];
					});
				send({ type: 'colors', colors: bricks.map((b) => b.c) });

				const id = newId();
				db.prepare(
					'INSERT INTO builds (id, prompt, title, caption, seed, only_mine, bricks, created_at, engine, sketch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
				).run(id, text, title, caption, seed, onlyMine ? 1 : 0, JSON.stringify(bricks), Date.now(), engine, sketch);
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
