// Shared brick model, used by the browser and the server.

/**
 * z is in brick layers (a plate sits at thirds: 0, 0.3333, ...). p = 1 for a plate (a third as high).
 * k = special kind: 's45' / 's33' slope (d = downhill direction: 0 +x, 1 -x, 2 +y, 3 -y) or 't' tile.
 */
/** s = special piece from specials.json (wheels, windows, round pieces, arches, curved slopes); d = direction. */
import SPECIALS_JSON from '#lib/specials.json';
type SpecialData = { name: string; buy: { p: string; c: 'main' | number; q: number }[] };
const SPECIALS_DATA = Object.fromEntries(Object.entries(SPECIALS_JSON).filter(([k]) => !k.startsWith('_'))) as unknown as Record<string, SpecialData>;
/** The part a special piece is listed under (its first "buy" part), and all buyable special parts → name. */
const SPECIAL_MAIN: Record<string, string> = Object.fromEntries(Object.entries(SPECIALS_DATA).map(([k, v]) => [k, v.buy[0].p]));
export const SPECIAL_PART_NAMES: Record<string, string> = Object.fromEntries(
	Object.values(SPECIALS_DATA).flatMap((v) => v.buy.map((x, i) => [x.p, i === 0 ? v.name : v.name + ' (onderdeel)']))
);
export const SPECIAL_NAME = (id: string) => SPECIALS_DATA[id]?.name ?? id;

export type Brick = { h: number; w: number; x: number; y: number; z: number; c?: number; p?: number; k?: 's45' | 's33' | 't'; d?: number; s?: string };

/** BrickGPT's brick library: size (short x long) → LDraw/Rebrickable/BrickLink part number. */
export const LIBRARY: Record<string, string> = {
	'1x1': '3005',
	'1x2': '3004',
	'1x3': '3622',
	'1x4': '3010',
	'1x6': '3009',
	'1x8': '3008',
	'1x10': '6111',
	'1x12': '6112',
	'2x2': '3003',
	'2x3': '3002',
	'2x4': '3001',
	'2x6': '2456',
	'2x8': '3007',
	'2x10': '3006'
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
	'2x8': '3034',
	'2x10': '3832',
	'4x4': '3031',
	'4x6': '3032',
	'4x8': '3035',
	'6x6': '3958',
	'6x8': '3036'
};
/** Slopes, keyed by width x depth (sorted): 45° are 2 deep, 33° are 3 deep. */
export const SLOPES45: Record<string, string> = { '1x2': '3040', '2x2': '3039', '2x4': '3037' };
export const SLOPES33: Record<string, string> = { '1x3': '4286', '2x3': '3298' };
/** Tiles: smooth plates without studs. */
export const TILES: Record<string, string> = {
	'1x1': '3070',
	'1x2': '3069',
	'1x3': '63864',
	'1x4': '2431',
	'1x6': '6636',
	'1x8': '4162',
	'2x2': '3068',
	'2x4': '87079'
};
/** Part number → size, for bricks only (what BrickGPT and the brick-only designs use). */
export const PART_TO_SIZE: Record<string, string> = Object.fromEntries(
	Object.entries(LIBRARY).map(([s, p]) => [p, s])
);
export const PLATE_TO_SIZE: Record<string, string> = Object.fromEntries(
	Object.entries(PLATES).map(([s, p]) => [p, s])
);
export type PartKind = 'brick' | 'plate' | 's45' | 's33' | 'tile';
const KINDS: [PartKind, Record<string, string>][] = [
	['brick', LIBRARY], ['plate', PLATES], ['s45', SLOPES45], ['s33', SLOPES33], ['tile', TILES]
];
/** Other numbers for the same part (newer/older moulds, Rebrickable numbering) → the number we use. */
export const PART_ALIASES: Record<string, string> = {
	'3069b': '3069', '3069a': '3069', '3070b': '3070', '3070a': '3070', '3068b': '3068', '3068a': '3068',
	'3040b': '3040', '3040a': '3040', '3039a': '3039', '3001a': '3001', '3003a': '3003', '3004a': '3004',
	'6141': '4073', '4032a': '4032', '4032b': '4032', '3747a': '3747b', '3062a': '3062b', '3665a': '3665', '3665b': '3665',
	'3660a': '3660', '3660b': '3660', '3942a': '3942c', '3942b': '3942c', '6014a': '6014b', '2431a': '2431', '4162a': '4162'
};
export const canonPart = (p: string) => PART_ALIASES[p] ?? p;
const PART_INDEX = new Map<string, { size: string; kind: PartKind }>();
for (const [kind, table] of KINDS) for (const [size, part] of Object.entries(table)) PART_INDEX.set(part, { size, kind });
/** Size and kind of any simple part we know. `plate` = a third of a brick high (plates and tiles). */
export function partInfo(part: string): { size: string; plate: boolean; kind: PartKind } | null {
	const i = PART_INDEX.get(canonPart(part));
	return i ? { ...i, plate: i.kind === 'plate' || i.kind === 'tile' } : null;
}
const KIND_LABEL: Record<PartKind, string> = { brick: 'Steen', plate: 'Plaat', s45: 'Dakpan 45°', s33: 'Dakpan 33°', tile: 'Tegel' };
export function partLabel(part: string, fallback?: string): string {
	const i = partInfo(part);
	return i ? `${KIND_LABEL[i.kind]} ${i.size}` : SPECIAL_PART_NAMES[canonPart(part)] ?? fallback ?? part;
}
/** Key used for "which sizes do we own": '2x4' brick, 'p2x4' plate, 's452x2' slope, 't1x2' tile. */
export function stockKey(part: string): string | null {
	const i = partInfo(part);
	if (!i) return SPECIAL_PART_NAMES[canonPart(part)] ? 'x' + canonPart(part) : null;
	return ({ brick: '', plate: 'p', s45: 's45', s33: 's33', tile: 't' } as const)[i.kind] + i.size;
}

