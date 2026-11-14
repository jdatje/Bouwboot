/**
 * LDraw parts library (ldraw.org, CC BY 2.0) → triangle meshes for the browser.
 *
 * The library lives on the server (LDRAW_DIR, default DATA_DIR/ldraw, with the official library in
 * ldraw/ and the unofficial one in unofficial/). A part is parsed the first time it is asked for,
 * with low-resolution primitives (8-sided studs) to keep big builds smooth, and cached on disk.
 *
 * Output per part: triangles grouped by colour. Group colour 16 = "the part's own colour" (painted by
 * the app); any other code is a fixed colour from LDConfig (black tyres, clear glass).
 * Coordinates stay in LDraw units and axes (20 LDU = 1 stud, 8 LDU = 1 plate, -y is up).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = () => process.env.LDRAW_DIR || path.join(process.env.DATA_DIR || 'data', 'ldraw');
const CACHE = () => path.join(process.env.DATA_DIR || 'data', 'ldraw-cache');
const VERSION = 3; // bump when the output changes, so old cache files are rebuilt

export function ldrawAvailable(): boolean {
	return existsSync(path.join(ROOT(), 'ldraw', 'parts'));
}

/** Lower-case file name → full path, for every folder parts can come from. Built once. */
let index: Map<string, string> | null = null;
function fileIndex(): Map<string, string> {
	if (index) return index;
	index = new Map();
	const root = ROOT();
	// later entries win: official over unofficial, low-res (8) over normal for primitives
	const dirs: [string, string][] = [
		['unofficial/p', ''], ['unofficial/p/48', '48/'], ['unofficial/parts', ''], ['unofficial/parts/s', 's/'],
		['ldraw/p/48', '48/'], ['ldraw/p', ''], ['ldraw/parts', ''], ['ldraw/parts/s', 's/'], ['ldraw/models', '']
	];
	for (const [d, prefix] of dirs) {
		const full = path.join(root, d);
		if (!existsSync(full)) continue;
		for (const f of readdirSync(full)) if (f.toLowerCase().endsWith('.dat')) index.set(prefix + f.toLowerCase(), path.join(full, f));
	}
	// low-res primitives: "4-4cyli.dat" and "48/4-4cyli.dat" both use the 8-sided version when there is one
	for (const d of ['unofficial/p/8', 'ldraw/p/8']) {
		const full = path.join(root, d);
		if (!existsSync(full)) continue;
		for (const f of readdirSync(full)) {
			const n = f.toLowerCase();
			index.set(n, path.join(full, f));
			index.set('48/' + n, path.join(full, f));
			index.set('8/' + n, path.join(full, f));
		}
	}
	return index;
}

