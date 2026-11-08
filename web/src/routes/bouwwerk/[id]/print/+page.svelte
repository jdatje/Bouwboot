<script lang="ts">
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import Viewer from '#lib/components/Viewer.svelte';
	import PartIcon from '#lib/components/PartIcon.svelte';
	import { BrickScene } from '#lib/scene.ts';
	import { PALETTE_BY_ID, partInfo, partLabel, countParts, makeSteps, type Brick } from '#lib/bricks.ts';

	let scene = $state<BrickScene | null>(null);
	let title = $state('');
	let pages = $state<{ img: string; parts: { part: string; color: number; qty: number }[]; n: number }[]>([]);
	let all = $state<{ part: string; color: number; qty: number }[]>([]);
	let colors: Record<string, { hex: string; name: string }> = {};
	let progress = $state(0);
	const kid = page.url.searchParams.get('kind') === '1';
	const hex = (c?: number) => (c === undefined ? '#999' : colors[c]?.hex ?? PALETTE_BY_ID.get(c)?.hex ?? '#999');
	const cname = (c: number) => colors[c]?.name ?? PALETTE_BY_ID.get(c)?.name ?? '';

	$effect(() => {
		if (scene) render(scene);
	});

	async function render(s: BrickScene) {
		const r = await fetch(`/api/builds/${page.params.id}`);
		const info = await r.json();
		colors = info.colors;
		title = info.build.title;
		const bricks: Brick[] = info.build.bricks;
		all = countParts(bricks);
		s.setBricks(bricks, (b) => hex(b.c));
		s.highlight = new Set();
		s.fit(true);
		const steps = makeSteps(bricks, kid ? 1 : 2, kid ? 3 : 5);
		const out = [];
		for (let i = 0; i < steps.length; i++) {
			const vis = new Set(steps.slice(0, i + 1).flat());
			s.showOnly(vis, new Set(steps[i]));
			s.items.forEach((it, j) => { it.t0 = -1; it.mesh.visible = vis.has(j); s.place(it, 0); });
			out.push({ img: s.capture(kid ? 900 : 600, kid ? 680 : 450), parts: countParts(steps[i].map((j) => bricks[j])), n: i + 1 });
			progress = Math.round(((i + 1) / steps.length) * 100);
			if (i % 5 === 0) await tick();
		}
		pages = out;
	}
</script>

<svelte:head><title>{title} · bouwinstructies</title></svelte:head>

<div class="offscreen"><Viewer bind:scene height="450px" /></div>

<div class="bar noprint">
	{#if pages.length}<button class="primary" onclick={() => print()}>Afdrukken / PDF opslaan</button>
	{:else}<span>Instructies maken… {progress}%</span>{/if}
</div>

<article class:kid>
	<section class="cover">
		<h1>{title}</h1>
		<p>{pages.length} stappen</p>
		<div class="all">
			{#each all as p}
				<div class="p"><PartIcon part={p.part} hex={hex(p.color)} px={10} /><b>{p.qty}×</b>{#if !kid}<small>{partLabel(p.part)} {cname(p.color)}</small>{/if}</div>
			{/each}
		</div>
	</section>
	<div class="steps">
		{#each pages as p}
			<section class="step">
				<div class="head"><span class="n">{p.n}</span>
					<div class="box">
						{#each p.parts as x}<div class="p"><PartIcon part={x.part} hex={hex(x.color)} px={kid ? 16 : 10} /><b>{x.qty}×</b></div>{/each}
					</div>
				</div>
				<img src={p.img} alt="Stap {p.n}" />
			</section>
		{/each}
	</div>
</article>

<style>
	.offscreen { position: fixed; left: -10000px; top: 0; width: 600px; }
	.bar { position: sticky; top: 0; background: #fff; padding: 0.8rem 1rem; border-bottom: 1px solid #e5e8ec; z-index: 2; }
	article { max-width: 1000px; margin: 0 auto; padding: 1rem; }
	.cover h1 { font-size: 2.2rem; margin: 0.5rem 0 0; }
	.all { display: flex; flex-wrap: wrap; gap: 0.6rem 1.2rem; margin: 1rem 0 2rem; }
	.p { display: flex; align-items: center; gap: 0.35rem; }
	.p small { color: #666; }
	.steps { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }
	.kid .steps { grid-template-columns: 1fr; }
	@media (max-width: 700px) { .steps { grid-template-columns: minmax(0, 1fr); } }
	.step { border: 2px solid #e5e8ec; border-radius: 14px; padding: 0.7rem; break-inside: avoid; }
	.head { display: flex; align-items: flex-start; gap: 0.8rem; }
	.n { font-size: 2rem; font-weight: 900; min-width: 1.6em; }
	.kid .n { font-size: 3.4rem; }
	.box { display: flex; flex-wrap: wrap; gap: 0.5rem 0.9rem; border: 2px solid #cfe0f7; background: #f2f7fd; border-radius: 10px; padding: 0.45rem 0.7rem; }
	img { width: 100%; display: block; }
	.kid .step { break-after: page; }
	@media print {
		.noprint { display: none; }
		.cover { break-after: page; }
		article { padding: 0; }
	}
</style>
