<script lang="ts">
	/** "Toren bouwen": a brick slides above the tower; tap to drop it. What sticks out falls off. */
	import { onMount } from 'svelte';
	let { active = true }: { active?: boolean } = $props();

	const COLORS = ['#C91A09', '#F2CD37', '#0055BF', '#4B9F4A', '#FE8A18', '#5A93DB', '#C870A0', '#36AEBF'];
	let canvas: HTMLCanvasElement;
	let height = $state(0);
	let best = $state(0);
	let shown = $state(true);
	let over = $state(false);
	let finalScore = $state<number | null>(null);
	let restart: () => void = () => {};

	onMount(() => {
		try { best = Number(localStorage.getItem('bouwboot.toren.best')) || 0; } catch {}
		const ctx = canvas.getContext('2d')!;
		let W = 0, H = 0, dpr = 1;
		const resize = () => {
			dpr = window.devicePixelRatio || 1;
			W = canvas.clientWidth; H = canvas.clientHeight;
			canvas.width = W * dpr; canvas.height = H * dpr;
		};
		resize();
		const ro = new ResizeObserver(resize); ro.observe(canvas);

		type Block = { x: number; w: number; c: string };
		type Fall = { x: number; y: number; w: number; c: string; vy: number; rot: number };
		const BH = () => Math.max(18, Math.min(28, H / 16));
		let stack: Block[] = [], falling: Fall[] = [], moving: Block, dir = 1, speed = 0, camY = 0, flash = 0, flashText = '';
		let raf = 0, last = performance.now();

		function reset() {
			const w0 = Math.min(W * 0.45, 220);
			stack = [{ x: (W - w0) / 2, w: w0, c: COLORS[0] }];
			falling = [];
			height = 0; over = false; camY = 0; speed = 110;
			next();
		}
		function next() {
			const top = stack[stack.length - 1];
			dir = Math.random() < 0.5 ? 1 : -1;
			moving = { x: dir > 0 ? 0 : W - top.w, w: top.w, c: COLORS[stack.length % COLORS.length] };
		}
		restart = reset;

		function drawBlock(x: number, y: number, w: number, c: string) {
			const bh = BH(), sw = bh * 0.9;
			ctx.fillStyle = c;
			const studs = Math.max(1, Math.floor(w / sw));
			for (let i = 0; i < studs; i++) {
				const sx = x + (w - studs * sw) / 2 + i * sw + sw * 0.22;
				ctx.fillRect(sx, y - bh * 0.25, sw * 0.56, bh * 0.27);
			}
			ctx.fillRect(x, y, w, bh);
			ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x, y + bh * 0.78, w, bh * 0.22);
			ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(x, y, w, bh * 0.16);
		}

		function frame(now: number) {
			const dt = Math.min(0.05, (now - last) / 1000); last = now;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, W, H);
			const bh = BH();
			const base = H - 30;
			// keep the top of the tower around the middle of the screen
			const want = Math.max(0, stack.length * bh - H * 0.45);
			camY += (want - camY) * Math.min(1, dt * 4);
			const yOf = (i: number) => base - (i + 1) * bh + camY;
			if (active && !over && moving) {
				moving.x += dir * speed * dt;
				if (moving.x + moving.w > W + 4) dir = -1;
				if (moving.x < -4) dir = 1;
			}
			stack.forEach((b, i) => drawBlock(b.x, yOf(i), b.w, b.c));
			if (!over && moving) drawBlock(moving.x, yOf(stack.length), moving.w, moving.c);
			for (let i = falling.length - 1; i >= 0; i--) {
				const f = falling[i];
				f.vy += 900 * dt; f.y += f.vy * dt; f.rot += dt * 2;
				ctx.save(); ctx.translate(f.x + f.w / 2, f.y + bh / 2 + camY); ctx.rotate(f.rot * Math.sign(f.x - W / 2 || 1));
				drawBlock(-f.w / 2, -bh / 2, f.w, f.c); ctx.restore();
				if (f.y > H + 100 - camY) falling.splice(i, 1);
			}
			if (flash > 0) {
				flash -= dt;
				ctx.globalAlpha = Math.min(1, flash * 2);
				ctx.fillStyle = '#1d2330'; ctx.font = 'bold 20px system-ui, sans-serif'; ctx.textAlign = 'center';
				ctx.fillText(flashText, W / 2, yOf(stack.length) - 14);
				ctx.globalAlpha = 1;
			}
			raf = requestAnimationFrame(frame);
		}

		function drop(e: PointerEvent) {
			if (!active) return;
			e.preventDefault();
			if (over) { reset(); return; }
			const top = stack[stack.length - 1];
			const bh = BH();
			const y = base0() - (stack.length + 1) * bh;
			let l = Math.max(moving.x, top.x), r = Math.min(moving.x + moving.w, top.x + top.w);
			if (Math.abs(moving.x - top.x) < 5) { l = top.x; r = top.x + top.w; flash = 0.9; flashText = 'Perfect!'; }
			if (r - l < 3) {
				falling.push({ x: moving.x, y, w: moving.w, c: moving.c, vy: 0, rot: 0 });
				over = true;
				if (height > best) { best = height; try { localStorage.setItem('bouwboot.toren.best', String(best)); } catch {} }
				return;
			}
			if (moving.x < l) falling.push({ x: moving.x, y, w: l - moving.x, c: moving.c, vy: 0, rot: 0 });
			if (moving.x + moving.w > r) falling.push({ x: r, y, w: moving.x + moving.w - r, c: moving.c, vy: 0, rot: 0 });
			stack.push({ x: l, w: r - l, c: moving.c });
			height++;
			speed = Math.min(320, 110 + height * 9);
			if (navigator.vibrate) try { navigator.vibrate(12); } catch {}
			next();
		}
		const base0 = () => H - 30;
		reset();
		raf = requestAnimationFrame(frame);
		canvas.addEventListener('pointerdown', drop);
		return () => { cancelAnimationFrame(raf); ro.disconnect(); canvas.removeEventListener('pointerdown', drop); };
	});

	$effect(() => {
		if (active) return;
		finalScore = Math.max(height, 0);
		if (height > best) { best = height; try { localStorage.setItem('bouwboot.toren.best', String(best)); } catch {} }
		const t = setTimeout(() => (shown = false), finalScore ? 2600 : 0);
		return () => clearTimeout(t);
	});
