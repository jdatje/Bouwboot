// three.js scene for showing, animating and stepping through brick builds.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Brick } from './bricks';

const H = 1.2; // brick height in stud units
export const RAW = '#cfd3d6'; // colour of bricks before they are painted

const geoCache = new Map<string, THREE.BufferGeometry>();
const heightOf = (b: Brick) => (b.p ? H / 3 : H);

function stud(x: number, y: number, z: number): THREE.BufferGeometry {
	const s = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 14);
	s.translate(x, y, z);
	return s;
}

/** A slope: `depth` studs deep (downhill along +x), `width` wide (along z); studs on the high row. */
function slopeGeometry(depth: number, width: number): THREE.BufferGeometry {
	const low = H * 0.18;
	const shape = new THREE.Shape();
	const x0 = -depth / 2 + 0.02, x1 = depth / 2 - 0.02;
	shape.moveTo(x0, -H / 2);
	shape.lineTo(x1, -H / 2);
	shape.lineTo(x1, -H / 2 + low);
	shape.lineTo(x0 + 1, H / 2 - 0.01);
	shape.lineTo(x0, H / 2 - 0.01);
	shape.closePath();
	const body = new THREE.ExtrudeGeometry(shape, { depth: width - 0.04, bevelEnabled: false });
	body.translate(0, 0, -(width - 0.04) / 2);
	const parts: THREE.BufferGeometry[] = [body];
	for (let j = 0; j < width; j++) parts.push(stud(-depth / 2 + 0.5, H / 2 + 0.1, j - width / 2 + 0.5));
	return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map((p) => { p.deleteAttribute('uv'); return p; }))!;
}

function brickGeometry(b: Brick): THREE.BufferGeometry {
	const { h, w } = b;
	const plate = !!b.p;
	const key = `${h}x${w}${plate ? 'p' : ''}${b.k ?? ''}${b.d ?? ''}`;
	let g = geoCache.get(key);
	if (g) return g;
	if (b.k === 's45' || b.k === 's33') {
		const alongX = b.d === 0 || b.d === 1;
		g = slopeGeometry(alongX ? h : w, alongX ? w : h);
		// downhill +x is the default; turn for the other directions
		const turn = [0, Math.PI, -Math.PI / 2, Math.PI / 2][b.d ?? 0];
		g.rotateY(turn);
	} else {
		const ht = plate ? H / 3 : H;
		const parts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(h - 0.04, ht - 0.02, w - 0.04)];
		if (b.k !== 't')
			for (let i = 0; i < h; i++)
				for (let j = 0; j < w; j++) parts.push(stud(i - h / 2 + 0.5, ht / 2 + 0.1, j - w / 2 + 0.5));
		g = mergeGeometries(parts.map((p) => p.toNonIndexed()).map((p) => { p.deleteAttribute('uv'); return p; }))!;
	}
	g.computeVertexNormals();
	geoCache.set(key, g);
	return g;
}

type Item = {
	mesh: THREE.Mesh;
	mat: THREE.MeshStandardMaterial;
	brick: Brick;
	t0: number; // drop animation start (ms), -1 = no animation
	removing?: number; // fade-out start
	halo?: THREE.Mesh; // outline for bricks that are new in the current step
	colorFrom?: THREE.Color;
	colorTo?: THREE.Color;
	colorT0?: number;
};

const haloMat = new THREE.MeshBasicMaterial({ color: 0xff9a00, side: THREE.BackSide, transparent: true, opacity: 0.8, depthWrite: false });

