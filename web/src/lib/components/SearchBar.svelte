<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	const warm = () => fetch('/api/warm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
	onMount(warm);
	let { value = '', onlyMine = false, big = false, autofocus = false }: { value?: string; onlyMine?: boolean; big?: boolean; autofocus?: boolean } = $props();
	let q = $state(value);
	let mine = $state(onlyMine);
	$effect(() => { q = value; });
	$effect(() => { mine = onlyMine; });

	function go(e: Event) {
		e.preventDefault();
		const t = q.trim();
		if (!t) return;
		goto(`/bouwwerk/nieuw?q=${encodeURIComponent(t)}${mine ? '&mijn=1' : ''}&t=${Date.now()}`);
	}
</script>

<form class="search" class:big onsubmit={go}>
	<div class="bar">
		<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
		<!-- svelte-ignore a11y_autofocus -->
		<input bind:value={q} placeholder="Wat wil je bouwen? Bijv. een krokodil" enterkeyhint="go" aria-label="Wat wil je bouwen?" {autofocus} onfocus={warm} />
		<button class="primary" type="submit" disabled={!q.trim()}>Bouw</button>
	</div>
	<label class="mine">
		<input type="checkbox" bind:checked={mine} />
		<span>Alleen mijn stenen</span>
	</label>
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
	.mine { display: inline-flex; align-items: center; gap: 0.45rem; margin: 0.7rem 0 0 1.2rem; color: #4a5260; font-size: 0.95rem; cursor: pointer; }
	.mine input { width: 1.1rem; height: 1.1rem; accent-color: #d01012; }
</style>
