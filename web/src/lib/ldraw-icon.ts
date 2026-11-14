/**
 * Small pictures of LEGO parts, rendered from the LDraw shapes in the browser (one shared renderer,
 * one picture at a time) and kept in memory. Scale is the same for every part (px per stud), so a 1x1
 * looks smaller than a 2x4, like in a real building booklet.
 */
import * as THREE from 'three';
import { loadPart, TRANS_IDS } from '#lib/ldraw-client.ts';

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene, camera: THREE.OrthographicCamera;
const cache = new Map<string, Promise<{ src: string; w: number; h: number } | null>>();
let chain: Promise<unknown> = Promise.resolve();
const DIR = new THREE.Vector3(-1, 1.15, 1.45).normalize();

function setup() {
	const canvas = document.createElement('canvas');
	renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
	renderer.setClearColor(0x000000, 0);
	scene = new THREE.Scene();
	scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.2));
	const sun = new THREE.DirectionalLight(0xffffff, 1.6);
	sun.position.set(-3, 6, 4);
	scene.add(sun);
	camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
}

export function partIcon(part: string, hex: string, pxPerStud: number, colourId?: number): Promise<{ src: string; w: number; h: number } | null> {
	const key = `${part}|${hex}|${pxPerStud}`;
	let p = cache.get(key);
	if (!p) {
		p = loadPart(part).then((mesh) => {
			if (!mesh) return null;
			const job = chain.then(() => draw(mesh, hex, pxPerStud, colourId !== undefined && TRANS_IDS.has(colourId)));
			chain = job.catch(() => null);
			return job;
		});
		cache.set(key, p);
	}
	return p;
}

function draw(mesh: { groups: { c: number; hex?: string; alpha?: number; pos: number[] }[] }, hex: string, ppS: number, trans: boolean) {
	try {
		if (!renderer) setup();
		const group = new THREE.Group();
		const mats: THREE.Material[] = [];
		const box = new THREE.Box3();
		for (const g of mesh.groups) {
			const pos = new Float32Array(g.pos.length);
			for (let i = 0; i < g.pos.length; i += 3) {
				pos[i] = g.pos[i] / 20; pos[i + 1] = -g.pos[i + 1] / 20; pos[i + 2] = -g.pos[i + 2] / 20;
			}
			const geo = new THREE.BufferGeometry();
			geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
			geo.computeVertexNormals();
			const isMain = g.c === 16;
			const alpha = isMain ? (trans ? 0.6 : 1) : g.alpha ?? 1;
			const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(isMain ? hex : g.hex ?? '#888'), roughness: 0.35,
				side: THREE.DoubleSide, transparent: alpha < 1, opacity: alpha < 1 ? 0.6 : 1 });
			mats.push(m);
			group.add(new THREE.Mesh(geo, m));
			geo.computeBoundingBox();
			box.union(geo.boundingBox!);
		}
		scene.add(group);
		// fit an orthographic camera around the part, seen from front-left, slightly above
		const centre = box.getCenter(new THREE.Vector3());
		camera.position.copy(centre).addScaledVector(DIR, 50);
		camera.up.set(0, 1, 0);
		camera.lookAt(centre);
		camera.updateMatrixWorld();
		const inv = camera.matrixWorldInverse;
		let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
		for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) {
			const v = new THREE.Vector3(cx, cy, cz).applyMatrix4(inv);
			x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
		}
		const pad = 0.08;
		x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		const w = Math.max(8, Math.min(220, Math.round((x1 - x0) * ppS))), h = Math.max(8, Math.min(220, Math.round((y1 - y0) * ppS)));
		camera.left = x0; camera.right = x1; camera.top = y1; camera.bottom = y0;
		camera.updateProjectionMatrix();
		renderer!.setPixelRatio(dpr);
		renderer!.setSize(w, h, false);
		renderer!.render(scene, camera);
		const src = renderer!.domElement.toDataURL('image/png');
		scene.remove(group);
		group.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
		mats.forEach((m) => m.dispose());
		return { src, w, h };
	} catch {
		return null;
	}
}
