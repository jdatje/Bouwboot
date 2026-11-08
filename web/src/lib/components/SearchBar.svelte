<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	const warm = () => fetch('/api/warm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
	onMount(warm);
	let { value = '', onlyMine = false, big = false, autofocus = false, size = 'm' }: { value?: string; onlyMine?: boolean; big?: boolean; autofocus?: boolean; size?: string } = $props();
	let q = $state(value);
	let mine = $state(onlyMine);
	let sz = $state(size);
	$effect(() => { sz = size; });
	const SIZES: [string, string][] = [['k', 'Klein'], ['m', 'Middel'], ['g', 'Groot']];
	$effect(() => { q = value; });
	$effect(() => { mine = onlyMine; });

	function go(e: Event) {
		e.preventDefault();
		const t = q.trim();
		if (!t) return;
		goto(`/bouwwerk/nieuw?q=${encodeURIComponent(t)}${mine ? '&mijn=1' : ''}&g=${sz}&t=${Date.now()}`);
	}
</script>

<form class="search" class:big onsubmit={go}>
	<div class="bar">
		<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
		<!-- svelte-ignore a11y_autofocus -->
		<input bind:value={q} placeholder="Wat wil je bouwen? Bijv. een krokodil" enterkeyhint="go" aria-label="Wat wil je bouwen?" {autofocus} onfocus={warm} />
		<button class="primary" type="submit" disabled={!q.trim()}>Bouw</button>
	</div>
	<div class="opts">
		<div class="size" role="radiogroup" aria-label="Grootte">
			{#each SIZES as [id, label]}
				<button type="button" role="radio" aria-checked={sz === id} class:on={sz === id} onclick={() => (sz = id)}>{label}</button>
			{/each}
		</div>
		<label class="mine">
			<input type="checkbox" bind:checked={mine} />
			<span>Alleen mijn stenen</span>
		</label>
	</div>
</form>

<style>
	.search { width: 100%; }
	.bar {
		display: flex; align-items: center; gap: 0.5rem;
		background: white; border: 2px solid #dfe4ea; border-radius: 999px;
		padding: 0.3rem 0.35rem 0.3rem 1rem;
		box-shadow: 0 2px 10px rgba(0,0,0,.05);
		color: #8a93a0;
	}
	.bar:focus-within { border-color: #ffcf00; box-shadow: 0 2px 16px rgba(255,207,0,.25); }
	.bar input { flex: 1; border: none; outline: none; padding: 0.5rem 0; font-size: 1.05rem; min-width: 0; background: transparent; color: #1d2330; }
	.bar button { border-radius: 999px; }
	.big .bar { padding: 0.45rem 0.45rem 0.45rem 1.3rem; }
	.big .bar input { font-size: 1.25rem; }
	.opts { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem 1.2rem; margin: 0.7rem 0 0 1rem; }
	.size { display: inline-flex; background: #eef1f5; border-radius: 999px; padding: 0.15rem; }
	.size button { background: none; padding: 0.3em 0.85em; border-radius: 999px; font-size: 0.88rem; color: #4a5260; }
	.size button.on { background: white; color: #1d2330; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
	.mine { display: inline-flex; align-items: center; gap: 0.45rem; color: #4a5260; font-size: 0.95rem; cursor: pointer; }
	.mine input { width: 1.1rem; height: 1.1rem; accent-color: #d01012; }
</style>
