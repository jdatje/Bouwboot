// Shared brick model, used by the browser and the server.

/** z is in brick layers (a plate sits at thirds: 0, 0.3333, ...). p = 1 for a plate (a third as high). */
export type Brick = { h: number; w: number; x: number; y: number; z: number; c?: number; p?: number };

/** BrickGPT's brick library: size (short x long) → LDraw/Rebrickable/BrickLink part number. */
export const LIBRARY: Record<string, string> = {
	'1x1': '3005',
	'1x2': '3004',
	'1x4': '3010',
	'1x6': '3009',
	'1x8': '3008',
	'2x2': '3003',
	'2x4': '3001',
	'2x6': '2456'
};
/** Plates: a third of a brick high. */
export const PLATES: Record<string, string> = {
	'1x1': '3024',
	'1x2': '3023',
	'1x3': '3623',
	'1x4': '3710',
	'1x6': '3666',
	'1x8': '3460',
	'2x2': '3022',
	'2x3': '3021',
	'2x4': '3020',
	'2x6': '3795',
	'2x8': '3034'
};
/** Part number → size, for bricks only (what BrickGPT and the brick-only designs use). */
export const PART_TO_SIZE: Record<string, string> = Object.fromEntries(
	Object.entries(LIBRARY).map(([s, p]) => [p, s])
);
export const PLATE_TO_SIZE: Record<string, string> = Object.fromEntries(
	Object.entries(PLATES).map(([s, p]) => [p, s])
);
/** Size and kind of any simple part we know (brick or plate). */
export function partInfo(part: string): { size: string; plate: boolean } | null {
	if (PART_TO_SIZE[part]) return { size: PART_TO_SIZE[part], plate: false };
	if (PLATE_TO_SIZE[part]) return { size: PLATE_TO_SIZE[part], plate: true };
	return null;
}
export function partLabel(part: string, fallback?: string): string {
	const i = partInfo(part);
	return i ? `${i.plate ? 'Plaat' : 'Steen'} ${i.size}` : fallback ?? part;
}

export function sizeOf(b: Brick): string {
	return `${Math.min(b.h, b.w)}x${Math.max(b.h, b.w)}`;
}
export function partOf(b: Brick): string {
	return b.p ? PLATES[sizeOf(b)] : LIBRARY[sizeOf(b)];
}

export function parseBrick(s: string): Brick | null {
	const m = s.trim().match(/^(\d+)x(\d+) \((\d+),(\d+),(\d+)\)$/);
	if (!m) return null;
	const [h, w, x, y, z] = m.slice(1).map(Number);
	return { h, w, x, y, z };
}

export type Color = { id: number; name: string; hex: string; bl: number };

/** Common colours of basic bricks. id = Rebrickable/LDraw colour id, bl = BrickLink colour id. */
export const PALETTE: Color[] = [
	{ id: 15, name: 'Wit', hex: '#F4F4F4', bl: 1 },
	{ id: 0, name: 'Zwart', hex: '#1B2A34', bl: 11 },
	{ id: 71, name: 'Lichtgrijs', hex: '#A0A5A9', bl: 86 },
	{ id: 72, name: 'Donkergrijs', hex: '#6C6E68', bl: 85 },
	{ id: 4, name: 'Rood', hex: '#C91A09', bl: 5 },
	{ id: 320, name: 'Donkerrood', hex: '#720E0F', bl: 59 },
	{ id: 25, name: 'Oranje', hex: '#FE8A18', bl: 4 },
	{ id: 191, name: 'Lichtoranje', hex: '#F8BB3D', bl: 110 },
	{ id: 14, name: 'Geel', hex: '#F2CD37', bl: 3 },
	{ id: 27, name: 'Limoen', hex: '#BBE90B', bl: 34 },
	{ id: 10, name: 'Felgroen', hex: '#4B9F4A', bl: 36 },
	{ id: 2, name: 'Groen', hex: '#237841', bl: 6 },
	{ id: 288, name: 'Donkergroen', hex: '#184632', bl: 80 },
	{ id: 326, name: 'Olijfgroen', hex: '#9B9A5A', bl: 155 },
	{ id: 378, name: 'Zandgroen', hex: '#A0BCAC', bl: 48 },
	{ id: 322, name: 'Azuurblauw', hex: '#36AEBF', bl: 156 },
	{ id: 73, name: 'Middenblauw', hex: '#5A93DB', bl: 42 },
	{ id: 1, name: 'Blauw', hex: '#0055BF', bl: 7 },
	{ id: 272, name: 'Donkerblauw', hex: '#0A3463', bl: 63 },
	{ id: 29, name: 'Lichtroze', hex: '#E4ADC8', bl: 104 },
	{ id: 5, name: 'Donkerroze', hex: '#C870A0', bl: 47 },
	{ id: 19, name: 'Zandkleur', hex: '#E4CD9E', bl: 2 },
	{ id: 28, name: 'Donker zand', hex: '#958A73', bl: 69 },
	{ id: 92, name: 'Nougat', hex: '#D09168', bl: 28 },
	{ id: 70, name: 'Bruin', hex: '#582A12', bl: 88 },
	{ id: 308, name: 'Donkerbruin', hex: '#352100', bl: 120 }
];
export const PALETTE_BY_ID = new Map(PALETTE.map((c) => [c.id, c]));
export const DEFAULT_COLOR = 71;

