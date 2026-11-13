<script lang="ts">
	/** "Vang de stenen": tap the falling bricks before they hit the floor. Plays while a design is made. */
	import { onMount } from 'svelte';
	let { active = true }: { active?: boolean } = $props();

	const COLORS = ['#C91A09', '#F2CD37', '#0055BF', '#4B9F4A', '#FE8A18', '#F4F4F4', '#C870A0', '#36AEBF'];
	type B = { x: number; y: number; w: number; h: number; c: string; v: number; rot: number; vr: number; studs: number };
	type Pop = { x: number; y: number; t: number; text: string };
	let canvas: HTMLCanvasElement;
	let score = $state(0);
	let missed = $state(0);
	let best = $state(0);
	let shown = $state(true);
	let finalScore = $state<number | null>(null);

	onMount(() => {
		try { best = Number(localStorage.getItem('bouwboot.vang.best')) || 0; } catch {}
		const ctx = canvas.getContext('2d')!;
		let W = 0, H = 0, dpr = 1;
		const resize = () => {
			dpr = window.devicePixelRatio || 1;
			W = canvas.clientWidth; H = canvas.clientHeight;
			canvas.width = W * dpr; canvas.height = H * dpr;
		};
		resize();
		const ro = new ResizeObserver(resize); ro.observe(canvas);

		const bricks: B[] = [];
		const pops: Pop[] = [];
		let last = performance.now(), spawnIn = 0.6, elapsed = 0, raf = 0;

		function spawn() {
			const studs = [1, 2, 2, 3, 4][Math.floor(Math.random() * 5)];
			const u = Math.max(14, Math.min(22, W / 22));
			const w = studs * u, h = u * 1.2;
			bricks.push({ x: u + Math.random() * Math.max(1, W - w - 2 * u), y: -h, w, h, c: COLORS[Math.floor(Math.random() * COLORS.length)],
				v: 60 + Math.random() * 40 + elapsed * 3, rot: (Math.random() - 0.5) * 0.6, vr: (Math.random() - 0.5) * 1.5, studs });
		}

		function drawBrick(b: B) {
			ctx.save();
			ctx.translate(b.x + b.w / 2, b.y + b.h / 2); ctx.rotate(b.rot);
			const sw = b.w / b.studs;
			ctx.fillStyle = b.c;
			for (let i = 0; i < b.studs; i++) ctx.fillRect(-b.w / 2 + i * sw + sw * 0.22, -b.h / 2 - b.h * 0.28, sw * 0.56, b.h * 0.3);
			ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
			ctx.fillStyle = 'rgba(0,0,0,.18)';
			ctx.fillRect(-b.w / 2, b.h / 2 - b.h * 0.22, b.w, b.h * 0.22);
			ctx.fillStyle = 'rgba(255,255,255,.25)';
			ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * 0.18);
			ctx.restore();
		}

		function frame(now: number) {
			const dt = Math.min(0.05, (now - last) / 1000); last = now;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, W, H);
			if (active) {
				elapsed += dt;
				spawnIn -= dt;
				if (spawnIn <= 0) { spawn(); spawnIn = Math.max(0.35, 1.1 - elapsed * 0.012); }
			}
			for (let i = bricks.length - 1; i >= 0; i--) {
				const b = bricks[i];
				b.y += b.v * dt; b.rot += b.vr * dt;
				if (b.y > H) { bricks.splice(i, 1); if (active) missed++; continue; }
				drawBrick(b);
			}
			for (let i = pops.length - 1; i >= 0; i--) {
				const p = pops[i]; p.t += dt;
				if (p.t > 0.7) { pops.splice(i, 1); continue; }
				ctx.globalAlpha = 1 - p.t / 0.7;
				ctx.fillStyle = '#1d2330'; ctx.font = 'bold 18px system-ui, sans-serif'; ctx.textAlign = 'center';
				ctx.fillText(p.text, p.x, p.y - p.t * 40);
				ctx.globalAlpha = 1;
			}
			raf = requestAnimationFrame(frame);
		}
		raf = requestAnimationFrame(frame);

		function tap(e: PointerEvent) {
			if (!active) return;
			const r = canvas.getBoundingClientRect();
			const x = e.clientX - r.left, y = e.clientY - r.top;
			const pad = 14; // forgiving for small fingers
			for (let i = bricks.length - 1; i >= 0; i--) {
				const b = bricks[i];
				if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - b.h * 0.4 - pad && y < b.y + b.h + pad) {
					bricks.splice(i, 1);
					score++;
					pops.push({ x: b.x + b.w / 2, y: b.y, t: 0, text: score % 10 === 0 ? 'Super!' : '+1' });
					if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
					e.preventDefault();
					return;
				}
			}
		}
		canvas.addEventListener('pointerdown', tap);
		return () => { cancelAnimationFrame(raf); ro.disconnect(); canvas.removeEventListener('pointerdown', tap); };
	});

	// when the real build starts: show the score for a moment, then go away
	$effect(() => {
		if (active) return;
		finalScore = score;
		if (score > best) { best = score; try { localStorage.setItem('bouwboot.vang.best', String(best)); } catch {} }
		const t = setTimeout(() => (shown = false), score ? 2600 : 0);
		return () => clearTimeout(t);
	});
</script>

{#if shown}
	<div class="game" class:fade={!active}>
		<canvas bind:this={canvas}></canvas>
		<div class="hud">
			{#if finalScore !== null && !active}
				{#if finalScore}<b>Je ving {finalScore} {finalScore === 1 ? 'steen' : 'stenen'}!{finalScore >= best && finalScore > 0 ? ' Record!' : ''}</b>{/if}
			{:else}
				<span>Vang de stenen! <b>{score}</b></span>
				{#if best}<small>record {best}</small>{/if}
			{/if}
		</div>
	</div>
{/if}

<style>
	.game { position: absolute; inset: 0; z-index: 2; transition: opacity 0.8s; }
	.game.fade canvas { opacity: 0.25; transition: opacity 0.6s; pointer-events: none; }
	canvas { width: 100%; height: 100%; display: block; touch-action: manipulation; cursor: pointer; }
	.hud { position: absolute; top: 0.7rem; right: 0.8rem; background: rgba(255,255,255,.92); padding: 0.35rem 0.8rem; border-radius: 999px;
		font-size: 0.95rem; box-shadow: 0 2px 10px rgba(0,0,0,.08); display: flex; gap: 0.6rem; align-items: baseline; pointer-events: none; }
	.hud small { color: #8a93a0; }
</style>