function resolve(name: string): string | undefined {
	const n = name.trim().toLowerCase().replace(/\\/g, '/');
	const idx = fileIndex();
	return idx.get(n) ?? idx.get(n.replace(/^parts\//, '')) ?? idx.get(n.replace(/^p\//, ''));
}

let colours: Map<number, { hex: string; alpha: number; name: string }> | null = null;
/** LDraw colour codes from LDConfig.ldr. */
export function ldrawColours() {
	if (colours) return colours;
	colours = new Map();
	const f = path.join(ROOT(), 'ldraw', 'LDConfig.ldr');
	if (existsSync(f))
		for (const line of readFileSync(f, 'utf8').split('\n')) {
			const m = line.match(/!COLOUR\s+(\S+)\s+CODE\s+(\d+)\s+VALUE\s+(#[0-9A-Fa-f]{6})(?:.*ALPHA\s+(\d+))?/);
			if (m) colours.set(Number(m[2]), { name: m[1], hex: m[3], alpha: m[4] ? Number(m[4]) / 255 : 1 });
		}
	return colours;
}

type M = number[]; // 3x4 matrix: [a b c x; d e f y; g h i z] as [a,b,c,d,e,f,g,h,i,x,y,z]
const I: M = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const mul = (p: M, c: M): M => [
	p[0] * c[0] + p[1] * c[3] + p[2] * c[6], p[0] * c[1] + p[1] * c[4] + p[2] * c[7], p[0] * c[2] + p[1] * c[5] + p[2] * c[8],
	p[3] * c[0] + p[4] * c[3] + p[5] * c[6], p[3] * c[1] + p[4] * c[4] + p[5] * c[7], p[3] * c[2] + p[4] * c[5] + p[5] * c[8],
	p[6] * c[0] + p[7] * c[3] + p[8] * c[6], p[6] * c[1] + p[7] * c[4] + p[8] * c[7], p[6] * c[2] + p[7] * c[5] + p[8] * c[8],
	p[0] * c[9] + p[1] * c[10] + p[2] * c[11] + p[9], p[3] * c[9] + p[4] * c[10] + p[5] * c[11] + p[10], p[6] * c[9] + p[7] * c[10] + p[8] * c[11] + p[11]
];
const apply = (m: M, x: number, y: number, z: number) => [
	m[0] * x + m[1] * y + m[2] * z + m[9], m[3] * x + m[4] * y + m[5] * z + m[10], m[6] * x + m[7] * y + m[8] * z + m[11]
];

const fileCache = new Map<string, string[]>();
function lines(file: string): string[] {
	let l = fileCache.get(file);
	if (!l) {
		l = readFileSync(file, 'latin1').split(/\r?\n/);
		fileCache.set(file, l);
		if (fileCache.size > 4000) fileCache.delete(fileCache.keys().next().value!);
	}
	return l;
}

export type PartMesh = {
	id: string;
	title: string;
	bbox: number[]; // minx miny minz maxx maxy maxz (LDU)
	groups: { c: number; hex?: string; alpha?: number; pos: number[] }[];
};

function build(id: string): PartMesh | null {
	const top = resolve(id.endsWith('.dat') ? id : id + '.dat');
	if (!top) return null;
	const groups = new Map<number, number[]>();
	const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
	let title = '';
	const walk = (file: string, m: M, colour: number, depth: number) => {
		if (depth > 24) return;
		for (const raw of lines(file)) {
			const t = raw.trim().split(/\s+/);
			if (!t[0] || t[0] === '0') {
				if (!title && depth === 0 && t[0] === '0' && t.length > 1) title = raw.trim().slice(2);
				continue;
			}
			const type = t[0];
			if (type === '2' || type === '5') continue; // edge lines
			let c = Number(t[1]);
			if (c === 16 || c === 24) c = colour;
			if (type === '1') {
				const n = t.slice(2, 14).map(Number);
				const child: M = [n[3], n[4], n[5], n[6], n[7], n[8], n[9], n[10], n[11], n[0], n[1], n[2]];
				const name = t.slice(14).join(' ').toLowerCase().replace(/\\/g, '/');
				// the tubes under bricks are hidden once pieces are stacked: skip them to keep big builds light
				if (HIDDEN_UNDERSIDE.has(name.replace(/^(48|8)\//, ''))) continue;
				const f = resolve(name);
				if (f) walk(f, mul(m, child), c, depth + 1);
			} else if (type === '3' || type === '4') {
				const v = t.slice(2).map(Number);
				const p = [apply(m, v[0], v[1], v[2]), apply(m, v[3], v[4], v[5]), apply(m, v[6], v[7], v[8])];
				if (type === '4') p.push(apply(m, v[9], v[10], v[11]));
				let g = groups.get(c);
				if (!g) groups.set(c, (g = []));
				const tri = (a: number[], b: number[], d: number[]) => g!.push(...a, ...b, ...d);
				tri(p[0], p[1], p[2]);
				if (p[3]) tri(p[0], p[2], p[3]);
				for (const q of p) for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], q[k]); bb[k + 3] = Math.max(bb[k + 3], q[k]); }
			}
		}
	};
	walk(top, I, 16, 0);
	if (!groups.size) return null;
	const cols = ldrawColours();
	return {
		id,
		title,
		bbox: bb.map((x) => Math.round(x * 100) / 100),
		groups: [...groups.entries()].map(([c, pos]) => ({
			c,
			...(c === 16 ? {} : { hex: cols.get(c)?.hex ?? '#888888', alpha: cols.get(c)?.alpha ?? 1 }),
			pos: pos.map((x) => Math.round(x * 100) / 100)
		}))
	};
}

const HIDDEN_UNDERSIDE = new Set(['stud3.dat', 'stud3a.dat', 'stud4.dat', 'stud4a.dat', 'stud4o.dat']);

const memo = new Map<string, PartMesh | null>();
/** Mesh for an LDraw part (file name without .dat), or null when the library doesn't have it. */
export function partMesh(id: string): PartMesh | null {
	id = id.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
	if (!id) return null;
	if (memo.has(id)) return memo.get(id)!;
	const file = path.join(CACHE(), `${id}.v${VERSION}.json`);
	let mesh: PartMesh | null = null;
	if (existsSync(file)) {
		try { mesh = JSON.parse(readFileSync(file, 'utf8')); } catch {}
	}
	if (!mesh && ldrawAvailable()) {
		mesh = build(id);
		if (mesh) {
			mkdirSync(CACHE(), { recursive: true });
			writeFileSync(file, JSON.stringify(mesh));
		}
	}
	memo.set(id, mesh);
	if (memo.size > 3000) memo.delete(memo.keys().next().value!);
	return mesh;
}
