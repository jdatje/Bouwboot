<script lang="ts">
	// Test sheet for the LDraw rendering of special pieces (not linked from the app).
	import { onMount } from 'svelte';
	import Viewer from '#lib/components/Viewer.svelte';
	import type { BrickScene } from '#lib/scene.ts';
	import { PALETTE_BY_ID, type Brick } from '#lib/bricks.ts';
	import { specials } from '#lib/ldraw-client.ts';
	import { page } from '$app/state';

	let scene = $state<BrickScene | null>(null);
	const which = page.url.searchParams.get('set') ?? 'all';
	function foot(id: string, d: number) {
		const [h, w] = specials[id].foot;
		return d >= 2 ? [w, h] : [h, w];
	}
	function sheet(): Brick[] {
		const out: Brick[] = [];
		const ids = Object.keys(specials).filter((id) => which === 'all' || specials[id].group === Number(which));
		let y = 0;
		for (const id of ids) {
			let x = 0, rowW = 1;
			for (let d = 0; d < 4; d++) {
				const [h, w] = foot(id, d);
				out.push({ h, w, x, y, z: 0, s: id, d, c: id.startsWith('wheel') ? 72 : 4 });
				x += h + 2; rowW = Math.max(rowW, w);
			}
			// reference: plain slope / brick next to it
			out.push({ h: 2, w: 2, x, y, z: 0, k: 's45', d: 0, c: 14 });
			out.push({ h: 1, w: 1, x: x + 3, y, z: 0, c: 1 });
			y += rowW + 2;
		}
		return out;
	}
	function car(): Brick[] {
		const b: Brick[] = [];
		b.push({ h: 2, w: 4, x: 1, y: 0, z: 0, s: 'wheels_s', d: 0, c: 72 });
		b.push({ h: 2, w: 4, x: 7, y: 0, z: 0, s: 'wheels_s', d: 0, c: 72 });
		b.push({ h: 10, w: 4, x: 0, y: 0, z: 1, p: 1, c: 72 });
		b.push({ h: 4, w: 4, x: 0, y: 0, z: 1 + 1 / 3, c: 15 });
		b.push({ h: 4, w: 4, x: 6, y: 0, z: 1 + 1 / 3, c: 15 });
		b.push({ h: 2, w: 1, x: 4, y: 0, z: 1 + 1 / 3, s: 'window_2x2', d: 0, c: 15 });
		b.push({ h: 2, w: 1, x: 4, y: 3, z: 1 + 1 / 3, s: 'window_2x2', d: 0, c: 15 });
		b.push({ h: 1, w: 1, x: 0, y: 0, z: 2 + 1 / 3, s: 'round_p1', c: 36 });
		b.push({ h: 1, w: 1, x: 0, y: 3, z: 2 + 1 / 3, s: 'round_p1', c: 36 });
		b.push({ h: 2, w: 1, x: 8, y: 0, z: 2 + 1 / 3, s: 'curve_1', d: 0, c: 15 });
		b.push({ h: 2, w: 1, x: 8, y: 3, z: 2 + 1 / 3, s: 'curve_1', d: 0, c: 15 });
		b.push({ h: 4, w: 1, x: 12, y: 0, z: 0, s: 'arch_4', d: 0, c: 4 });
		b.push({ h: 4, w: 1, x: 12, y: 2, z: 0, s: 'door', d: 0, c: 4 });
		b.push({ h: 2, w: 2, x: 17, y: 0, z: 0, s: 'cone_2', c: 25 });
		b.push({ h: 2, w: 2, x: 17, y: 3, z: 0, s: 'round_2', c: 1 });
		b.push({ h: 2, w: 2, x: 17, y: 3, z: 1, s: 'dish_2', c: 71 });
		return b;
	}
	onMount(() => {
		const t = setInterval(() => {
			if (!scene) return;
			clearInterval(t);
			const bricks = which === 'ls' ? JSON.parse(localStorage.getItem('devbricks') ?? '[]') : which === 'car' ? car() : sheet();
			scene.setBricks(bricks, (b) => PALETTE_BY_ID.get(b.c ?? 71)?.hex ?? '#999');
			scene.refit();
		}, 100);
	});
</script>

<div style="position:fixed;inset:0"><Viewer bind:scene /></div>
