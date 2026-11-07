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
