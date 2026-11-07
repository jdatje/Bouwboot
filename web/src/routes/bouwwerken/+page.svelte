<script lang="ts">
	import { onMount } from 'svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	type Row = { id: string; title: string; prompt: string; bricks: unknown[]; assembled: number; order_status: string | null; thumb: string | null };
	let rows = $state<Row[] | null>(null);
	onMount(async () => {
		rows = await (await fetch('/api/builds')).json();
	});
</script>

<svelte:head><title>Opgeslagen · Bouwboot</title></svelte:head>
<TopBar />
<main>
	<h1>Opgeslagen bouwwerken</h1>
	{#if rows === null}
		<p class="muted">Laden…</p>
	{:else if rows.length === 0}
		<p class="muted">Nog niks bewaard. Bouw iets en druk op <b>Bewaar</b>.</p>
	{:else}
		<div class="grid">
			{#each rows as r}
				<a class="card item" href="/bouwwerk/{r.id}">
					{#if r.thumb}<img src={r.thumb} alt="" />{:else}<div class="ph"></div>{/if}
					<div class="meta">
						<b>{r.title}</b>
						<span class="muted">{r.bricks.length} stenen</span>
						<div class="chips">
							{#if r.assembled}<span class="chip green">staat in elkaar</span>{/if}
							{#if r.order_status === 'besteld'}<span class="chip">besteld</span>{/if}
							{#if r.order_status === 'binnen'}<span class="chip blue">binnen</span>{/if}
						</div>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</main>

<style>
	main { max-width: 1200px; margin: 0 auto; padding: 0 1.2rem 2rem; }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; }
	.item { text-decoration: none; color: inherit; overflow: hidden; }
	.item img, .ph { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; background: #eef1f5; }
	.meta { padding: 0.7rem 0.9rem; display: flex; flex-direction: column; gap: 0.2rem; }
	.chips { display: flex; gap: 0.3rem; flex-wrap: wrap; }
	.chip { background: #ffcf00; border-radius: 999px; padding: 0.05em 0.6em; font-size: 0.78rem; font-weight: 600; }
	.chip.green { background: #cdebd3; }
	.chip.blue { background: #cfe0f7; }
</style>
