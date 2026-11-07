import sharp from 'sharp';
import { detectBricks } from './gemini';
import { LIBRARY, PALETTE, nearestColor } from '#lib/bricks.ts';

export type ScanItem = {
	crop: string; // data URL
	part: string;
	partName: string;
	color: number;
	confidence: 'hoog' | 'laag';
	note?: string;
};

async function brickognize(jpeg: Buffer): Promise<{ id: string; name: string; score: number } | null> {
	try {
		const fd = new FormData();
		fd.append('query_image', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'brick.jpg');
		const res = await fetch('https://api.brickognize.com/predict/parts/', { method: 'POST', body: fd });
		if (!res.ok) return null;
		const j = await res.json();
		const top = j.items?.[0];
		return top ? { id: String(top.id), name: top.name, score: Number(top.score ?? 0) } : null;
	} catch {
		return null;
	}
}

/** Median colour of the brick in the middle of a crop, ignoring the light background. */
async function sampleColor(crop: Buffer): Promise<[number, number, number] | null> {
	const { data, info } = await sharp(crop).resize(48, 48, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	const px: [number, number, number][] = [];
	for (let y = 12; y < 36; y++)
		for (let x = 12; x < 36; x++) {
			const i = (y * info.width + x) * 3;
			px.push([data[i], data[i + 1], data[i + 2]]);
		}
	if (!px.length) return null;
	const med = (k: 0 | 1 | 2) => px.map((p) => p[k]).sort((a, b) => a - b)[px.length >> 1];
	return [med(0), med(1), med(2)];
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: n }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i], i);
			}
		})
	);
	return out;
}

/** Photo of spread-out bricks → one review item per brick. */
export async function scanPhoto(input: Buffer): Promise<ScanItem[]> {
	const img = sharp(input).rotate(); // respect phone orientation
	const full = await img.clone().resize(2400, 2400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
	const meta = await sharp(full).metadata();
	const W = meta.width!, H = meta.height!;
	const small = await sharp(full).resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
	const dets = await detectBricks(small.toString('base64'));

	return pool(dets.slice(0, 80), 4, async (d) => {
		const [y0, x0, y1, x1] = d.box.map((v) => Math.max(0, Math.min(1000, v)) / 1000);
		const pw = (x1 - x0) * 0.12, ph = (y1 - y0) * 0.12;
		const left = Math.max(0, Math.floor((x0 - pw) * W));
		const top = Math.max(0, Math.floor((y0 - ph) * H));
		const width = Math.max(8, Math.min(W - left, Math.ceil((x1 - x0 + 2 * pw) * W)));
		const height = Math.max(8, Math.min(H - top, Math.ceil((y1 - y0 + 2 * ph) * H)));
		const crop = await sharp(full).extract({ left, top, width, height }).resize(320, 320, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();

		const [bk, rgb] = await Promise.all([brickognize(crop), sampleColor(crop)]);
		const sizeNorm = d.size.replace(/\s/g, '').toLowerCase().split('x').map(Number).sort((a, b) => a - b).join('x');
		const geminiPart = LIBRARY[sizeNorm];
		const geminiColor = PALETTE.find((c) => c.name.toLowerCase() === d.color.toLowerCase());
		const pixColor = rgb ? nearestColor(rgb) : null;

		let part = bk && bk.score >= 0.5 ? bk.id : geminiPart ?? bk?.id ?? '3001';
		let partName = bk && part === bk.id ? bk.name : `Steen ${sizeNorm}`;
		const notes: string[] = [];
		let sure = true;
		if (!bk || bk.score < 0.5) { sure = false; notes.push('vorm onzeker'); }
		if (geminiPart && bk && geminiPart !== bk.id) { sure = false; notes.push(`of ${sizeNorm}?`); }
		const color = (geminiColor ?? pixColor ?? PALETTE[2]).id;
		if (geminiColor && pixColor && geminiColor.id !== pixColor.id) { sure = false; notes.push(`of ${pixColor.name}?`); }

		return {
			crop: 'data:image/jpeg;base64,' + crop.toString('base64'),
			part,
			partName,
			color,
			confidence: sure ? 'hoog' : 'laag',
			note: notes.join(', ') || undefined
		} satisfies ScanItem;
	});
}