export function sizeOf(b: Brick): string {
	return `${Math.min(b.h, b.w)}x${Math.max(b.h, b.w)}`;
}
export function partOf(b: Brick): string {
	if (b.s) return SPECIAL_MAIN[b.s] ?? b.s;
	const size = sizeOf(b);
	if (b.k === 's45') return SLOPES45[size];
	if (b.k === 's33') return SLOPES33[size];
	if (b.k === 't') return TILES[size];
	return b.p ? PLATES[size] : LIBRARY[size];
}

export function parseBrick(s: string): Brick | null {
	const m = s.trim().match(/^(\d+)x(\d+) \((\d+),(\d+),(\d+)\)$/);
	if (!m) return null;
	const [h, w, x, y, z] = m.slice(1).map(Number);
	return { h, w, x, y, z };
}

export type Color = { id: number; name: string; hex: string; bl: number; trans?: boolean };

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
	{ id: 308, name: 'Donkerbruin', hex: '#352100', bl: 120 },
	// transparent (lamps, headlights, windows)
	{ id: 47, name: 'Doorzichtig', hex: '#FCFCFC', bl: 12, trans: true },
	{ id: 36, name: 'Doorzichtig rood', hex: '#D9261A', bl: 17, trans: true },
	{ id: 46, name: 'Doorzichtig geel', hex: '#F5CD2F', bl: 19, trans: true },
	{ id: 57, name: 'Doorzichtig oranje', hex: '#FF800D', bl: 18, trans: true },
	{ id: 41, name: 'Doorzichtig lichtblauw', hex: '#AEEFEC', bl: 15, trans: true },
	{ id: 33, name: 'Doorzichtig blauw', hex: '#0020A0', bl: 14, trans: true },
	{ id: 34, name: 'Doorzichtig groen', hex: '#84B68D', bl: 20, trans: true }
];
export const PALETTE_BY_ID = new Map(PALETTE.map((c) => [c.id, c]));
/** Colours for ordinary painting (no transparent ones). */
export const SOLID_PALETTE = PALETTE.filter((c) => !c.trans);
export const TRANS_HEX = new Set(PALETTE.filter((c) => c.trans).map((c) => c.hex.toUpperCase()));
export const DEFAULT_COLOR = 71;

export function hexToRgb(hex: string): [number, number, number] {
	const n = parseInt(hex.replace('#', ''), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Nearest palette colour (simple weighted RGB distance). */
export function nearestColor(rgb: [number, number, number], among: Color[] = SOLID_PALETTE): Color {
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
	const add = (part: string, color: number, qty: number) => {
		const k = `${part}/${color}`;
		const e = m.get(k);
		if (e) e.qty += qty;
		else m.set(k, { part, color, qty });
	};
	for (const b of bricks) {
		const color = b.c ?? DEFAULT_COLOR;
		const sp = b.s ? SPECIALS_DATA[b.s] : null;
		if (sp) for (const x of sp.buy) add(x.p, x.c === 'main' ? color : x.c, x.q);
		else add(partOf(b), color, 1);
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