const easeOutBack = (t: number) => {
	const c1 = 1.4, c3 = c1 + 1;
	return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export class BrickScene {
	renderer: THREE.WebGLRenderer;
	scene = new THREE.Scene();
	camera: THREE.PerspectiveCamera;
	controls: OrbitControls;
	group = new THREE.Group();
	items: Item[] = [];
	highlight = new Set<number>();
	dropMs = 420;
	private raf = 0;
	private target = new THREE.Vector3(0, 3, 0);
	private dist = 30;
	private fitAuto = true;
	private ro: ResizeObserver;
	private ground: THREE.Mesh;

	constructor(private el: HTMLElement) {
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		el.appendChild(this.renderer.domElement);
		this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
		this.camera.position.set(22, 20, 26);
		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.autoRotateSpeed = 1.2;
		this.controls.addEventListener('start', () => (this.fitAuto = false));

		this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
		const sun = new THREE.DirectionalLight(0xffffff, 1.9);
		sun.position.set(12, 30, 18);
		this.scene.add(sun);
		const fill = new THREE.DirectionalLight(0xffffff, 0.5);
		fill.position.set(-20, 10, -12);
		this.scene.add(fill);
		// soft round shadow under the model
		const c = document.createElement('canvas');
		c.width = c.height = 128;
		const g = c.getContext('2d')!;
		const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
		grad.addColorStop(0, 'rgba(20,30,50,0.22)');
		grad.addColorStop(0.6, 'rgba(20,30,50,0.10)');
		grad.addColorStop(1, 'rgba(20,30,50,0)');
		g.fillStyle = grad;
		g.fillRect(0, 0, 128, 128);
		this.ground = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
		);
		this.ground.rotation.x = -Math.PI / 2;
		this.ground.position.y = -0.02;
		this.ground.scale.set(30, 30, 1);
		this.scene.add(this.ground);
		this.scene.add(this.group);

		this.ro = new ResizeObserver(() => this.resize());
		this.ro.observe(el);
		this.resize();
		this.loop();
	}

	resize() {
		const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
		this.renderer.setSize(w, h, false);
		this.renderer.domElement.style.width = '100%';
		this.renderer.domElement.style.height = '100%';
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
	}

	/** Places the model centred over the origin (computed from all bricks given). */
	private offset = new THREE.Vector3(-10, 0, -10);
	centreOn(bricks: Brick[]) {
		if (!bricks.length) return;
		let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
		for (const b of bricks) {
			x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.h);
			y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y + b.w);
		}
		this.offset.set(-(x0 + x1) / 2, 0, -(y0 + y1) / 2);
		const size = Math.max(x1 - x0, y1 - y0) * 1.7 + 4;
		this.ground.scale.set(size, size, 1);
		for (const it of this.items) this.place(it);
	}

	place(it: Item, lift = 0) {
		const b = it.brick;
		it.mesh.position.set(b.x + b.h / 2 + this.offset.x, b.z * H + heightOf(b) / 2 + lift, b.y + b.w / 2 + this.offset.z);
	}

	add(brick: Brick, color: string = RAW, animate = true) {
		const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.35, metalness: 0.0 });
		const mesh = new THREE.Mesh(brickGeometry(brick), mat);
		const it: Item = { mesh, mat, brick, t0: animate ? performance.now() : -1 };
		this.place(it, animate ? 7 : 0);
		this.group.add(mesh);
		this.items.push(it);
	}

	/** Removes all bricks from index `keep` onward (BrickGPT rollback), with a quick fade. */
	truncate(keep: number) {
		const now = performance.now();
		for (const it of this.items.slice(keep)) {
			it.removing = now;
			it.mat.transparent = true;
		}
		this.items = this.items.slice(0, keep);
	}

	clear() {
		for (const it of this.items) this.group.remove(it.mesh);
		this.group.clear();
		this.items = [];
	}

	setBricks(bricks: Brick[], hex: (b: Brick) => string) {
		this.clear();
		this.centreOn(bricks);
		for (const b of bricks) this.add(b, hex(b), false);
	}

	/** Paints the bricks, bottom to top, with a soft fade. */
	paint(hexes: string[], stagger = true) {
		const now = performance.now();
		const maxZ = Math.max(1, ...this.items.map((i) => i.brick.z));
		this.items.forEach((it, i) => {
			if (!hexes[i]) return;
			it.colorFrom = it.mat.color.clone();
			it.colorTo = new THREE.Color(hexes[i]);
			it.colorT0 = now + (stagger ? (it.brick.z / maxZ) * 900 : 0);
		});
	}

	/** Shows only the given brick indices; `fresh` ones drop in and glow. */
	showOnly(visible: Set<number>, fresh: Set<number>) {
		const now = performance.now();
		this.highlight = fresh;
		const order = [...fresh];
		this.items.forEach((it, i) => {
			it.t0 = -1;
			it.mesh.visible = visible.has(i);
			this.place(it, 0);
			if (fresh.has(i)) {
				it.t0 = now + 110 * order.indexOf(i);
				if (!it.halo) {
					it.halo = new THREE.Mesh(it.mesh.geometry, haloMat);
					it.halo.scale.set(1 + 0.16 / it.brick.h, it.brick.p ? 1.4 : 1.12, 1 + 0.16 / it.brick.w);
					it.mesh.add(it.halo);
				}
			} else if (it.halo) {
				it.mesh.remove(it.halo);
				it.halo = undefined;
			}
		});
	}

	/** Replays the build: every brick drops in in order. */
	replay(totalMs = 6000) {
		const now = performance.now();
		const n = this.items.length;
		const per = Math.min(160, totalMs / Math.max(1, n));
		this.items.forEach((it, i) => {
			it.mesh.visible = true;
			it.t0 = now + i * per;
			this.place(it, 7);
		});
		this.highlight = new Set();
		for (const it of this.items) if (it.halo) { it.mesh.remove(it.halo); it.halo = undefined; }
	}

	setAutoRotate(on: boolean) {
		this.controls.autoRotate = on;
	}

	refit() {
		this.fitAuto = true;
	}

	snapshot(): string {
		this.renderer.render(this.scene, this.camera);
		return this.renderer.domElement.toDataURL('image/png');
	}

	/** Renders the current view to a JPEG of the given size (for thumbnails and print). */
	capture(w: number, h: number): string {
		const old = new THREE.Vector2();
		this.renderer.getSize(old);
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.renderer.setClearColor(0xffffff, 1); // JPEG has no transparency
		this.renderer.render(this.scene, this.camera);
		const url = this.renderer.domElement.toDataURL('image/jpeg', 0.85);
		this.renderer.setClearColor(0x000000, 0);
		this.resize();
		return url;
	}

	/** Points the camera so all visible bricks fit (or snaps immediately). */
	fit(immediate = false) {
		const vis = this.items.filter((i) => i.mesh.visible);
		const box = new THREE.Box3();
		if (!vis.length) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 4, 5));
		for (const it of vis) {
			const b = it.brick;
			box.expandByPoint(new THREE.Vector3(b.x + this.offset.x, b.z * H, b.y + this.offset.z));
			box.expandByPoint(new THREE.Vector3(b.x + b.h + this.offset.x, b.z * H + heightOf(b), b.y + b.w + this.offset.z));
		}
		const c = box.getCenter(new THREE.Vector3());
		const r = Math.max(4, box.getSize(new THREE.Vector3()).length() / 2);
		const fov = (this.camera.fov * Math.PI) / 180;
		const d = (r / Math.sin(fov / 2)) * (this.camera.aspect < 1 ? 1.25 / this.camera.aspect : 1.05);
		this.target.copy(c);
		this.dist = d;
		if (immediate) this.applyFit(1);
	}

	private applyFit(k: number) {
		this.controls.target.lerp(this.target, k);
		const dir = this.camera.position.clone().sub(this.controls.target).normalize();
		const want = this.controls.target.clone().add(dir.multiplyScalar(this.dist));
		this.camera.position.lerp(want, k);
	}

	private loop = () => {
		this.raf = requestAnimationFrame(this.loop);
		const now = performance.now();
		for (const it of this.items) {
			if (it.t0 >= 0) {
				const t = (now - it.t0) / this.dropMs;
				if (t < 0) {
					this.place(it, 7);
					it.mesh.visible = false;
				} else if (t < 1) {
					it.mesh.visible = true;
					this.place(it, 7 * (1 - easeOutBack(t)));
				} else {
					it.mesh.visible = true;
					this.place(it, 0);
					it.t0 = -1;
				}
			}
			if (it.colorT0 !== undefined && it.colorTo) {
				const t = Math.min(1, Math.max(0, (now - it.colorT0) / 500));
				it.mat.color.copy(it.colorFrom!).lerp(it.colorTo, t);
				if (t >= 1) it.colorT0 = undefined;
			}
		}
		// outline of bricks that are new in this step pulses softly
		haloMat.opacity = 0.55 + 0.35 * Math.sin(now / 260);
		// fading out removed bricks
		this.group.children.forEach((m) => {
			const mesh = m as THREE.Mesh;
			const mat = mesh.material as THREE.MeshStandardMaterial;
			if (!this.items.some((i) => i.mesh === mesh)) {
				mat.transparent = true;
				mat.opacity -= 0.08;
				mesh.scale.multiplyScalar(0.96);
				if (mat.opacity <= 0) this.group.remove(mesh);
			}
		});
		if (this.fitAuto) {
			this.fit();
			this.applyFit(0.06);
		}
		this.controls.update();
		this.renderer.render(this.scene, this.camera);
	};

	dispose() {
		cancelAnimationFrame(this.raf);
		this.ro.disconnect();
		this.controls.dispose();
		this.renderer.dispose();
		this.renderer.domElement.remove();
	}
}
