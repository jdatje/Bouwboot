import crypto from 'node:crypto';

export type GpuEvent =
	| { type: 'start' }
	| { type: 'brick'; b: string }
	| { type: 'rollback'; keep: number }
	| { type: 'done'; bricks: string[] }
	| { type: 'error'; message: string };

function gpuKey(): string {
	if (process.env.BOUWBOOT_GPU_KEY) return process.env.BOUWBOOT_GPU_KEY;
	const s = process.env.MODAL_TOKEN_SECRET;
	if (!s) throw new Error('MODAL_TOKEN_SECRET ontbreekt');
	return crypto.createHash('sha256').update('bouwboot:' + s).digest('hex');
}

const URL = () =>
	(process.env.GPU_URL || 'https://jdatje--bouwboot-gpu-designer-web.us-east.modal.run').replace(/\/$/, '');

/** Streams BrickGPT events from the Modal GPU service. */
export async function* generate(
	caption: string,
	seed: number,
	allowed: string[] | null,
	signal?: AbortSignal
): AsyncGenerator<GpuEvent> {
	if (process.env.MOCK_GPU) {
		// local development without GPU: a small fixed model, streamed slowly
		yield { type: 'start' };
		const out: string[] = [];
		const rnd = (n: number) => Math.floor(((Math.sin(seed + out.length * 7.1) + 1) / 2) * n);
		for (let z = 0; z < 6; z++)
			for (let x = 4; x < 16; x += 2)
				for (let y = 6; y < 14; y += 4) {
					if (z > 2 && (x < 6 || x > 12)) continue;
					const b = z % 2 ? `2x4 (${x},${y},${z})` : `2x2 (${x},${y + (rnd(2) ? 0 : 2)},${z})`;
					out.push(b);
					yield { type: 'brick', b };
					await new Promise((r) => setTimeout(r, 25));
				}
		yield { type: 'done', bricks: out };
		return;
	}
	const res = await fetch(URL() + '/generate', {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${gpuKey()}` },
		body: JSON.stringify({ caption, seed, allowed, max_bricks: 400 }),
		signal
	});
	if (!res.ok || !res.body) throw new Error(`GPU ${res.status}: ${await res.text()}`);
	const reader = res.body.getReader();
	const dec = new TextDecoder();
	let buf = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += dec.decode(value, { stream: true });
		let i;
		while ((i = buf.indexOf('\n\n')) >= 0) {
			const chunk = buf.slice(0, i);
			buf = buf.slice(i + 2);
			for (const line of chunk.split('\n'))
				if (line.startsWith('data: ')) yield JSON.parse(line.slice(6)) as GpuEvent;
		}
	}
}

const URL3D = () =>
	(process.env.GPU_URL_3D || URL().replace('-designer-web', '-shaper-web')).replace(/\/$/, '');

export type ShapeBrick = { h: number; w: number; x: number; y: number; z: number; c: number; p?: number };
const URLTR = () =>
	(process.env.GPU_URL_TRELLIS || URL().replace('-designer-web', '-trellis-web')).replace(/\/$/, '');

/** Picture → 3D shape → coloured bricks (TripoSR on Modal). */
export async function shape(
	imageB64: string,
	palette: { id: number; hex: string }[],
	sizes: string[] | null,
	signal?: AbortSignal,
	maxBricks = 450,
	engine: 'tripo' | 'trellis' = 'tripo',
	plates = true
): Promise<ShapeBrick[]> {
	if (process.env.MOCK_GPU) {
		const out: ShapeBrick[] = [];
		for (let z = 0; z < 5; z++)
			for (let x = 0; x < 16; x += 4)
				for (let y = 0; y < 6; y += 2) out.push({ h: 4, w: 2, x: x + (z % 2) * 2 > 12 ? x : x + (z % 2) * 2, y, z, c: palette[(x + z) % palette.length].id });
		if (plates)
			for (let k = 0; k < 3; k++)
				for (let x = 2 + k * 2; x < 14 - k * 2; x += 2)
					out.push({ h: 2, w: 2, x, y: 2, z: Math.round((5 + k / 3) * 10000) / 10000, c: palette[0].id, p: 1 });
		return out;
	}
	const res = await fetch((engine === 'trellis' ? URLTR() : URL3D()) + '/shape', {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${gpuKey()}` },
		body: JSON.stringify({ image: imageB64, palette, sizes, plates, max_bricks: Math.max(20, Math.floor(maxBricks)) }),
		signal
	});
	if (!res.ok) throw new Error(`3D ${res.status}: ${(await res.text()).slice(0, 200)}`);
	return (await res.json()).bricks;
}

let lastWarm = 0;
/** Wakes the GPU containers (cold start takes a while) as soon as someone opens the site. */
export function warmUp() {
	if (process.env.MOCK_GPU || Date.now() - lastWarm < 120_000) return;
	lastWarm = Date.now();
	const h = { authorization: `Bearer ${gpuKey()}` };
	fetch(URL3D() + '/health', { headers: h }).catch(() => {});
	fetch(URLTR() + '/health', { headers: h }).catch(() => {});
}