</script>

{#if shown}
	<div class="game" class:fade={!active}>
		<canvas bind:this={canvas}></canvas>
		<div class="hud">
			{#if finalScore !== null && !active}
				{#if finalScore}<b>Je toren was {finalScore} hoog!{finalScore >= best ? ' Record!' : ''}</b>{/if}
			{:else}
				<span>Toren bouwen! <b>{height}</b></span>
				{#if best}<small>record {best}</small>{/if}
			{/if}
		</div>
		{#if over && active}
			<div class="again">Tik om opnieuw te bouwen</div>
		{/if}
	</div>
{/if}

<style>
	.game { position: absolute; inset: 0; z-index: 2; }
	.game.fade canvas { opacity: 0.25; transition: opacity 0.6s; pointer-events: none; }
	canvas { width: 100%; height: 100%; display: block; touch-action: manipulation; cursor: pointer; }
	.hud { position: absolute; top: 0.7rem; right: 0.8rem; background: rgba(255,255,255,.92); padding: 0.35rem 0.8rem; border-radius: 999px;
		font-size: 0.95rem; box-shadow: 0 2px 10px rgba(0,0,0,.08); display: flex; gap: 0.6rem; align-items: baseline; pointer-events: none; }
	.hud small { color: #8a93a0; }
	.again { position: absolute; top: 38%; left: 50%; transform: translateX(-50%); background: rgba(255,255,255,.95); padding: 0.5rem 1rem;
		border-radius: 999px; font-weight: 600; pointer-events: none; box-shadow: 0 2px 10px rgba(0,0,0,.1); }
</style>
