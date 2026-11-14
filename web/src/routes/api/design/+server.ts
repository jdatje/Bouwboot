import type { RequestHandler } from './$types';
import sharp from 'sharp';
import { db, newId } from '#lib/server/db.ts';
import { createJob, streamJob } from '#lib/server/jobs.ts';
import { generate, shape } from '#lib/server/gpu.ts';
import { designProgram, directAvailable, programToBricks } from '#lib/server/direct.ts';
import { colorize, drawToy, toCaption } from '#lib/server/gemini.ts';
import { availableLibrary, fitToStock } from '#lib/server/inventory.ts';
import { piecesFromParams, sizeFor } from '#lib/size.ts';
import { PALETTE, PALETTE_BY_ID, hexToRgb, nearestColor, parseBrick, type Brick, type Color } from '#lib/bricks.ts';
import { colors as allColors } from '#lib/server/rebrickable.ts';

type Engine = 'direct' | '3d' | 'trellis' | 'brickgpt';
const DEFAULT_ENGINE: Engine = (process.env.DEFAULT_ENGINE as Engine) || 'direct';

/**
 * Streams a new design as server-sent events:
 * caption → [sketch] → brick/rollback (live) → final → colors → saved, or error.
 * Engines: 'direct' (Gemini writes a building program → bricks; default), 'trellis'/'3d' (Gemini draws →
 * 3D shape → bricks) and 'brickgpt' (text → bricks).
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	// picking up a running (or finished) job after the connection dropped
	if (body.job) {
		return streamJob(String(body.job), Number(body.from) || 0) ??
			new Response('data: ' + JSON.stringify({ type: 'error', message: 'Dit ontwerp is niet meer te vinden (de server is herstart). Probeer het nog eens.' }) + '\n\n',
				{ headers: { 'content-type': 'text/event-stream' } });
	}
	const text = String(body.prompt ?? '').trim().slice(0, 300);
	const onlyMine = !!body.onlyMine;
	const variation = Number(body.variation ?? 0) || 0;
	let engine: Engine = ['direct', 'brickgpt', '3d', 'trellis'].includes(body.engine) ? body.engine : DEFAULT_ENGINE;
	// slider value in pieces (old requests send size k/m/g)
	const size = sizeFor(body.pieces ? Number(body.pieces) : piecesFromParams(new URLSearchParams({ g: String(body.size ?? '') })));
	const withAssembled = !!body.withAssembled;
	// the job runs on, even when the browser goes away; it only stops when it takes far too long
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), 10 * 60_000);
	const jobId = newId();
	const { send, finish } = createJob(jobId);

	(async () => {
			try {
				if (!text) throw new Error('Typ eerst wat je wilt bouwen');
				let allowed: string[] | null = null;
				let palette: Color[] = PALETTE;
				let maxBricks: number = size.pieces;
				const all = await allColors();
				const col = (id: number) => PALETTE_BY_ID.get(id) ?? all.get(id);
				if (onlyMine) {
					const lib = availableLibrary(withAssembled);
					allowed = [...lib.keys()];
					if (!allowed.length) throw new Error('Er zijn nu geen losse stenen beschikbaar (2x4, 1x2, ...). Voeg sets of een scan toe, of haal een bouwwerk uit elkaar.');
					const owned = new Set([...lib.values()].flatMap((m) => [...m.keys()]));
					palette = [...owned].map(col).filter(Boolean) as Color[];
					maxBricks = Math.min(size.pieces, [...lib.values()].reduce((a, m) => a + [...m.values()].reduce((x, y) => x + y, 0), 0));
				}

				let bricks: Brick[] = [];
				let caption = '';
				let title = '';
				let sketch: string | null = null;
				const seed = Math.floor(Math.random() * 1e9);

				// the brick step of 'direct' needs Python on this server; without it use the drawing route
				if (engine === 'direct' && !(await directAvailable())) engine = 'trellis';
				send({ type: 'engine', engine });

				if (engine === 'direct') {
					let shaped: Awaited<ReturnType<typeof programToBricks>> = [];
					for (let attempt = 0; attempt < 2 && shaped.length < 10; attempt++) {
						const prog = await designProgram(text, sizeFor(maxBricks).studs, maxBricks, variation + attempt * 7, onlyMine ? palette.map((c) => c.id) : undefined);
						title = String(prog.title ?? text).slice(0, 60);
						caption = String(prog.plan ?? '').slice(0, 500);
						// the slider is a wish: Gemini may choose fewer pieces when the subject suits that better
						let target = maxBricks;
						const best = Number(prog.pieces);
						if (best >= 60 && best < maxBricks * 0.85) {
							target = Math.round(best);
							const note = String(prog.size_note ?? '').trim();
							caption = '📏 ' + (note || `Kleiner gemaakt: ongeveer ${target} onderdelen past beter bij dit bouwwerk.`);
						}
						send({ type: 'caption', caption, title });
						shaped = await programToBricks(prog, allowed, target);
					}
					if (shaped.length < 3) throw new Error('Dit ontwerp lukte niet. Probeer het nog eens of omschrijf het anders.');
					const delay = Math.max(4, Math.min(25, 3000 / shaped.length));
					for (const b of shaped) {
						const { c, ...shapeOnly } = b;
						send({ type: 'brick', o: shapeOnly });
						await new Promise((r) => setTimeout(r, delay));
					}
					bricks = shaped.map((b) => ({ ...b }));
					send({ type: 'final', bricks: bricks.map(({ c, ...r }) => r) });
				} else if (engine === '3d' || engine === 'trellis') {
					// translate first: the drawing model reads "boot" as an English shoe
					const cap = await toCaption(text, 0);
					caption = cap.caption;
					title = cap.title;
					send({ type: 'caption', caption, title });
					let shaped: Awaited<ReturnType<typeof shape>> = [];
					// a drawing sometimes doesn't turn into a usable 3D shape; then draw again once
					for (let attempt = 0; attempt < 2 && shaped.length < 25; attempt++) {
						const img = await drawToy(cap.subject || text, variation + attempt * 7, size.studs);
						const small = await sharp(Buffer.from(img.data, 'base64')).resize(320, 320, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
						sketch = 'data:image/jpeg;base64,' + small.toString('base64');
						send({ type: 'sketch', image: sketch });
						shaped = await shape(img.data, palette.map((c) => ({ id: c.id, hex: c.hex })), allowed, abort.signal, maxBricks,
							engine === 'trellis' ? 'trellis' : 'tripo', true, size);
					}
					if (shaped.length < 3) throw new Error('Van deze tekening kon ik geen bouwwerk maken. Probeer het nog eens.');
					// stream the bricks layer by layer so the build animation still plays
					const delay = Math.max(4, Math.min(25, 3000 / shaped.length));
					for (const b of shaped) {
						const { c, ...shapeOnly } = b;
						send({ type: 'brick', o: shapeOnly });
						await new Promise((r) => setTimeout(r, delay));
					}
					bricks = shaped.map((b) => ({ ...b }));
					send({ type: 'final', bricks: bricks.map(({ c, ...r }) => r) });
				} else {
					if (allowed) allowed = allowed.filter((a) => /^\d+x\d+$/.test(a)); // BrickGPT only knows bricks
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
					}, withAssembled);
				send({ type: 'colors', colors: bricks.map((b) => b.c) });

				const id = newId();
				db.prepare(
					'INSERT INTO builds (id, prompt, title, caption, seed, only_mine, bricks, created_at, engine, sketch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
				).run(id, text, title, caption, seed, onlyMine ? 1 : 0, JSON.stringify(bricks), Date.now(), engine, sketch);
				send({ type: 'saved', id });
			} catch (e: any) {
				if (!abort.signal.aborted) {
					let msg = e?.message ?? String(e);
					if (/terminated|fetch failed|ECONNRESET|socket/i.test(msg)) msg = 'De verbinding met de bouwer viel weg. Probeer het nog eens.';
					send({ type: 'error', message: msg });
				} else send({ type: 'error', message: 'Het ontwerpen duurde te lang. Probeer het nog eens.' });
			}
			clearTimeout(timer);
			finish();
	})();
	return streamJob(jobId, 0)!;
};
