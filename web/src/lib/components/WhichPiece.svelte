<script lang="ts">
	/** "Welk stukje past?": a wall, roof or car misses a piece; pick the right one of three, within 5 seconds. */
	import { onMount } from 'svelte';
	import PartIcon from '#lib/components/PartIcon.svelte';
	let { active = true }: { active?: boolean } = $props();

	type Opt = { part: string; label: string };
	type Q = { kind: 'wall' | 'roof' | 'wheel' | 'window'; len: number; hex: string; options: Opt[]; answer: number };
	const COLORS = ['#C91A09', '#F2CD37', '#0055BF', '#4B9F4A', '#FE8A18', '#5A93DB'];
	const BRICK: Record<number, string> = { 1: '3005', 2: '3004', 3: '3622', 4: '3010' };
	const PLATE: Record<number, string> = { 1: '3024', 2: '3023', 3: '3623', 4: '3710' };

	let q = $state<Q | null>(null);
	let picked = $state<number | null>(null);
	let score = $state(0);
	let best = $state(0);
	let left = $state(1); // time left 0..1
	let shown = $state(true);
	let finalScore = $state<number | null>(null);
	let lastKind = '';

	const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
	const shuffle = (opts: Opt[], correct: Opt): Opt[] => [correct, ...opts].sort(() => Math.random() - 0.5);
	function makeQ(): Q {
		let kind: Q['kind'];
		do kind = pick(['wall', 'wall', 'roof', 'wheel', 'window'] as Q['kind'][]); while (kind === lastKind && Math.random() < 0.7);
		lastKind = kind;
		const hex = pick(COLORS);
		let correct: Opt, wrong: Opt[], len = 2;
		if (kind === 'wall') {
			len = 1 + Math.floor(Math.random() * 4);
			const other = pick([1, 2, 3, 4].filter((n) => n !== len));
			correct = { part: BRICK[len], label: `steen 1x${len}` };
			wrong = [{ part: BRICK[other], label: `steen 1x${other}` }, { part: PLATE[len], label: `plaat 1x${len}` }];
		} else if (kind === 'roof') {
			correct = { part: '3039', label: 'dakpan' };
			wrong = [{ part: '3003', label: 'steen 2x2' }, { part: '3068b', label: 'tegel 2x2' }];
		} else if (kind === 'wheel') {
			correct = { part: '4624c01', label: 'wiel' };
			wrong = [{ part: '4740', label: 'schotel' }, { part: '3941', label: 'ronde steen' }];
		} else {
			correct = { part: '60592', label: 'raam' };
			wrong = [{ part: '3004', label: 'steen 1x2' }, { part: '3659', label: 'boog' }];
		}
		const options = shuffle(wrong, correct);
		return { kind, len, hex, options, answer: options.indexOf(correct) };
	}

	let timer: ReturnType<typeof setInterval> | null = null;
	let started = 0;
	function next() {
		q = makeQ();
		picked = null;
		left = 1;
		started = performance.now();
	}
	function choose(i: number) {
		if (!q || picked !== null || !active) return;
		picked = i;
		if (i === q.answer) {
			score++;
			if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
		}
		setTimeout(() => active && next(), i === q.answer ? 700 : 1300);
	}
	onMount(() => {
		try { best = Number(localStorage.getItem('bouwboot.welk.best')) || 0; } catch {}
		next();
		// faster as you get better: 5 seconds, down to 3
		timer = setInterval(() => {
			if (!q || picked !== null || !active) return;
			const limit = Math.max(3000, 5000 - score * 100);
			left = Math.max(0, 1 - (performance.now() - started) / limit);
			if (left <= 0) choose(-1);
		}, 50);
		return () => { if (timer) clearInterval(timer); };
	});
	$effect(() => {
		if (active) return;
		finalScore = score;
		if (score > best) { best = score; try { localStorage.setItem('bouwboot.welk.best', String(best)); } catch {} }
		const t = setTimeout(() => (shown = false), score ? 2600 : 0);
		return () => clearTimeout(t);
	});

	// a row of bricks for the pictures: [x, width] in studs, 10 units per stud
	const wallRows = (len: number): number[][][] => [
		[[0, 4], [4, 4]],
		[[0, 2], [2, 4], [6, 2]],
		[[0, 3], [3 + len, 5 - len]].filter((r) => r[1] > 0)
	];
</script>

