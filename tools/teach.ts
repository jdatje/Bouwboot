/**
 * Teach parts to the designer automatically, from their LDraw shape.
 *
 *   cd web && LDRAW_DIR=... DATA_DIR=... npx tsx ../tools/teach.ts parts.json [max]
 *
 * parts.json: [{ part, name, cat, qty }, ...] in the order to teach (most used first).
 * For each part: footprint from its studs (or its outline when it has none), height from its shape,
 * direction from its side studs / what sticks out / its slope, and a description from its name.
 * Writes the entries into web/src/lib/specials.json as "p_<part>" (op "piece" for the designer).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { partMesh } from '../web/src/lib/server/ldraw.ts';

const SPEC = '../web/src/lib/specials.json';
const data = JSON.parse(readFileSync(SPEC, 'utf8'));
const list: { part: string; name: string; cat: string; qty: number }[] = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const max = Number(process.argv[3] ?? 100);
const group = Number(process.env.GROUP ?? 7);

// part numbers the designer already knows in another way
const known = new Set<string>();
for (const [k, v] of Object.entries<any>(data)) if (!k.startsWith('_')) for (const b of v.buy) known.add(b.p);

// scene coords: x, -y, -z (LDraw -y is up). rotateY(θ) as three.js: x' = x cos + z sin, z' = -x sin + z cos
const rot = (x: number, z: number, r: number) => {
	const a = (r * Math.PI) / 2, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
	return [x * c + z * s, -x * s + z * c];
};
/** quarter turns that bring LDraw direction (dx, dz) to scene +x */
const turnTo = (dx: number, dz: number) => {
	for (let r = 0; r < 4; r++) {
		const [x, z] = rot(dx, -dz, r);
		if (x > 0.7 && Math.abs(z) < 0.5) return r === 3 ? -1 : r;
	}
	return 0;
};

let added = 0, skipped: string[] = [];
for (const it of list) {
	if (added >= max) break;
	if (known.has(it.part) || data['p_' + it.part]) continue;
	const m = partMesh(it.part);
	if (!m) { skipped.push(`${it.part} (geen LDraw-vorm)`); continue; }
	const [x0, y0, z0, x1, y1, z1] = m.bbox;
	const studs = m.studs ?? [];
	const side = m.side ?? [];
	// footprint along x and z: from the studs, unless the body is clearly bigger on both sides (offset plates)
	const axis = (lo: number, hi: number, vals: number[]) => {
		if (!vals.length) return { n: Math.max(1, Math.round((hi - lo) / 20)), c: (lo + hi) / 2, prot: [0, 0] };
		const smin = Math.min(...vals) - 10, smax = Math.max(...vals) + 10;
		const extLo = smin - lo, extHi = hi - smax;
		if (extLo >= 8 && extHi >= 8) return { n: Math.max(1, Math.round((hi - lo) / 20)), c: (lo + hi) / 2, prot: [0, 0] };
		return { n: Math.max(1, Math.round((smax - smin) / 20)), c: (smin + smax) / 2, prot: [extLo, extHi] };
	};
	const ax = axis(x0, x1, studs.map((s) => s[0]));
	const az = axis(z0, z1, studs.map((s) => s[2]));
	const top = studs.length ? Math.min(0, y0 + 4) : y0;
	const ht = Math.max(1, Math.round((y1 - top) / 8));
	if (ax.n > 16 || az.n > 16 || ht > 60) { skipped.push(`${it.part} (te groot)`); continue; }

	// direction
	let r0 = 0, cal = '', dirText = '';
	if (side.length) {
		const dx = side.reduce((a, s) => a + s[3], 0), dz = side.reduce((a, s) => a + s[4], 0);
		if (Math.abs(dx) + Math.abs(dz) > 0.5) { r0 = turnTo(Math.sign(Math.round(dx)), Math.sign(Math.round(dz))); cal = 'face'; dirText = 'dir = the side its side studs face'; }
	}
	if (!cal) {
		const p = [[-1, 0, ax.prot[0]], [1, 0, ax.prot[1]], [0, -1, az.prot[0]], [0, 1, az.prot[1]]].sort((a, b) => b[2] - a[2])[0];
		if (p[2] >= 6) { r0 = turnTo(p[0], p[1]); cal = 'face'; dirText = 'dir = the side where it sticks out'; }
	}
	if (!cal && /slope|curved|wedge/i.test(it.name) && !/double|inverted|quadruple|pyramid/i.test(it.name)) {
		// low side: compare top heights of the halves for each turn
		const pts: number[][] = [];
		for (const g of m.groups) for (let i = 0; i < g.pos.length; i += 3) pts.push([g.pos[i], -g.pos[i + 1], -g.pos[i + 2]]);
		let best = -1e9;
		for (let r = 0; r < 4; r++) {
			const q = pts.map(([x, y, z]) => { const [a, b] = rot(x - ax.c, z + az.c, r); return [a, y, b]; });
			const L = q.filter((p) => p[0] < -2).map((p) => p[1]), R = q.filter((p) => p[0] > 2).map((p) => p[1]);
			if (!L.length || !R.length) continue;
			const sc = Math.max(...L) - Math.max(...R);
			if (sc > best + 0.5) { best = sc; r0 = r === 3 ? -1 : r; }
		}
		if (best > 2) { cal = 'slope'; dirText = 'dir = the low side'; } else r0 = 0;
	}
	if (!cal && ax.n !== az.n) { r0 = az.n > ax.n ? 1 : 0; cal = 'long'; dirText = 'dir = "x" or "y" (the long side)'; }
	// footprint in the d=0 orientation (after r0)
	const odd = Math.abs(r0) % 2 === 1;
	const foot = odd ? [az.n, ax.n, ht] : [ax.n, az.n, ht];

	data['p_' + it.part] = {
		name: it.name,
		group,
		foot,
		...(cal ? { cal } : {}),
		r0,
		center: [Math.round(ax.c * 10) / 10, Math.round(az.c * 10) / 10],
		use: `${it.name.replace(/\s+/g, ' ')}${dirText ? ` (${dirText})` : ''}`,
		qty: it.qty,
		ldraw: [{ f: it.part, c: 'main' }],
		buy: [{ p: it.part, c: 'main', q: 1 }]
	};
	added++;
}
writeFileSync(SPEC, JSON.stringify(data, null, '\t') + '\n');
console.log(`added ${added}`);
if (skipped.length) console.log('skipped:', skipped.join(', '));
