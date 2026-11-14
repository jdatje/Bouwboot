/**
 * Browser side of the LDraw parts: fetches part meshes from /api/ldraw (batched), and turns a Brick into
 * a ready-to-draw geometry: LDraw axes → scene axes, turned to the brick's direction, centred on its
 * footprint with the bottom at -height/2 (the scene places bricks by their centre).
 */
import * as THREE from 'three';
import { partOf, type Brick } from '#lib/bricks.ts';
import SPECIALS from '#lib/specials.json';

export type Special = {
	name: string;
	group: number;
	foot: [number, number, number];
	r0?: number;
	slope?: boolean;
	ldraw: { f: string; c: 'main' | number; at?: [number, number, number]; ry?: number; rx?: number }[];
	buy: { p: string; c: 'main' | number; q: number }[];
};
export const specials = Object.fromEntries(Object.entries(SPECIALS).filter(([k]) => !k.startsWith('_'))) as Record<string, Special>;

type PartMesh = { id: string; title: string; bbox: number[]; groups: { c: number; hex?: string; alpha?: number; pos: number[] }[] };

const parts = new Map<string, Promise<PartMesh | null>>();
let queue: { id: string; resolve: (m: PartMesh | null) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
	timer = null;
	const batch = queue;
	queue = [];
	for (let i = 0; i < batch.length; i += 100) {
		const chunk = batch.slice(i, i + 100);
		fetch('/api/ldraw?ids=' + encodeURIComponent(chunk.map((q) => q.id).join(',')))
			.then((r) => (r.ok ? r.json() : { parts: {} }))
			.then((j) => { for (const q of chunk) q.resolve(j.parts?.[q.id] ?? null); })
			.catch(() => { for (const q of chunk) q.resolve(null); });
	}
}

export function loadPart(id: string): Promise<PartMesh | null> {
	let p = parts.get(id);
	if (!p) {
		p = new Promise((resolve) => queue.push({ id, resolve }));
		parts.set(id, p);
		timer ??= setTimeout(flush, 15);
	}
	return p;
}

export type Built = { geo: THREE.BufferGeometry; fixed: { hex: string; alpha: number }[] };

const H = 1.2;
export const heightOfBrick = (b: Brick) => (b.s ? (specials[b.s]?.foot[2] ?? 3) / 3 * H : b.p ? H / 3 : H);
// quarter turns for direction d (0 = downhill/facing +x, as the brick step uses)
const TURN = [0, Math.PI, -Math.PI / 2, Math.PI / 2];

const built = new Map<string, Promise<Built | null>>();

/** LDraw drawing for a brick; null when the part isn't in the library (the box placeholder stays). */
export function geometryFor(b: Brick, hexOf: (id: number) => string): Promise<Built | null> {
	const key = b.s ? `s:${b.s}:${b.h}x${b.w}:${b.d ?? 0}` : `${partOf(b)}:${b.h}x${b.w}:${b.k ?? ''}:${b.d ?? 0}`;
	let p = built.get(key);
	if (!p) {
		p = make(b, hexOf);
		built.set(key, p);
	}
	return p;
}

async function make(b: Brick, hexOf: (id: number) => string): Promise<Built | null> {
	const spec = b.s ? specials[b.s] : null;
	const items = spec ? spec.ldraw : [{ f: partOf(b), c: 'main' as const }];
	if (!items.length || !items[0].f) return null;
	const meshes = await Promise.all(items.map((it) => loadPart(it.f)));
	if (meshes.some((m) => !m)) return null;

	// collect triangles per colour: 'main' (painted by the app) or a fixed hex
	const buckets = new Map<string, { alpha: number; pos: number[] }>();
	const m4 = new THREE.Matrix4();
	const v = new THREE.Vector3();
	items.forEach((it, n) => {
		const mesh = meshes[n]!;
		m4.identity();
		if (it.at) m4.multiply(new THREE.Matrix4().makeTranslation(it.at[0], it.at[1], it.at[2]));
		if (it.ry) m4.multiply(new THREE.Matrix4().makeRotationY((it.ry * Math.PI) / 2));
		if (it.rx) m4.multiply(new THREE.Matrix4().makeRotationX((it.rx * Math.PI) / 2));
		for (const g of mesh.groups) {
			let k = 'main', alpha = 1;
			if (g.c !== 16) { k = g.hex!; alpha = g.alpha ?? 1; }
			else if (it.c !== 'main') {
				k = hexOf(it.c);
				alpha = TRANS_IDS.has(it.c) ? 0.55 : 1;
			}
			let bk = buckets.get(k);
			if (!bk) buckets.set(k, (bk = { alpha, pos: [] }));
			for (let i = 0; i < g.pos.length; i += 3) {
				v.set(g.pos[i], g.pos[i + 1], g.pos[i + 2]).applyMatrix4(m4);
				// LDraw → scene: 1/20 scale, turned 180° about x (keeps handedness: -y is up in LDraw)
				bk.pos.push(v.x / 20, -v.y / 20, -v.z / 20);
			}
		}
	});

	const keys = ['main', ...[...buckets.keys()].filter((k) => k !== 'main')];
	const all: number[] = [];
	const geo = new THREE.BufferGeometry();
	const fixed: Built['fixed'] = [];
	let start = 0;
	keys.forEach((k, mi) => {
		const bk = buckets.get(k);
		const n = bk ? bk.pos.length / 3 : 0;
		if (bk) all.push(...bk.pos);
		geo.addGroup(start, n, mi);
		start += n;
		if (mi > 0) fixed.push({ hex: k, alpha: bk!.alpha });
	});
	geo.setAttribute('position', new THREE.Float32BufferAttribute(all, 3));

	// direction: special pieces and slopes use r0 + d; plain bricks turn when their footprint doesn't match
	let turn = 0;
	if (spec || b.k === 's45' || b.k === 's33') {
		const r0 = spec ? (spec.r0 ?? 0) : 1; // LDraw slopes run downhill towards -z → +x
		turn = (r0 * Math.PI) / 2 + TURN[b.d ?? 0];
	}
	if (turn) geo.rotateY(turn);
	geo.computeBoundingBox();
	let bb = geo.boundingBox!;
	if (!spec && b.k !== 's45' && b.k !== 's33' && b.h !== b.w && Math.round(bb.max.x - bb.min.x) !== b.h) {
		geo.rotateY(Math.PI / 2);
		geo.computeBoundingBox();
		bb = geo.boundingBox!;
	}
	// centre on the footprint; bottom at -height/2
	const ht = heightOfBrick(b);
	geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y - ht / 2, -(bb.min.z + bb.max.z) / 2);
	geo.computeVertexNormals();
	return { geo, fixed };
}

// transparent colours (Rebrickable ids)
export const TRANS_IDS = new Set([47, 36, 46, 57, 41, 33, 34]);