{#if shown}
	<div class="game" class:fade={!active}>
		{#if q}
			<div class="card">
				<p class="ask">Welk stukje past in het gat?</p>
				<svg viewBox="-6 -40 92 60" class="pic" aria-hidden="true">
					{#if q.kind === 'wall'}
						{#each wallRows(q.len) as row, r}
							{#each row as [x, w]}
								<rect x={x * 10} y={-r * 12} width={w * 10 - 0.6} height="11.4" rx="1" fill={q.hex} stroke="rgba(0,0,0,.25)" stroke-width="0.6" />
							{/each}
						{/each}
						<rect class="gap" x="30" y="-24" width={q.len * 10} height="11.4" rx="1" />
						{#each Array(8) as _, i}
							{#if !(i >= 3 && i < 3 + q.len)}<rect x={i * 10 + 2.5} y="-27" width="5" height="3" fill={q.hex} />{/if}
						{/each}
					{:else if q.kind === 'roof'}
						<rect x="0" y="0" width="80" height="11.4" fill={q.hex} stroke="rgba(0,0,0,.25)" stroke-width="0.6" />
						<rect x="0" y="-12" width="80" height="11.4" fill={q.hex} stroke="rgba(0,0,0,.25)" stroke-width="0.6" />
						<polygon points="20,-12 40,-24 40,-36 60,-24 60,-12" fill="#8a8f99" />
						<rect x="38" y="-38" width="4" height="3" fill="#8a8f99" />
						<polygon class="gap" points="0,-12 20,-12 20,-24 10,-24" />
						<polygon points="60,-12 80,-12 70,-24 60,-24" fill="#8a8f99" />
					{:else if q.kind === 'wheel'}
						<rect x="0" y="-22" width="80" height="14" rx="2" fill={q.hex} stroke="rgba(0,0,0,.25)" stroke-width="0.6" />
						<rect x="20" y="-34" width="36" height="12" rx="2" fill={q.hex} opacity="0.9" />
						<rect x="26" y="-32" width="24" height="8" fill="#bfe7f2" />
						<circle cx="18" cy="-6" r="8" fill="#1b2a34" /><circle cx="18" cy="-6" r="3.4" fill="#e9ecef" />
						<circle class="gap" cx="62" cy="-6" r="8" />
					{:else}
						{#each [0, 1, 2, 3] as r}
							<rect x="0" y={-r * 12} width="80" height="11.4" fill={q.hex} stroke="rgba(0,0,0,.25)" stroke-width="0.6" />
						{/each}
						<rect class="gap" x="30" y="-24" width="20" height="23" rx="1" />
					{/if}
				</svg>
				<div class="timer"><i style:width="{left * 100}%"></i></div>
				<div class="opts">
					{#each q.options as o, i}
						<button class:right={picked !== null && i === q.answer} class:wrong={picked === i && i !== q.answer} onclick={() => choose(i)}>
							<PartIcon part={o.part} hex={o.part === '4624c01' ? '#F4F4F4' : q.hex} px={16} />
						</button>
					{/each}
				</div>
			</div>
		{/if}
		<div class="hud">
			{#if finalScore !== null && !active}
				{#if finalScore}<b>{finalScore} goed!{finalScore >= best ? ' Record!' : ''}</b>{/if}
			{:else}
				<span>Welk stukje past? <b>{score}</b></span>
				{#if best}<small>record {best}</small>{/if}
			{/if}
		</div>
	</div>
{/if}

<style>
	.game { position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center; padding: 3rem 0.8rem 4.2rem; }
	.game.fade .card { opacity: 0.25; transition: opacity 0.6s; pointer-events: none; }
	.card { background: rgba(255,255,255,.95); border-radius: 18px; padding: 0.8rem 1rem 1rem; box-shadow: 0 4px 18px rgba(0,0,0,.08);
		width: min(420px, 100%); display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
	.ask { margin: 0; font-weight: 600; }
	.pic { width: 100%; max-height: 32vh; }
	.gap { fill: rgba(255,207,0,.25); stroke: #e0a800; stroke-width: 1.2; stroke-dasharray: 3 2; animation: blink 1s infinite; }
	@keyframes blink { 50% { fill: rgba(255,207,0,.55); } }
	.timer { width: 100%; height: 6px; background: #eef1f5; border-radius: 999px; overflow: hidden; }
	.timer i { display: block; height: 100%; background: #ffcf00; transition: width 0.05s linear; }
	.opts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; width: 100%; }
	.opts button { background: #f4f6f9; border-radius: 14px; min-height: 84px; display: flex; align-items: center; justify-content: center; padding: 0.4rem;
		border: 3px solid transparent; touch-action: manipulation; }
	.opts button.right { border-color: #4b9f4a; background: #e3f5e5; }
	.opts button.wrong { border-color: #c91a09; background: #fde8e6; }
	.opts :global(img), .opts :global(svg) { max-width: 100%; height: auto; max-height: 76px; }
	.hud { position: absolute; top: 0.7rem; right: 0.8rem; background: rgba(255,255,255,.92); padding: 0.35rem 0.8rem; border-radius: 999px;
		font-size: 0.95rem; box-shadow: 0 2px 10px rgba(0,0,0,.08); display: flex; gap: 0.6rem; align-items: baseline; pointer-events: none; }
	.hud small { color: #8a93a0; }
</style>