export function hexToRgb(hex: string): [number, number, number] {
	const n = parseInt(hex.replace('#', ''), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Nearest palette colour (simple weighted RGB distance). */
export function nearestColor(rgb: [number, number, number], among: Color[] = PALETTE): Color {
	let best = among[0];
	let bd = Infinity;
	for (const c of among) {
		const [r, g, b] = hexToRgb(c.hex);
		const dr = r - rgb[0], dg = g - rgb[1], db = b - rgb[2];
		const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
		if (d < bd) { bd = d; best = c; }
	}
	return best;
}

export type PartCount = { part: string; color: number; qty: number };

export function countParts(bricks: Brick[]): PartCount[] {
	const m = new Map<string, PartCount>();
	for (const b of bricks) {
		const part = partOf(b);
		const color = b.c ?? DEFAULT_COLOR;
		const k = `${part}/${color}`;
		const e = m.get(k);
		if (e) e.qty++;
		else m.set(k, { part, color, qty: 1 });
	}
	return [...m.values()].sort((a, b) => b.qty - a.qty);
}

/**
 * Splits a build into instruction steps. Bricks are built layer by layer; within a layer,
 * neighbouring bricks are grouped into steps of `min`..`max` bricks.
 * Returns a list of steps, each a list of brick indices.
 */
export function makeSteps(bricks: Brick[], min: number, max: number): number[][] {
	const byLayer = new Map<number, number[]>();
	bricks.forEach((b, i) => {
		if (!byLayer.has(b.z)) byLayer.set(b.z, []);
		byLayer.get(b.z)!.push(i);
	});
	const steps: number[][] = [];
	for (const z of [...byLayer.keys()].sort((a, b) => a - b)) {
		// order the layer spatially: sweep along x, then y (snake) so a step's bricks sit together
		const idx = byLayer.get(z)!.sort((a, b) => {
			const A = bricks[a], B = bricks[b];
			const ra = Math.floor(A.x / 4), rb = Math.floor(B.x / 4);
			if (ra !== rb) return ra - rb;
			return ra % 2 === 0 ? A.y - B.y : B.y - A.y;
		});
		const n = idx.length;
		const k = Math.max(1, Math.ceil(n / max));
		const size = Math.max(Math.min(max, Math.ceil(n / k)), Math.min(min, n));
		for (let i = 0; i < n; i += size) steps.push(idx.slice(i, i + size));
		// fold a tiny last step into the previous one of the same layer if it stays within max+1
		const last = steps[steps.length - 1];
		const prev = steps[steps.length - 2];
		if (n > size && last.length < min && prev && prev.length + last.length <= max + 1 &&
			bricks[prev[0]].z === z) {
			prev.push(...last);
			steps.pop();
		}
	}
	return steps;
}
