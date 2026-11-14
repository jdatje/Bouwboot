<script lang="ts">
	import { onMount } from 'svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import PartIcon from '#lib/components/PartIcon.svelte';

	type Item = { part: string; name: string; cat: string; qty: number; sets: number; taught: boolean; requested: number; parked?: string };
	let data = $state<any>(null);
	let items = $state<Item[]>([]);
	let q = $state('');
	let filter = $state<'all' | 'taught' | 'todo' | 'parked' | 'requested'>('todo');
	let page = 0;
	let loading = $state(false);
	let timer: ReturnType<typeof setTimeout>;

	async function load(reset = true) {
		loading = true;
		if (reset) page = 0;
		const r = await fetch(`/api/parts?filter=${filter}&q=${encodeURIComponent(q)}&page=${page}`);
		const j = await r.json();
		data = j;
		items = reset ? j.items ?? [] : [...items, ...(j.items ?? [])];
		loading = false;
	}
	onMount(() => load());
	function search() { clearTimeout(timer); timer = setTimeout(() => load(), 300); }
	async function ask(it: Item, undo = false) {
		await fetch('/api/parts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ part: it.part, undo }) });
		it.requested = undo ? 0 : it.requested + 1;
	}
	const pct = (x: number) => (x * 100).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + '%';
</script>

<TopBar search={false} />
<main>
	<a class="back" href="/magazijn">← Magazijn</a>
	<h1>Onderdelen</h1>
	{#if data && !data.ready}
		<p class="muted">De onderdelenlijst wordt nog opgehaald of opgebouwd. Probeer het over een paar minuten opnieuw.</p>
	{:else if data}
		<div class="stats">
			<div><b>{data.taughtParts.toLocaleString('nl-NL')}</b><span>van {data.totalParts.toLocaleString('nl-NL')} onderdelen kan de ontwerper gebruiken</span></div>
			<div><b>{pct(data.coverage)}</b><span>van alle stenen in officiële sets zijn zulke onderdelen ({pct(data.coverageFit)} zonder Technic, Duplo en andere aparte onderdelen)</span></div>
		</div>
		<div class="bar"><i style:width="{(data.coverage * 100).toFixed(1)}%"></i></div>

		<div class="tools">
			<input type="search" placeholder="Zoek op naam of nummer" bind:value={q} oninput={search} />
			<div class="seg">
				{#each [['todo', 'Te leren'], ['taught', 'Geleerd'], ['requested', 'Aangevraagd'], ['parked', 'Apart'], ['all', 'Alles']] as [id, label]}
					<button class:on={filter === id} onclick={() => { filter = id as any; load(); }}>{label}</button>
				{/each}
			</div>
		</div>
		{#if filter === 'parked'}
			<p class="muted small">Onderdelen die niet goed bij het bouwen van Bouwboot passen (Technic, Duplo, minifiguren, bedrukte stukken en meer, {data.parkedCount.toLocaleString('nl-NL')} in totaal). Die komen nooit vanzelf in een leerronde: alleen als je ze hier speciaal aanvraagt.</p>
		{:else}
			<p class="muted small">Gesorteerd op hoe vaak een onderdeel in officiële sets zit. "Te leren" is de volgorde voor de volgende leerrondes; tik op "Vraag aan" om een onderdeel voorrang te geven.</p>
		{/if}

		<ul>
			{#each items as it (it.part)}
				<li class:taught={it.taught}>
					<span class="icon"><PartIcon part={it.part} hex="#A0A5A9" px={9} /></span>
					<span class="name"><b>{it.name}</b><small>{it.part} · {it.parked ? 'Apart: ' + it.parked : it.cat} · {it.qty.toLocaleString('nl-NL')}× in {it.sets.toLocaleString('nl-NL')} sets</small></span>
					{#if it.taught}<span class="badge ok">Geleerd</span>
					{:else if it.requested}<button class="badge req" title="Aanvraag intrekken" onclick={() => ask(it, true)}>Aangevraagd ✕</button>
					{:else if it.parked}<button class="ask special" title="Apart: {it.parked}" onclick={() => ask(it)}>Speciaal aanvragen</button>
					{:else}<button class="ask" onclick={() => ask(it)}>Vraag aan</button>{/if}
				</li>
			{/each}
		</ul>
		{#if items.length < data.count}
			<button class="more" disabled={loading} onclick={() => { page++; load(false); }}>{loading ? 'Laden…' : 'Meer laden'}</button>
		{/if}
	{:else}
		<p class="muted">Laden…</p>
	{/if}
</main>

<style>
	main { width: min(760px, 100%); margin: 0 auto; padding: 1rem 1.25rem 3rem; }
	.back { color: #6a7380; text-decoration: none; font-size: 0.9rem; }
	h1 { margin: 0.3rem 0 0.8rem; }
	.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; }
	.stats div { background: white; border-radius: 16px; padding: 0.8rem 1rem; box-shadow: 0 2px 10px rgba(0,0,0,.05); display: flex; flex-direction: column; }
	.stats b { font-size: 1.6rem; }
	.stats span { color: #4a5260; font-size: 0.88rem; }
	.bar { height: 10px; background: #e6e9ee; border-radius: 999px; margin: 0.9rem 0; overflow: hidden; }
	.bar i { display: block; height: 100%; background: #ffcf00; }
	.tools { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; }
	.tools input { flex: 1 1 220px; padding: 0.55rem 0.9rem; border-radius: 999px; border: 1px solid #d9dde3; font-size: 1rem; }
	.seg { display: inline-flex; background: #eef1f5; border-radius: 999px; padding: 0.15rem; }
	.seg button { background: none; padding: 0.35em 0.9em; border-radius: 999px; font-size: 0.9rem; color: #4a5260; }
	.seg button.on { background: white; color: #1d2330; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
	.small { font-size: 0.85rem; }
	ul { list-style: none; padding: 0; margin: 0.6rem 0 0; display: grid; gap: 0.4rem; }
	li { display: flex; align-items: center; gap: 0.8rem; background: white; border-radius: 12px; padding: 0.5rem 0.8rem; min-width: 0; overflow: hidden; }
	.icon { width: 56px; display: flex; justify-content: center; flex: none; overflow: hidden; }
	.icon :global(img) { max-width: 56px; height: auto; }
	.name { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.name b { font-weight: 600; font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.name small { color: #8a93a0; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.badge { font-size: 0.8rem; padding: 0.2em 0.7em; border-radius: 999px; flex: none; }
	.badge.ok { background: #e3f5e5; color: #237841; }
	.badge.req { background: #fff6cc; color: #8a6d00; }
	.ask { font-size: 0.8rem; padding: 0.3em 0.8em; flex: none; }
	.ask.special { background: #eef1f5; color: #4a5260; }
	button.badge { border: none; cursor: pointer; }
	.seg { flex-wrap: nowrap; overflow-x: auto; max-width: 100%; scrollbar-width: none; }
	.seg button { white-space: nowrap; }
	.more { margin: 1rem auto 0; display: block; }
	@media (max-width: 520px) { .stats { grid-template-columns: 1fr; } }
</style>
