/**
 * All special pieces the designer knows: hand-made ones (specials.json, with exact rules) and the
 * automatically taught ones (specials-auto.json, compact: one row per part, learned from its LDraw shape).
 */
import HAND from '#lib/specials.json';
import AUTO from '#lib/specials-auto.json';

export type Special = {
	name: string;
	group: number;
	foot: [number, number, number];
	r0?: number;
	slope?: boolean;
	center?: [number, number];
	cal?: string;
	auto?: string;
	use?: string;
	cat?: string;
	qty?: number;
	ldraw: { f: string; c: 'main' | number; at?: [number, number, number]; ry?: number; rx?: number }[];
	buy: { p: string; c: 'main' | number; q: number }[];
};

const DIR_TEXT: Record<string, string> = {
	face: 'dir = the side it faces / sticks out',
	slope: 'dir = the low side',
	long: 'dir = "x" or "y" (the long side)'
};

export const SPECIALS: Record<string, Special> = {};
for (const [k, v] of Object.entries(HAND)) if (!k.startsWith('_')) SPECIALS[k] = v as unknown as Special;
// row: [name, category, how often in sets, length, width, height (plates), r0, centre x, centre z, direction kind, LDraw file if different]
for (const [part, r] of Object.entries(AUTO as Record<string, (string | number)[]>)) {
	const [name, cat, qty, l, w, h, r0, cx, cz, cal, file] = r as [string, string, number, number, number, number, number, number, number, string, string?];
	SPECIALS['p_' + part] = {
		name, group: 7, cat, qty, foot: [l, w, h], r0, center: [cx, cz], ...(cal ? { cal } : {}),
		use: name + (DIR_TEXT[cal] ? ` (${DIR_TEXT[cal]})` : ''),
		ldraw: [{ f: file ?? part, c: 'main' }],
		buy: [{ p: part, c: 'main', q: 1 }]
	};
}
